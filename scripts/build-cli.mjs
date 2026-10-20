#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PI_PACKAGE_JSON = resolve(ROOT, "node_modules/@earendil-works/pi-coding-agent/package.json");
const outputArgument = process.argv[2];

if (!outputArgument) {
  throw new Error("build-cli requires an output path, for example bin/rejudge.js");
}

const outputPath = resolve(ROOT, outputArgument);
const piManifest = JSON.parse(await readFile(PI_PACKAGE_JSON, "utf8"));
const piVersion = piManifest.version;
if (typeof piVersion !== "string" || piVersion.length === 0) {
  throw new Error(`Pi package manifest ${PI_PACKAGE_JSON} has no version`);
}

const marker = `// rejudge-bundled-pi-sdk:${piVersion}`;
await run("bun", [
  "build",
  "src/cli.ts",
  "--target=node",
  "--outfile",
  outputArgument,
  "--footer",
  marker,
]);

const bundle = await readFile(outputPath, "utf8");
if (!bundle.startsWith("#!/usr/bin/env node\n")) {
  throw new Error(`CLI bundle ${outputPath} lost its Node shebang`);
}
if (!bundle.includes(marker)) {
  throw new Error(`CLI bundle ${outputPath} does not contain Pi SDK marker ${JSON.stringify(marker)}`);
}

await run(process.execPath, ["--check", outputPath]);
await chmod(outputPath, 0o755);

async function run(command, args) {
  const result = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => resolvePromise({ code, signal }));
  });

  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.code ?? result.signal ?? "no status"}`);
  }
}
