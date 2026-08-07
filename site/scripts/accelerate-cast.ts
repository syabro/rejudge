import { readFileSync, renameSync, writeFileSync } from "node:fs";

const [path, startArg, endArg, factorArg] = process.argv.slice(2);
if (!path || !startArg || !endArg || !factorArg) {
  throw new Error("usage: bun site/scripts/accelerate-cast.ts <cast> <start-seconds> <end-seconds> <factor>");
}

const start = Number(startArg);
const end = Number(endArg);
const factor = Number(factorArg);
if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(factor) || start < 0 || end <= start || factor <= 1) {
  throw new Error(`invalid acceleration range for ${path}: start=${startArg}, end=${endArg}, factor=${factorArg}`);
}

const lines = readFileSync(path, "utf8").trimEnd().split("\n");
const header = JSON.parse(lines[0]);
if (header.version !== 2) {
  throw new Error(`unsupported asciicast version in ${path}: expected 2, got ${String(header.version)}`);
}

const savedTime = (end - start) * (1 - 1 / factor);
const events = lines.slice(1).map((line, index) => {
  const event = JSON.parse(line);
  if (!Array.isArray(event) || typeof event[0] !== "number") {
    throw new Error(`invalid asciicast event in ${path} at line ${index + 2}`);
  }

  const time = event[0];
  if (time > end) {
    event[0] = time - savedTime;
  } else if (time > start) {
    event[0] = start + (time - start) / factor;
  }
  return event;
});

const output = [JSON.stringify(header), ...events.map((event) => JSON.stringify(event)), ""].join("\n");
const temporaryPath = `${path}.tmp`;
writeFileSync(temporaryPath, output);
renameSync(temporaryPath, path);

console.log(`Accelerated ${path} from ${start}s to ${end}s by ${factor}x; saved ${savedTime.toFixed(3)}s.`);
