import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_PATH = fileURLToPath(import.meta.url);
const DOCKERFILE_PATH = resolve(ROOT, "test/package-smoke.Dockerfile");
const IMAGE = "rejudge-package-smoke:node-22.19.0";
const CREDENTIAL_ENV = ["OPENCODE_API_KEY"];
const DOCKER_CLIENT_ENV = [
  "PATH",
  "HOME",
  "TMPDIR",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "XDG_CONFIG_HOME",
];
const TARGETS = ["cli", "pi"];
const MODEL = "opencode-go/kimi-k2.6@minimal";
const PROCESS_TIMEOUT_MS = 6 * 60_000;
const SETUP_TIMEOUT_MS = 10 * 60_000;
const CONTAINER_TIMEOUT_MS = 20 * 60_000;
const EXPECTED_PACKAGE_FILES = [
  "LICENSE",
  "README.md",
  "bin/rejudge.js",
  "dist/extension.js",
  "docs/skills/rejudge-diff/SKILL.md",
  "docs/skills/rejudge/SKILL.md",
  "package.json",
];

const USAGE = `usage: bun run smoke:package -- [cli|pi|all] [--no-key]

  cli       test the installed CLI, including ordinary and diff reviews
  pi        test Pi package discovery, resource loading, and the rejudge tool
  all       run cli then pi (default)
  --no-key  skip live answers and require a handled missing-authentication failure`;

function withoutCredentials(env) {
  const clean = { ...env };
  for (const name of CREDENTIAL_ENV) {
    delete clean[name];
  }
  return clean;
}

function dockerClientEnvironment(includeCredentials) {
  const env = {};
  for (const name of DOCKER_CLIENT_ENV) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }
  if (includeCredentials) {
    for (const name of CREDENTIAL_ENV) {
      if (process.env[name] !== undefined) {
        env[name] = process.env[name];
      }
    }
  }
  return env;
}

function redactCredentials(text) {
  let redacted = text;
  for (const name of CREDENTIAL_ENV) {
    const value = process.env[name];
    if (value) {
      redacted = redacted.split(value).join(`[${name} REDACTED]`);
    }
  }
  return redacted;
}

function outputTail(text, length = 4000) {
  return redactCredentials(text.slice(-length));
}

function parseOptions(argv) {
  const args = [...argv];
  let container = false;
  let noKey = false;
  let help = false;
  let target;

  if (args[0] === "--container") {
    container = true;
    args.shift();
  }

  for (const arg of args) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--no-key") {
      if (noKey) {
        throw new Error("--no-key given more than once");
      }
      noKey = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "all" || TARGETS.includes(arg)) {
      if (target !== undefined) {
        throw new Error(`more than one target given: ${target}, ${arg}`);
      }
      target = arg;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { container, noKey, help, target: target ?? "all" };
}

function runProcess(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    input,
    timeoutMs = PROCESS_TIMEOUT_MS,
  } = options;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceTimer;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (forceTimer !== undefined) {
        clearTimeout(forceTimer);
      }
      resolvePromise({ code, signal, stdout, stderr, timedOut });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);

    child.stdin.end(input);
  });
}

async function runChecked(command, args, options = {}) {
  const result = await runProcess(command, args, options);
  if (result.timedOut) {
    throw new Error(`${command} timed out after ${options.timeoutMs ?? PROCESS_TIMEOUT_MS}ms`);
  }
  if (result.code !== 0) {
    throw new Error(
      `${command} exited ${result.code ?? result.signal ?? "without a status"}\n` +
        `${outputTail(result.stderr || result.stdout)}`,
    );
  }
  return result;
}

function assertExactLine(text, expected, label) {
  const found = text.split(/\r?\n/).some((line) => line.trim() === expected);
  assert.equal(found, true, `${label} did not return the exact marker line ${JSON.stringify(expected)}`);
}

async function writeSmokeConfig(cwd) {
  const configDir = join(cwd, ".rejudge");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "config.json"),
    `${JSON.stringify({ reviewers: [MODEL, MODEL], judge: MODEL, debugLog: false }, null, 2)}\n`,
  );
}

async function assertEmptyDirectory(path, label) {
  await mkdir(path, { recursive: true });
  const entries = await readdir(path);
  assert.deepEqual(entries, [], `${label} must start empty`);
}

async function runHost(options) {
  const key = process.env.OPENCODE_API_KEY?.trim();
  if (!options.noKey && !key) {
    throw new Error("live smoke requires OPENCODE_API_KEY; use --no-key for deterministic checks");
  }

  const hostTemp = await mkdtemp(join(tmpdir(), "rejudge-package-smoke-"));
  const buildContext = join(hostTemp, "docker-context");
  const cleanEnv = withoutCredentials(process.env);
  const dockerCleanEnv = dockerClientEnvironment(false);
  const containerName = `rejudge-package-smoke-${process.pid}-${Date.now()}`;
  let dockerStarted = false;

  try {
    await mkdir(buildContext);

    console.log("[smoke] building public artifacts");
    await runChecked("bun", ["run", "build"], {
      cwd: ROOT,
      env: cleanEnv,
      timeoutMs: SETUP_TIMEOUT_MS,
    });

    console.log("[smoke] packing npm artifact without lifecycle scripts");
    const packed = await runChecked(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", hostTemp],
      { cwd: ROOT, env: cleanEnv, timeoutMs: SETUP_TIMEOUT_MS },
    );
    const report = JSON.parse(packed.stdout);
    assert.equal(Array.isArray(report) && report.length === 1, true, "npm pack must return one artifact");

    const files = report[0].files.map((file) => file.path).sort();
    assert.deepEqual(files, [...EXPECTED_PACKAGE_FILES].sort(), "npm tarball file list changed");

    const tarball = join(hostTemp, report[0].filename);
    await access(tarball);

    console.log("[smoke] preparing Node 22.19 Docker image");
    await runChecked(
      "docker",
      ["build", "--file", DOCKERFILE_PATH, "--tag", IMAGE, buildContext],
      { cwd: ROOT, env: dockerCleanEnv, timeoutMs: SETUP_TIMEOUT_MS },
    );

    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--env",
      "HOME=/tmp/rejudge-home",
      "--env",
      "XDG_CONFIG_HOME=/tmp/rejudge-xdg",
      "--env",
      "PI_CODING_AGENT_DIR=/tmp/rejudge-agent",
    ];
    if (!options.noKey) {
      for (const name of CREDENTIAL_ENV) {
        dockerArgs.push("--env", name);
      }
    }
    dockerArgs.push(
      "--mount",
      `type=bind,src=${tarball},dst=/artifact/rejudge.tgz,readonly`,
      "--mount",
      `type=bind,src=${RUNNER_PATH},dst=/smoke/package-smoke.mjs,readonly`,
      "--workdir",
      "/smoke",
      IMAGE,
      "node",
      "/smoke/package-smoke.mjs",
      "--container",
      options.target,
    );
    if (options.noKey) {
      dockerArgs.push("--no-key");
    }

    console.log(`[smoke] running ${options.target} target${options.noKey ? " without credentials" : " live"}`);
    dockerStarted = true;
    const dockerEnv = dockerClientEnvironment(!options.noKey);
    const result = await runProcess("docker", dockerArgs, {
      cwd: ROOT,
      env: dockerEnv,
      timeoutMs: CONTAINER_TIMEOUT_MS,
    });
    const captured = `${result.stdout}\n${result.stderr}`;

    if (key && captured.includes(key)) {
      throw new Error("credential value appeared in captured smoke output");
    }
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.timedOut) {
      throw new Error(`Docker smoke timed out after ${CONTAINER_TIMEOUT_MS}ms`);
    }
    if (result.code !== 0) {
      throw new Error(`Docker smoke exited ${result.code ?? result.signal ?? "without a status"}`);
    }

    console.log(`[smoke] ${options.target} target passed`);
  } finally {
    if (dockerStarted) {
      await runProcess("docker", ["rm", "--force", containerName], {
        cwd: ROOT,
        env: dockerCleanEnv,
        timeoutMs: 30_000,
      }).catch(() => undefined);
    }
    await rm(hostTemp, { recursive: true, force: true });
  }
}

async function installPackedArtifact(noKey) {
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  assert.ok(home && xdg && agentDir, "isolated HOME, XDG_CONFIG_HOME, and PI_CODING_AGENT_DIR are required");

  if (noKey) {
    for (const name of CREDENTIAL_ENV) {
      assert.equal(process.env[name], undefined, `${name} must be absent in --no-key mode`);
    }
    await assertEmptyDirectory(xdg, "XDG config directory");
    await assertEmptyDirectory(agentDir, "Pi agent directory");
  }

  await writeFile(
    "/smoke/package.json",
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  await runChecked(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "/artifact/rejudge.tgz",
    ],
    {
      cwd: "/smoke",
      env: withoutCredentials(process.env),
      timeoutMs: SETUP_TIMEOUT_MS,
    },
  );

  const packageRoot = "/smoke/node_modules/rejudge";
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "rejudge");

  const runtimeEnv = {
    ...process.env,
    PATH: `/smoke/node_modules/.bin:${process.env.PATH ?? ""}`,
  };
  const resolvedBin = await runChecked("sh", ["-c", "command -v rejudge"], { env: runtimeEnv });
  assert.equal(resolvedBin.stdout.trim(), "/smoke/node_modules/.bin/rejudge");

  console.log("[smoke] installed tarball and resolved bare rejudge from PATH");
  return { agentDir, packageRoot, runtimeEnv };
}

async function runCliTarget(context, live) {
  const help = await runChecked("rejudge", ["--help"], { env: context.runtimeEnv });
  assert.match(help.stdout, /^usage: rejudge /);
  console.log("[smoke] cli help passed");

  if (!live) {
    return;
  }

  const ordinaryCwd = "/tmp/rejudge-cli";
  await mkdir(ordinaryCwd, { recursive: true });
  await writeSmokeConfig(ordinaryCwd);
  const ordinary = await runChecked("rejudge", [], {
    cwd: ordinaryCwd,
    env: context.runtimeEnv,
    input: "Calculate 2 + 2. End with the exact line CLI_SMOKE_OK: 4\n",
    timeoutMs: PROCESS_TIMEOUT_MS,
  });
  assertExactLine(ordinary.stdout, "CLI_SMOKE_OK: 4", "ordinary CLI review");
  console.log("[smoke] live cli review passed");

  const diffCwd = "/tmp/rejudge-diff";
  await mkdir(diffCwd, { recursive: true });
  const gitEnv = withoutCredentials(context.runtimeEnv);
  await runChecked("git", ["init", "--quiet", "--initial-branch=main"], { cwd: diffCwd, env: gitEnv });
  await runChecked("git", ["config", "user.name", "Rejudge Smoke"], { cwd: diffCwd, env: gitEnv });
  await runChecked("git", ["config", "user.email", "smoke@rejudge.invalid"], { cwd: diffCwd, env: gitEnv });
  await writeFile(join(diffCwd, "fixture.js"), 'export const releaseMode = "before";\n');
  await runChecked("git", ["add", "fixture.js"], { cwd: diffCwd, env: gitEnv });
  await runChecked("git", ["commit", "--quiet", "-m", "initial fixture"], { cwd: diffCwd, env: gitEnv });
  await writeFile(join(diffCwd, "fixture.js"), 'export const releaseMode = "after";\n');
  await writeSmokeConfig(diffCwd);

  const diffReview = await runChecked("rejudge", [], {
    cwd: diffCwd,
    env: context.runtimeEnv,
    input:
      "Review the working-tree diff against HEAD using git_diff. End with a final plain-text line " +
      "in the form DIFF_SMOKE_OK: VALUE, replacing VALUE with the raw new releaseMode string. " +
      "Use no quotes, backticks, bold markup, or trailing punctuation on that line.\n",
    timeoutMs: PROCESS_TIMEOUT_MS,
  });
  assertExactLine(diffReview.stdout, "DIFF_SMOKE_OK: after", "CLI diff review");
  console.log("[smoke] live cli diff review passed");
}

async function runPiTarget(context, live) {
  const cwd = "/tmp/rejudge-pi";
  await mkdir(cwd, { recursive: true });
  await writeSmokeConfig(cwd);

  const {
    DefaultPackageManager,
    DefaultResourceLoader,
    SettingsManager,
  } = await import("@earendil-works/pi-coding-agent");

  const settingsManager = SettingsManager.inMemory({ packages: [context.packageRoot] });
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: context.agentDir,
    settingsManager,
  });
  const resolved = await packageManager.resolve();
  const packageExtensions = resolved.extensions.filter(
    (resource) => resource.enabled && resource.path.startsWith(context.packageRoot),
  );
  const packageSkills = resolved.skills.filter(
    (resource) => resource.enabled && resource.path.startsWith(context.packageRoot),
  );

  assert.deepEqual(
    packageExtensions.map((resource) => resource.path),
    [join(context.packageRoot, "dist/extension.js")],
  );
  assert.deepEqual(
    packageSkills.map((resource) => resource.path).sort(),
    [
      join(context.packageRoot, "docs/skills/rejudge-diff/SKILL.md"),
      join(context.packageRoot, "docs/skills/rejudge/SKILL.md"),
    ].sort(),
  );

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: context.agentDir,
    settingsManager,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload({ resolveProjectTrust: async () => true });

  const extensions = loader.getExtensions();
  assert.deepEqual(extensions.errors, []);
  const tools = extensions.extensions.flatMap((extension) => [...extension.tools.values()]);
  const tool = tools.find((candidate) => candidate.definition.name === "rejudge");
  assert.ok(tool, "installed Pi extension must register rejudge");

  const loadedSkills = loader.getSkills();
  const skills = loadedSkills.skills.filter((skill) => skill.filePath.startsWith(context.packageRoot));
  assert.deepEqual(skills.map((skill) => skill.name).sort(), ["rejudge", "rejudge-diff"]);
  assert.deepEqual(
    loadedSkills.diagnostics.filter((diagnostic) =>
      String(diagnostic.path ?? "").startsWith(context.packageRoot),
    ),
    [],
  );
  console.log("[smoke] Pi package, extension, tool, and skills discovery passed");

  if (!live) {
    return;
  }

  const result = await tool.definition.execute(
    "package-smoke",
    {
      question: "Calculate 3 + 4.",
      outputInstructions: "End with the exact line PI_SMOKE_OK: 7",
    },
    AbortSignal.timeout(PROCESS_TIMEOUT_MS),
    undefined,
    { cwd },
  );
  const text = result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  assertExactLine(text, "PI_SMOKE_OK: 7", "Pi rejudge tool");
  console.log("[smoke] live Pi tool call passed");
}

async function runNoKeyProbe(context) {
  for (const name of CREDENTIAL_ENV) {
    assert.equal(context.runtimeEnv[name], undefined, `${name} must be absent from the model process`);
  }

  const cwd = "/tmp/rejudge-no-key";
  await mkdir(cwd, { recursive: true });
  await writeSmokeConfig(cwd);
  const result = await runProcess("rejudge", [], {
    cwd,
    env: context.runtimeEnv,
    input: "Return NO_KEY_PROBE_OK.\n",
    timeoutMs: PROCESS_TIMEOUT_MS,
  });

  assert.equal(result.timedOut, false, "missing-authentication probe timed out");
  assert.equal(result.signal, null, "missing-authentication probe ended by signal");
  assert.notEqual(result.code, 0, "missing-authentication probe unexpectedly succeeded");
  assert.equal(result.stdout.trim(), "", "missing-authentication probe returned an answer");
  assert.match(result.stderr, /rejudge:\s+.+/is, "missing-authentication failure was not handled by Rejudge");
  assert.match(
    result.stderr,
    /api[ -]?key|authentication|credentials|unauthorized/i,
    "missing-authentication failure did not explain the credential problem",
  );
  console.log("[smoke] no-key authentication failure passed");
}

async function runContainer(options) {
  const context = await installPackedArtifact(options.noKey);
  const selected = options.target === "all" ? TARGETS : [options.target];
  const handlers = { cli: runCliTarget, pi: runPiTarget };

  for (const target of selected) {
    await handlers[target](context, !options.noKey);
  }
  if (options.noKey) {
    await runNoKeyProbe(context);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (options.container) {
    await runContainer(options);
    return;
  }
  await runHost(options);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[smoke] failed: ${redactCredentials(message)}`);
  process.exitCode = 1;
});
