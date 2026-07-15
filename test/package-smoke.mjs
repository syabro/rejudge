import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const SOURCES = ["tarball", "npm"];
const PI_PACKAGE = "@earendil-works/pi-coding-agent@0.80.6";
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

const USAGE = `usage: bun run smoke:package -- [cli|pi|all] [--source tarball|npm] [--tarball <path>] [--no-key]

  cli               test the installed CLI, including ordinary and diff reviews
  pi                test Pi package discovery, resource loading, and the rejudge tool
  all               run cli then pi (default)
  --source tarball  install a tarball in Docker (default)
  --source npm      install the manifest's exact version from public npm
  --tarball PATH    use this prebuilt tarball instead of building a temporary one
  --no-key          skip live answers and require a handled missing-authentication failure`;

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

async function sha512File(path) {
  const body = await readFile(path);
  return `sha512-${createHash("sha512").update(body).digest("base64")}`;
}

function parseOptions(argv) {
  const args = [...argv];
  let container = false;
  let noKey = false;
  let help = false;
  let source = "tarball";
  let sourceGiven = false;
  let tarball;
  let target;

  if (args[0] === "--container") {
    container = true;
    args.shift();
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
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
    if (arg === "--source" || arg.startsWith("--source=")) {
      if (sourceGiven) {
        throw new Error("--source given more than once");
      }
      const value = arg === "--source" ? args[++index] : arg.slice("--source=".length);
      if (!value || !SOURCES.includes(value)) {
        throw new Error(`--source must be one of: ${SOURCES.join(", ")}`);
      }
      source = value;
      sourceGiven = true;
      continue;
    }
    if (arg === "--tarball" || arg.startsWith("--tarball=")) {
      if (tarball !== undefined) {
        throw new Error("--tarball given more than once");
      }
      const value = arg === "--tarball" ? args[++index] : arg.slice("--tarball=".length);
      if (!value || (arg === "--tarball" && value.startsWith("-"))) {
        throw new Error("--tarball needs a path");
      }
      tarball = value;
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

  if (source === "npm" && tarball !== undefined) {
    throw new Error("--tarball cannot be combined with --source npm");
  }
  if (container && tarball !== undefined) {
    throw new Error("--tarball is a host-only option");
  }

  return { container, noKey, help, source, tarball, target: target ?? "all" };
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

  const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const hostTemp = await mkdtemp(join(tmpdir(), "rejudge-package-smoke-"));
  const buildContext = join(hostTemp, "docker-context");
  const cleanEnv = withoutCredentials(process.env);
  const dockerCleanEnv = dockerClientEnvironment(false);
  const containerName = `rejudge-package-smoke-${process.pid}-${Date.now()}`;
  let dockerStarted = false;
  let tarball;

  try {
    await mkdir(buildContext);

    if (options.source === "npm") {
      console.log(`[smoke] using public npm package ${manifest.name}@${manifest.version}`);
    } else if (options.tarball) {
      tarball = await realpath(resolve(process.cwd(), options.tarball));
      await access(tarball);
      console.log(`[smoke] using prebuilt tarball ${tarball}`);
    } else {
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

      tarball = join(hostTemp, report[0].filename);
      await access(tarball);
    }

    const initialDigest = tarball ? await sha512File(tarball) : undefined;

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
      "--env",
      `REJUDGE_SMOKE_PACKAGE_NAME=${manifest.name}`,
      "--env",
      `REJUDGE_SMOKE_PACKAGE_VERSION=${manifest.version}`,
    ];
    if (!options.noKey) {
      for (const name of CREDENTIAL_ENV) {
        dockerArgs.push("--env", name);
      }
    }
    if (tarball) {
      dockerArgs.push("--mount", `type=bind,src=${tarball},dst=/artifact/rejudge.tgz,readonly`);
    }
    dockerArgs.push(
      "--mount",
      `type=bind,src=${RUNNER_PATH},dst=/smoke/package-smoke.mjs,readonly`,
      "--workdir",
      "/smoke",
      IMAGE,
      "node",
      "/smoke/package-smoke.mjs",
      "--container",
      options.target,
      "--source",
      options.source,
    );
    if (options.noKey) {
      dockerArgs.push("--no-key");
    }

    const mode = options.noKey ? "without credentials" : "live";
    console.log(`[smoke] running ${options.target} target from ${options.source} ${mode}`);
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

    if (tarball && initialDigest) {
      assert.equal(await sha512File(tarball), initialDigest, "tarball changed while smoke was running");
      console.log(`[smoke] tarball sha512 ${initialDigest}`);
    }
    console.log(`[smoke] ${options.target} target from ${options.source} passed`);
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

async function prepareContainer(options) {
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const packageName = process.env.REJUDGE_SMOKE_PACKAGE_NAME;
  const packageVersion = process.env.REJUDGE_SMOKE_PACKAGE_VERSION;
  assert.ok(home && xdg && agentDir, "isolated HOME, XDG_CONFIG_HOME, and PI_CODING_AGENT_DIR are required");
  assert.ok(packageName && packageVersion, "expected package name and version are required");

  if (options.noKey) {
    for (const name of CREDENTIAL_ENV) {
      assert.equal(process.env[name], undefined, `${name} must be absent in --no-key mode`);
    }
    await assertEmptyDirectory(xdg, "XDG config directory");
    await assertEmptyDirectory(agentDir, "Pi agent directory");
  }

  const context = { agentDir, packageName, packageVersion, source: options.source };
  if (options.source === "npm") {
    await assert.rejects(access("/artifact/rejudge.tgz"), (error) => error?.code === "ENOENT");
    console.log(`[smoke] no tarball mounted; registry source is ${packageName}@${packageVersion}`);
    return context;
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

  const packageRoot = join("/smoke/node_modules", packageName);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.version, packageVersion);

  const runtimeEnv = {
    ...process.env,
    PATH: `/smoke/node_modules/.bin:${process.env.PATH ?? ""}`,
  };
  const resolvedBin = await runChecked("sh", ["-c", "command -v rejudge"], { env: runtimeEnv });
  assert.equal(resolvedBin.stdout.trim(), "/smoke/node_modules/.bin/rejudge");

  console.log(`[smoke] installed ${manifest.name}@${manifest.version} tarball and resolved bare rejudge from PATH`);
  return {
    ...context,
    cliRuntimeEnv: runtimeEnv,
    piPackageRoot: packageRoot,
    piPackageSource: packageRoot,
  };
}

async function readExpectedManifest(packageRoot, context) {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, context.packageName);
  assert.equal(manifest.version, context.packageVersion);
}

function registrySpec(context) {
  return `${context.packageName}@${context.packageVersion}`;
}

async function installRegistryCli(context) {
  const installEnv = withoutCredentials(process.env);
  await runChecked("npm", ["install", "-g", registrySpec(context)], {
    env: installEnv,
    timeoutMs: SETUP_TIMEOUT_MS,
  });

  const globalRoot = (await runChecked("npm", ["root", "-g"], { env: installEnv })).stdout.trim();
  const packageRoot = await realpath(join(globalRoot, context.packageName));
  assert.equal(packageRoot.startsWith(`${globalRoot}/`), true, "CLI package must live under the global npm root");
  assert.equal(packageRoot.startsWith("/smoke/"), false, "CLI package resolved from smoke workspace");
  await readExpectedManifest(packageRoot, context);

  const runtimeEnv = { ...process.env };
  const resolvedBin = (await runChecked("sh", ["-c", "command -v rejudge"], { env: runtimeEnv })).stdout.trim();
  const realBin = await realpath(resolvedBin);
  assert.equal(realBin.startsWith(`${packageRoot}/`), true, "bare rejudge must resolve into the registry package");

  context.cliRuntimeEnv = runtimeEnv;
  context.cliPackageRoot = packageRoot;
  console.log(`[smoke] npm installed ${registrySpec(context)} for CLI at ${packageRoot}`);
}

async function importGlobalPiSdk(installEnv) {
  const globalRoot = (await runChecked("npm", ["root", "-g"], { env: installEnv })).stdout.trim();
  const piRoot = await realpath(join(globalRoot, "@earendil-works/pi-coding-agent"));
  const sdkEntry = await realpath(join(piRoot, "dist/index.js"));
  assert.equal(sdkEntry.startsWith(`${piRoot}/`), true, "Pi SDK must resolve from its global npm install");
  return { piRoot, sdk: await import(pathToFileURL(sdkEntry).href) };
}

async function installRegistryPi(context) {
  const installEnv = withoutCredentials(process.env);
  await runChecked("npm", ["install", "-g", "--ignore-scripts", PI_PACKAGE], {
    env: installEnv,
    timeoutMs: SETUP_TIMEOUT_MS,
  });

  const packageSource = `npm:${registrySpec(context)}`;
  await runChecked("pi", ["install", packageSource], {
    env: installEnv,
    timeoutMs: SETUP_TIMEOUT_MS,
  });

  const settingsPath = join(context.agentDir, "settings.json");
  const persisted = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(persisted.packages, [packageSource], "Pi must persist only the exact npm package source");

  const packageRoot = await realpath(join(context.agentDir, "npm/node_modules", context.packageName));
  const expectedRoot = join(context.agentDir, "npm/node_modules");
  assert.equal(packageRoot.startsWith(`${expectedRoot}/`), true, "Pi package must live under isolated npm state");
  assert.equal(packageRoot.startsWith("/smoke/"), false, "Pi package resolved from smoke workspace");
  await readExpectedManifest(packageRoot, context);

  const { piRoot, sdk } = await importGlobalPiSdk(installEnv);
  context.piPackageRoot = packageRoot;
  context.piPackageSource = packageSource;
  context.piSdk = sdk;
  console.log(`[smoke] Pi installed ${packageSource} at ${packageRoot} using SDK ${piRoot}`);
}

async function runCliTarget(context, live) {
  if (context.source === "npm") {
    await installRegistryCli(context);
  }
  const runtimeEnv = context.cliRuntimeEnv;
  assert.ok(runtimeEnv, "CLI runtime environment is required");

  const help = await runChecked("rejudge", ["--help"], { env: runtimeEnv });
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
    env: runtimeEnv,
    input: "Calculate 2 + 2. End with the exact line CLI_SMOKE_OK: 4\n",
    timeoutMs: PROCESS_TIMEOUT_MS,
  });
  assertExactLine(ordinary.stdout, "CLI_SMOKE_OK: 4", "ordinary CLI review");
  console.log("[smoke] live cli review passed");

  const diffCwd = "/tmp/rejudge-diff";
  await mkdir(diffCwd, { recursive: true });
  const gitEnv = withoutCredentials(runtimeEnv);
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
    env: runtimeEnv,
    input:
      "Review the working-tree diff against HEAD using git_diff. End with a final plain-text line " +
      "in the form DIFF_SMOKE_OK: VALUE, replacing VALUE with the raw new releaseMode string. " +
      "Use no quotes, backticks, bold markup, or trailing punctuation on that line.\n",
    timeoutMs: PROCESS_TIMEOUT_MS,
  });
  assertExactLine(diffReview.stdout, "DIFF_SMOKE_OK: after", "CLI diff review");
  console.log("[smoke] live cli diff review passed");
}

function assertRegistrySourceInfo(sourceInfo, context, label) {
  if (context.source !== "npm") {
    return;
  }
  assert.equal(sourceInfo.source, context.piPackageSource, `${label} source`);
  assert.equal(sourceInfo.scope, "user", `${label} scope`);
  assert.equal(sourceInfo.origin, "package", `${label} origin`);
  assert.equal(sourceInfo.path.startsWith(context.piPackageRoot), true, `${label} path`);
}

async function runPiTarget(context, live) {
  const cwd = "/tmp/rejudge-pi";
  await mkdir(cwd, { recursive: true });
  await writeSmokeConfig(cwd);

  if (context.source === "npm") {
    await installRegistryPi(context);
  }
  const packageRoot = context.piPackageRoot;
  const packageSource = context.piPackageSource;
  assert.ok(packageRoot && packageSource, "Pi package root and source are required");

  const sdk = context.piSdk ?? await import("@earendil-works/pi-coding-agent");
  const { DefaultPackageManager, DefaultResourceLoader, SettingsManager } = sdk;
  const settingsManager = context.source === "npm"
    ? SettingsManager.create(cwd, context.agentDir, { projectTrusted: true })
    : SettingsManager.inMemory({ packages: [packageSource] });
  if (context.source === "npm") {
    await settingsManager.reload();
    assert.deepEqual(settingsManager.getGlobalSettings().packages, [packageSource]);
  }

  const packageManager = new DefaultPackageManager({ cwd, agentDir: context.agentDir, settingsManager });
  const resolved = await packageManager.resolve();
  const packageExtensions = resolved.extensions.filter(
    (resource) => resource.enabled && resource.path.startsWith(packageRoot),
  );
  const packageSkills = resolved.skills.filter(
    (resource) => resource.enabled && resource.path.startsWith(packageRoot),
  );

  assert.deepEqual(packageExtensions.map((resource) => resource.path), [join(packageRoot, "dist/extension.js")]);
  assert.deepEqual(
    packageSkills.map((resource) => resource.path).sort(),
    [join(packageRoot, "docs/skills/rejudge-diff/SKILL.md"), join(packageRoot, "docs/skills/rejudge/SKILL.md")].sort(),
  );
  for (const resource of [...packageExtensions, ...packageSkills]) {
    assertRegistrySourceInfo({ ...resource.metadata, path: resource.path }, context, "resolved Pi resource");
  }

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
  const packageExtension = extensions.extensions.find((extension) => extension.path.startsWith(packageRoot));
  assert.ok(packageExtension, "installed Pi extension must load from the package root");
  assertRegistrySourceInfo(packageExtension.sourceInfo, context, "loaded extension");

  const tool = [...packageExtension.tools.values()].find((candidate) => candidate.definition.name === "rejudge");
  assert.ok(tool, "installed Pi extension must register rejudge");
  assertRegistrySourceInfo(tool.sourceInfo, context, "registered tool");

  const loadedSkills = loader.getSkills();
  const skills = loadedSkills.skills.filter((skill) => skill.filePath.startsWith(packageRoot));
  assert.deepEqual(skills.map((skill) => skill.name).sort(), ["rejudge", "rejudge-diff"]);
  for (const skill of skills) {
    assertRegistrySourceInfo(skill.sourceInfo, context, `loaded skill ${skill.name}`);
  }
  assert.deepEqual(
    loadedSkills.diagnostics.filter((diagnostic) => String(diagnostic.path ?? "").startsWith(packageRoot)),
    [],
  );
  context.piTool = tool;
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
    assert.equal(process.env[name], undefined, `${name} must be absent from the model process`);
  }

  const cwd = "/tmp/rejudge-no-key";
  await mkdir(cwd, { recursive: true });
  await writeSmokeConfig(cwd);

  if (!context.cliRuntimeEnv) {
    assert.ok(context.piTool, "Pi tool is required when the CLI target was not installed");
    const result = await context.piTool.definition.execute(
      "package-smoke-no-key",
      { question: "Return NO_KEY_PROBE_OK." },
      AbortSignal.timeout(PROCESS_TIMEOUT_MS),
      undefined,
      { cwd },
    );
    const text = result.content.filter((content) => content.type === "text").map((content) => content.text).join("\n");
    assert.match(text, /rejudge failed:/i, "missing-authentication failure was not handled by the Pi tool");
    assert.match(text, /api[ -]?key|authentication|credentials|unauthorized/i, "Pi failure did not explain authentication");
    console.log("[smoke] no-key Pi authentication failure passed");
    return;
  }

  const result = await runProcess("rejudge", [], {
    cwd,
    env: context.cliRuntimeEnv,
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
  console.log("[smoke] no-key CLI authentication failure passed");
}

async function runContainer(options) {
  const context = await prepareContainer(options);
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
