#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_PATH = join(ROOT, "package.json");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const PI_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
const PI_HOST_PACKAGE = "@earendil-works/pi-coding-agent";
const RELEASE_SCHEMA = "1";
const BASELINE = {
  version: "0.5.1",
  commit: "0c830b3be718a5537bad3bdf506903f9116cb5bd",
  integrity: "sha512-UintvgNN4+TOnn+3qrcqZTVHAmFOpbLnue0munF2okZ9LnNm51JS9qUedLecrMuRIJ+TJtUz9s1PNURp4z/CPA==",
};
const EXPECTED_PACKAGE_FILES = [
  "package/LICENSE",
  "package/README.md",
  "package/bin/rejudge.js",
  "package/dist/extension.js",
  "package/docs/skills/rejudge-diff/SKILL.md",
  "package/docs/skills/rejudge/SKILL.md",
  "package/package.json",
];
const SMOKES = ["cli", "pi-new", "pi-floor"];
const REGISTRY_RETRIES = 4;

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  await main(process.argv[2], process.argv.slice(3));
}

async function main(command, args) {
  switch (command) {
    case "classify":
      return classify();
    case "verify-installed":
      return verifyInstalled();
    case "peer-floor":
      return printPeerFloor();
    case "prepend-changelog":
      return prependChangelog(args);
    case "verify-release-diff":
      return verifyReleaseDiff();
    case "inspect-tarball":
      return inspectTarballCommand(args);
    case "write-manifest":
      return writeManifestCommand(args);
    case "create-tag":
      return createTag(args);
    case "read-tag":
      return readTagCommand(args);
    case "verify-files":
      return verifyFilesCommand(args);
    case "release-download":
      return releaseDownload(args);
    case "artifact-download":
      return artifactDownload(args);
    case "release-reconcile":
      return releaseReconcile(args);
    case "release-finalize":
      return releaseFinalize(args);
    case "restore-npm":
      return restoreFromNpm(args);
    case "registry-prepublish":
      return registryPrepublish(args);
    case "registry-verify":
      return registryVerifyCommand(args);
    case "verify-recovery-deps":
      return verifyRecoveryDependencies(args);
    default:
      throw new Error(`Unknown pi-autorelease command ${JSON.stringify(command ?? "")}`);
  }
}

async function classify() {
  const manifest = await readJson(PACKAGE_PATH);
  const localVersion = requireStableVersion(manifest.version, `${PACKAGE_PATH} version`);
  const currentPins = readPiPins(manifest, PACKAGE_PATH);
  const currentPi = onePiVersion(currentPins, PACKAGE_PATH);
  const rejudge = await registryDocument(manifest.name);
  const registryVersion = highestStableVersion(rejudge);
  const registryLatest = requireStableVersion(rejudge["dist-tags"]?.latest, `${manifest.name} latest tag`);

  if (registryVersion !== registryLatest) {
    throw new Error(`${manifest.name} registry disagrees: highest stable ${registryVersion}, latest ${registryLatest}`);
  }

  const versionOrder = compareVersions(localVersion, registryVersion);
  if (versionOrder < 0) {
    return emitState("blocked", {
      localVersion,
      registryVersion,
      currentPi,
      reason: `${PACKAGE_PATH} version ${localVersion} is behind npm ${registryVersion}`,
    });
  }

  const tag = validateVersionTag(localVersion);
  const published = rejudge.versions?.[localVersion];
  if (versionOrder > 0) {
    if (published) {
      throw new Error(`${manifest.name}@${localVersion} is above registry ${registryVersion} but already exists`);
    }
    const metadata = validateAutomatedTag(localVersion, tag);
    return emitState("recovery", { localVersion, registryVersion, currentPi, ...tagOutputs(metadata) });
  }

  if (!published) {
    throw new Error(`${manifest.name}@${localVersion} is the registry head but its manifest is missing`);
  }
  const automated = validatePublishedRelease(localVersion, tag, published, registryLatest);
  if (automated) {
    const release = await findRelease(`v${localVersion}`);
    if (!release || release.draft) {
      return emitState("finalize", { localVersion, registryVersion, currentPi, ...tagOutputs(automated) });
    }
    assertReleaseAssetNames(release, localVersion);
  }

  const latestPins = {};
  for (const packageName of PI_PACKAGES) {
    const document = await registryDocument(packageName);
    latestPins[packageName] = requireStableVersion(
      document["dist-tags"]?.latest,
      `${packageName} latest tag`,
    );
  }
  const latestVersions = [...new Set(Object.values(latestPins))];
  if (latestVersions.length !== 1) {
    return emitState("diverged", {
      localVersion,
      registryVersion,
      currentPi,
      piVersions: JSON.stringify(latestPins),
    });
  }

  const latestPi = latestVersions[0];
  const latestParts = parseStableVersion(latestPi);
  if (latestParts.major !== 1) {
    return emitState("blocked", {
      localVersion,
      registryVersion,
      currentPi,
      piVersion: latestPi,
      reason: `Pi latest ${latestPi} is outside the automatic major-1 policy`,
    });
  }

  const piOrder = compareVersions(latestPi, currentPi);
  if (piOrder < 0) {
    throw new Error(`Pi registry latest ${latestPi} is behind the pinned version ${currentPi}`);
  }
  if (piOrder === 0) {
    return emitState("noop", { localVersion, registryVersion, currentPi });
  }

  const registryParts = parseStableVersion(registryVersion);
  const releaseVersion = `${registryParts.major}.${registryParts.minor}.${registryParts.patch + 1}`;
  return emitState("fresh", {
    localVersion,
    registryVersion,
    releaseVersion,
    currentPi,
    piVersion: latestPi,
    baseCommit: git(["rev-parse", "origin/main"]),
  });
}

async function verifyInstalled() {
  const manifest = await readJson(PACKAGE_PATH);
  const pins = readPiPins(manifest, PACKAGE_PATH);
  for (const [packageName, expected] of Object.entries(pins)) {
    const installedPath = join(ROOT, "node_modules", ...packageName.split("/"), "package.json");
    const installed = await readJson(installedPath);
    if (installed.version !== expected) {
      throw new Error(`${packageName} is pinned to ${expected} but ${installedPath} contains ${installed.version}`);
    }
  }
  console.log(`Verified installed Pi packages at ${onePiVersion(pins, PACKAGE_PATH)}`);
}

async function printPeerFloor() {
  const manifest = await readJson(PACKAGE_PATH);
  console.log(readPeerFloor(manifest, PACKAGE_PATH));
}

async function prependChangelog([version, oldPi, newPi]) {
  requireStableVersion(version, "release version");
  requireStableVersion(oldPi, "old Pi version");
  requireStableVersion(newPi, "new Pi version");
  const changelog = await readFile(CHANGELOG_PATH, "utf8");
  const heading = `## ${version} —`;
  if (changelog.includes(heading)) {
    throw new Error(`${CHANGELOG_PATH} already contains release ${version}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const entry = `## ${version} — ${date}\n\n### Changed\n\n- The standalone CLI now bundles Pi SDK ${newPi} instead of ${oldPi}.\n\n`;
  const prefix = "# Changelog\n\n";
  if (!changelog.startsWith(prefix)) {
    throw new Error(`${CHANGELOG_PATH} must start with ${JSON.stringify(prefix)}`);
  }
  await writeFile(CHANGELOG_PATH, `${prefix}${entry}${changelog.slice(prefix.length)}`);
}

function verifyReleaseDiff() {
  const expected = ["CHANGELOG.md", "bun.lock", "package.json"];
  const changed = git(["diff", "--name-only"]).split("\n").filter(Boolean).sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    throw new Error(`Release update changed ${JSON.stringify(changed)}; expected ${JSON.stringify(expected)}`);
  }

  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  if (untracked.length > 0) {
    throw new Error(`Release update created untracked files: ${untracked.join(", ")}`);
  }
}

async function inspectTarballCommand([tarball]) {
  const details = await inspectTarball(requiredArgument(tarball, "tarball path"));
  emitOutputs(details);
  console.log(JSON.stringify(details));
}

async function writeManifestCommand([tarball, outputPath]) {
  tarball = requiredArgument(tarball, "tarball path");
  outputPath = requiredArgument(outputPath, "manifest output path");
  const details = await inspectTarball(tarball);
  const commit = git(["rev-parse", "HEAD"]);
  const releaseManifest = releaseManifestData(details.version, details.piVersion, commit, details.filename, details.integrity);
  await writeFile(outputPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
  const manifestIntegrity = await sriFile(outputPath);
  emitOutputs({ ...details, commit, manifestIntegrity, manifest: outputPath });
}

async function createTag([version, manifestPath, artifactId]) {
  version = requireStableVersion(version, "release version");
  manifestPath = requiredArgument(manifestPath, "manifest path");
  artifactId = requiredDigits(artifactId, "artifact ID");
  const releaseManifest = await readJson(manifestPath);
  validateReleaseManifest(releaseManifest, version);
  const manifestIntegrity = await sriFile(manifestPath);
  const runId = requiredDigits(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  const tag = `v${version}`;
  const message = [
    `Rejudge ${tag}`,
    "",
    `rejudge-release-schema=${RELEASE_SCHEMA}`,
    `version=${version}`,
    `pi-version=${releaseManifest.piVersion}`,
    `commit=${releaseManifest.commit}`,
    `tarball=${releaseManifest.tarball}`,
    `tarball-integrity=${releaseManifest.tarballIntegrity}`,
    `manifest-integrity=${manifestIntegrity}`,
    `run-id=${runId}`,
    `artifact-id=${artifactId}`,
    `smokes=${SMOKES.join(",")}`,
    "",
  ].join("\n");
  const messagePath = join(tmpdir(), `rejudge-${version}-tag-${process.pid}.txt`);
  await writeFile(messagePath, message);
  try {
    git(["tag", "--annotate", tag, "--file", messagePath]);
  } finally {
    await rm(messagePath, { force: true });
  }
  console.log(`Created annotated ${tag}`);
}

function readTagCommand([version]) {
  version = requireStableVersion(version, "release version");
  const tag = validateVersionTag(version);
  const metadata = validateAutomatedTag(version, tag);
  const outputs = { ...tag, ...tagOutputs(metadata) };
  emitOutputs(outputs);
  console.log(JSON.stringify(outputs));
}

async function verifyFilesCommand([directory, version]) {
  const result = await verifyReleaseFiles(
    requiredArgument(directory, "release files directory"),
    requireStableVersion(version, "release version"),
  );
  emitOutputs(result);
  console.log(JSON.stringify(result));
}

async function releaseDownload([version, directory]) {
  version = requireStableVersion(version, "release version");
  directory = requiredArgument(directory, "release files directory");
  const release = await findRelease(`v${version}`);
  if (!release) {
    return emitOutputs({ complete: "false", releaseId: "", releaseDraft: "" });
  }

  validateReleaseIdentity(release, version);
  const metadata = validateAutomatedTag(version, validateVersionTag(version));
  assertReleaseAssetSubset(release, version);
  for (const asset of release.assets) {
    await downloadReleaseAsset(asset, join(directory, asset.name));
    await verifyAssetIntegrity(asset.name, join(directory, asset.name), metadata, version);
  }

  const names = new Set(release.assets.map((asset) => asset.name));
  const complete = expectedReleaseFiles(version).every((name) => names.has(name));
  if (complete) {
    await verifyReleaseFiles(directory, version);
  }
  emitOutputs({ complete: String(complete), releaseId: String(release.id), releaseDraft: String(release.draft) });
}

async function artifactDownload([version, directory]) {
  version = requireStableVersion(version, "release version");
  directory = requiredArgument(directory, "release files directory");
  const metadata = validateAutomatedTag(version, validateVersionTag(version));
  const apiPath = `/repos/${githubRepository()}/actions/artifacts/${metadata.artifactId}`;
  const response = await fetch(`https://api.github.com${apiPath}`, { headers: githubHeaders() });
  if (response.status === 404 || response.status === 410) {
    return emitOutputs({ complete: "false" });
  }
  if (!response.ok) {
    throw new Error(`GitHub artifact ${metadata.artifactId} returned HTTP ${response.status}`);
  }

  const artifact = await response.json();
  if (artifact.expired) {
    return emitOutputs({ complete: "false" });
  }
  if (String(artifact.workflow_run?.id ?? "") !== metadata.runId) {
    throw new Error(`GitHub artifact ${metadata.artifactId} belongs to run ${artifact.workflow_run?.id}, expected ${metadata.runId}`);
  }

  const archive = await githubRequest(artifact.archive_download_url, {
    accept: "application/vnd.github+json",
    raw: true,
  });
  const zipPath = join(tmpdir(), `rejudge-artifact-${metadata.artifactId}-${process.pid}.zip`);
  await writeFile(zipPath, Buffer.from(await archive.arrayBuffer()));
  try {
    const unpack = spawnSync("unzip", ["-o", "-q", zipPath, "-d", directory], { encoding: "utf8" });
    if (unpack.status !== 0) {
      throw new Error(`Could not unpack GitHub artifact ${metadata.artifactId}: ${(unpack.stderr || unpack.stdout).trim()}`);
    }
  } finally {
    await rm(zipPath, { force: true });
  }

  await verifyReleaseFiles(directory, version);
  emitOutputs({ complete: "true" });
}

async function releaseReconcile([version, directory]) {
  version = requireStableVersion(version, "release version");
  directory = requiredArgument(directory, "release files directory");
  await verifyReleaseFiles(directory, version);
  const tag = `v${version}`;
  let release = await findRelease(tag);
  if (!release) {
    release = await githubRequest(`/repos/${githubRepository()}/releases`, {
      method: "POST",
      body: {
        tag_name: tag,
        name: releaseTitle(version),
        body: await changelogNotes(version),
        draft: true,
        prerelease: false,
      },
    });
  }

  validateReleaseIdentity(release, version);
  if (!release.draft) {
    throw new Error(`GitHub Release ${tag} is public before npm publication`);
  }
  assertReleaseAssetSubset(release, version);

  const metadata = validateAutomatedTag(version, validateVersionTag(version));
  const existing = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const name of expectedReleaseFiles(version)) {
    const localPath = join(directory, name);
    const asset = existing.get(name);
    if (asset) {
      const tempPath = join(tmpdir(), `rejudge-asset-${asset.id}-${name}`);
      await downloadReleaseAsset(asset, tempPath);
      try {
        await verifyAssetIntegrity(name, tempPath, metadata, version);
      } finally {
        await rm(tempPath, { force: true });
      }
      continue;
    }
    await uploadReleaseAsset(release, name, localPath);
  }

  release = await githubRequest(`/repos/${githubRepository()}/releases/${release.id}`);
  assertReleaseAssetNames(release, version);
  emitOutputs({ releaseId: String(release.id) });
}

async function releaseFinalize([version]) {
  version = requireStableVersion(version, "release version");
  const release = await findRelease(`v${version}`);
  if (!release) {
    throw new Error(`GitHub Release v${version} does not exist`);
  }
  validateReleaseIdentity(release, version);
  assertReleaseAssetNames(release, version);

  const temp = await mkdtemp(join(tmpdir(), `rejudge-finalize-${version}-`));
  try {
    for (const asset of release.assets) {
      await downloadReleaseAsset(asset, join(temp, asset.name));
    }
    await verifyReleaseFiles(temp, version);
    await waitForRegistryVersion(version);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  if (!release.draft) {
    console.log(`GitHub Release v${version} is already public`);
    return;
  }
  const published = await githubRequest(`/repos/${githubRepository()}/releases/${release.id}`, {
    method: "PATCH",
    body: { draft: false },
  });
  if (published.draft !== false || published.tag_name !== `v${version}`) {
    throw new Error(`GitHub Release ${release.id} did not become public for v${version}`);
  }
  console.log(`Published GitHub Release v${version}`);
}

async function restoreFromNpm([version, directory]) {
  version = requireStableVersion(version, "release version");
  directory = requiredArgument(directory, "release files directory");
  const metadata = validateAutomatedTag(version, validateVersionTag(version));
  const document = await registryDocument("rejudge");
  const published = document.versions?.[version];
  if (!published) {
    throw new Error(`Cannot restore rejudge@${version}: npm version is absent`);
  }
  if (published.dist?.integrity !== metadata.tarballIntegrity) {
    throw new Error(`Cannot restore rejudge@${version}: npm integrity ${published.dist?.integrity} differs from tag ${metadata.tarballIntegrity}`);
  }

  const tarballPath = join(directory, metadata.tarball);
  const response = await fetchChecked(published.dist.tarball, {}, `npm tarball rejudge@${version}`);
  await writeFile(tarballPath, Buffer.from(await response.arrayBuffer()));
  if (await sriFile(tarballPath) !== metadata.tarballIntegrity) {
    throw new Error(`Downloaded npm tarball ${tarballPath} does not match ${metadata.tarballIntegrity}`);
  }

  const manifest = releaseManifestData(version, metadata.piVersion, metadata.commit, metadata.tarball, metadata.tarballIntegrity);
  const manifestPath = join(directory, manifestFilename(version));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (await sriFile(manifestPath) !== metadata.manifestIntegrity) {
    throw new Error(`Reconstructed manifest ${manifestPath} does not match ${metadata.manifestIntegrity}`);
  }
  await verifyReleaseFiles(directory, version);
}

async function registryPrepublish([version]) {
  version = requireStableVersion(version, "release version");
  const document = await registryDocument("rejudge");
  if (document.versions?.[version]) {
    throw new Error(`rejudge@${version} already exists immediately before publish`);
  }
  const highest = highestStableVersion(document);
  const latest = requireStableVersion(document["dist-tags"]?.latest, "rejudge latest tag");
  if (compareVersions(highest, version) > 0 || compareVersions(latest, version) > 0) {
    throw new Error(`Refusing to publish ${version}: npm highest=${highest}, latest=${latest}`);
  }
}

async function registryVerifyCommand([version]) {
  await waitForRegistryVersion(requireStableVersion(version, "release version"));
}

async function waitForRegistryVersion(version) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await verifyRegistryVersion(version);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 12) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
      }
    }
  }
  throw new Error(`npm did not expose verified rejudge@${version} within 60 seconds: ${errorMessage(lastError)}`);
}

async function verifyRecoveryDependencies([version]) {
  version = requireStableVersion(version, "release version");
  const metadata = validateAutomatedTag(version, validateVersionTag(version));
  const document = await registryDocument(PI_HOST_PACKAGE);
  const manifestPath = `${metadata.commit}:package.json`;
  const manifest = JSON.parse(git(["show", manifestPath]));
  for (const piVersion of [metadata.piVersion, readPeerFloor(manifest, manifestPath)]) {
    if (!document.versions?.[piVersion]) {
      throw new Error(`${PI_HOST_PACKAGE}@${piVersion} required by recovery ${version} is absent from npm`);
    }
  }
}

async function inspectTarball(tarball, expectedRelease) {
  const manifestText = tarRead(tarball, "package/package.json");
  const manifest = JSON.parse(manifestText);
  const rootManifest = expectedRelease ? undefined : await readJson(PACKAGE_PATH);
  const expectedName = rootManifest?.name ?? "rejudge";
  const expectedVersion = expectedRelease?.version ?? rootManifest?.version;
  if (manifest.name !== expectedName || manifest.version !== expectedVersion) {
    throw new Error(`${tarball} contains ${manifest.name}@${manifest.version}, expected ${expectedName}@${expectedVersion}`);
  }

  const foundPins = readPiPins(manifest, `${tarball}:package/package.json`);
  const expectedPins = expectedRelease
    ? Object.fromEntries(PI_PACKAGES.map((packageName) => [packageName, expectedRelease.piVersion]))
    : readPiPins(rootManifest, PACKAGE_PATH);
  if (JSON.stringify(foundPins) !== JSON.stringify(expectedPins)) {
    throw new Error(`${tarball} Pi pins ${JSON.stringify(foundPins)} differ from ${JSON.stringify(expectedPins)}`);
  }

  const files = tarList(tarball).filter((path) => !path.endsWith("/")).sort();
  const expectedFiles = [...EXPECTED_PACKAGE_FILES].sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${tarball} files ${JSON.stringify(files)} differ from ${JSON.stringify(expectedFiles)}`);
  }

  const piVersion = onePiVersion(foundPins, `${tarball}:package/package.json`);
  const cli = tarRead(tarball, "package/bin/rejudge.js");
  const marker = `// rejudge-bundled-pi-sdk:${piVersion}`;
  if (!cli.startsWith("#!/usr/bin/env node\n") || !cli.includes(marker)) {
    throw new Error(`${tarball} CLI must keep its shebang and marker ${JSON.stringify(marker)}`);
  }

  return {
    filename: basename(tarball),
    integrity: await sriFile(tarball),
    version: manifest.version,
    piVersion,
  };
}

async function verifyReleaseFiles(directory, version) {
  const metadata = validateAutomatedTag(version, validateVersionTag(version));
  const expectedFiles = expectedReleaseFiles(version).sort();
  const files = (await readdir(directory)).filter((name) => !name.startsWith(".")).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${directory} contains ${JSON.stringify(files)}, expected ${JSON.stringify(expectedFiles)}`);
  }

  const tarballPath = join(directory, metadata.tarball);
  const details = await inspectTarball(tarballPath, { version, piVersion: metadata.piVersion });
  if (details.integrity !== metadata.tarballIntegrity) {
    throw new Error(`${tarballPath} integrity ${details.integrity} differs from tag ${metadata.tarballIntegrity}`);
  }

  const manifestPath = join(directory, manifestFilename(version));
  const manifestIntegrity = await sriFile(manifestPath);
  if (manifestIntegrity !== metadata.manifestIntegrity) {
    throw new Error(`${manifestPath} integrity ${manifestIntegrity} differs from tag ${metadata.manifestIntegrity}`);
  }
  const releaseManifest = await readJson(manifestPath);
  validateReleaseManifest(releaseManifest, version, metadata);
  return { ...details, manifestIntegrity, tarball: tarballPath, manifest: manifestPath };
}

async function verifyRegistryVersion(version) {
  const metadata = validateAutomatedTag(version, validateVersionTag(version));
  const document = await registryDocument("rejudge");
  const published = document.versions?.[version];
  if (!published) {
    throw new Error(`rejudge@${version} is not visible in npm`);
  }
  if (document["dist-tags"]?.latest !== version) {
    throw new Error(`npm latest is ${document["dist-tags"]?.latest}, expected ${version}`);
  }
  if (published.dist?.integrity !== metadata.tarballIntegrity) {
    throw new Error(`npm integrity ${published.dist?.integrity} differs from tag ${metadata.tarballIntegrity}`);
  }

  const response = await fetchChecked(published.dist.tarball, {}, `npm tarball rejudge@${version}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  const downloadedIntegrity = sri(downloaded);
  if (downloadedIntegrity !== metadata.tarballIntegrity) {
    throw new Error(`npm tarball rejudge@${version} has ${downloadedIntegrity}, expected ${metadata.tarballIntegrity}`);
  }
  console.log(`Verified npm rejudge@${version} at ${metadata.tarballIntegrity}`);
}

function validatePublishedRelease(version, tag, published, latest) {
  if (version === BASELINE.version) {
    if (tag.type !== "commit") {
      throw new Error(`Baseline ${version} must remain a lightweight tag, got ${tag.type}`);
    }
    if (tag.commit !== BASELINE.commit || published.gitHead !== BASELINE.commit) {
      throw new Error(`Baseline ${version} commit mismatch: tag=${tag.commit}, npm=${published.gitHead}`);
    }
    if (published.dist?.integrity !== BASELINE.integrity || latest !== BASELINE.version) {
      throw new Error(`Baseline ${version} registry metadata differs from the recorded release`);
    }
    return undefined;
  }

  const metadata = validateAutomatedTag(version, tag);
  if (published.dist?.integrity !== metadata.tarballIntegrity) {
    throw new Error(`rejudge@${version} integrity ${published.dist?.integrity} differs from tag ${metadata.tarballIntegrity}`);
  }
  if (published.gitHead && published.gitHead !== tag.commit) {
    throw new Error(`rejudge@${version} gitHead ${published.gitHead} differs from tag commit ${tag.commit}`);
  }
  return metadata;
}

function validateVersionTag(version) {
  const ref = `refs/tags/v${version}`;
  const commit = git(["rev-parse", `${ref}^{commit}`]);
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"], { cwd: ROOT });
  if (ancestor.status !== 0) {
    throw new Error(`${ref} commit ${commit} is not an ancestor of origin/main`);
  }

  const manifest = JSON.parse(git(["show", `${commit}:package.json`]));
  if (manifest.version !== version) {
    throw new Error(`${ref} commit ${commit} contains package version ${manifest.version}, expected ${version}`);
  }
  const type = git(["cat-file", "-t", ref]);
  return { ref, commit, type };
}

function validateAutomatedTag(version, tag) {
  if (tag.type !== "tag") {
    throw new Error(`Automated release v${version} must be an annotated tag, got ${tag.type}`);
  }
  const message = git(["for-each-ref", "--format=%(contents)", tag.ref]);
  const metadata = parseTagMessage(message);
  const expected = {
    schema: RELEASE_SCHEMA,
    version,
    commit: tag.commit,
    smokes: SMOKES.join(","),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) {
      throw new Error(`${tag.ref} metadata ${key}=${metadata[key]} differs from ${value}`);
    }
  }
  requireStableVersion(metadata.piVersion, `${tag.ref} Pi version`);
  requireIntegrity(metadata.tarballIntegrity, `${tag.ref} tarball integrity`);
  requireIntegrity(metadata.manifestIntegrity, `${tag.ref} manifest integrity`);
  requiredDigits(metadata.runId, `${tag.ref} run ID`);
  requiredDigits(metadata.artifactId, `${tag.ref} artifact ID`);
  if (metadata.tarball !== tarballFilename(version)) {
    throw new Error(`${tag.ref} tarball ${metadata.tarball} differs from ${tarballFilename(version)}`);
  }
  return metadata;
}

export function parseTagMessage(message) {
  const mapping = {
    "rejudge-release-schema": "schema",
    version: "version",
    "pi-version": "piVersion",
    commit: "commit",
    tarball: "tarball",
    "tarball-integrity": "tarballIntegrity",
    "manifest-integrity": "manifestIntegrity",
    "run-id": "runId",
    "artifact-id": "artifactId",
    smokes: "smokes",
  };
  const result = {};
  for (const line of message.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const rawKey = line.slice(0, separator);
    const key = mapping[rawKey];
    if (!key) continue;
    if (result[key] !== undefined) {
      throw new Error(`Release tag metadata repeats ${rawKey}`);
    }
    result[key] = line.slice(separator + 1);
  }
  for (const key of Object.values(mapping)) {
    if (!result[key]) {
      throw new Error(`Release tag metadata is missing ${key}`);
    }
  }
  return result;
}

function releaseManifestData(version, piVersion, commit, tarball, tarballIntegrity) {
  return {
    schemaVersion: 1,
    package: "rejudge",
    version,
    piVersion,
    commit,
    tarball,
    tarballIntegrity,
    smokes: SMOKES,
  };
}

function validateReleaseManifest(manifest, version, metadata) {
  const expected = {
    schemaVersion: 1,
    package: "rejudge",
    version,
    piVersion: metadata?.piVersion ?? manifest.piVersion,
    commit: metadata?.commit ?? manifest.commit,
    tarball: metadata?.tarball ?? tarballFilename(version),
    tarballIntegrity: metadata?.tarballIntegrity ?? manifest.tarballIntegrity,
    smokes: SMOKES,
  };
  const foundKeys = Object.keys(manifest).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(foundKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`Release manifest for ${version} has keys ${JSON.stringify(foundKeys)}, expected ${JSON.stringify(expectedKeys)}`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(value)) {
      throw new Error(`Release manifest for ${version} has ${key}=${JSON.stringify(manifest[key])}, expected ${JSON.stringify(value)}`);
    }
  }
}

function readPiPins(manifest, label) {
  const pins = {};
  for (const packageName of PI_PACKAGES) {
    const version = manifest.devDependencies?.[packageName];
    pins[packageName] = requireStableVersion(version, `${label} ${packageName}`);
  }
  return pins;
}

function onePiVersion(pins, label) {
  const versions = [...new Set(Object.values(pins))];
  if (versions.length !== 1) {
    throw new Error(`${label} Pi package pins diverge: ${JSON.stringify(pins)}`);
  }
  return versions[0];
}

function readPeerFloor(manifest, label) {
  const range = manifest.peerDependencies?.[PI_HOST_PACKAGE];
  const match = typeof range === "string" ? range.match(/^>=(\d+\.\d+\.\d+) <2$/) : undefined;
  if (!match) {
    throw new Error(`${label} ${PI_HOST_PACKAGE} peer range must have the form >=x.y.z <2, got ${JSON.stringify(range)}`);
  }
  return match[1];
}

export function parseStableVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Expected a stable x.y.z version, got ${JSON.stringify(version)}`);
  }
  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

export function compareVersions(left, right) {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function requireStableVersion(version, label) {
  try {
    parseStableVersion(version);
    return version;
  } catch {
    throw new Error(`${label} must be a stable x.y.z version, got ${JSON.stringify(version)}`);
  }
}

function highestStableVersion(document) {
  const stable = Object.keys(document.versions ?? {}).filter((version) => /^\d+\.\d+\.\d+$/.test(version));
  if (stable.length === 0) {
    throw new Error(`Registry package ${document.name ?? "unknown"} has no stable versions`);
  }
  return stable.sort(compareVersions).at(-1);
}

async function registryDocument(packageName) {
  return fetchJsonWithRetry(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, `npm package ${packageName}`);
}

async function fetchJsonWithRetry(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= REGISTRY_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (response.status === 404) {
        throw new Error(`${label} returned confirmed 404`);
      }
      if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < REGISTRY_RETRIES) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1000));
      }
    }
  }
  throw new Error(`${label} could not be read after ${REGISTRY_RETRIES} attempts: ${errorMessage(lastError)}`);
}

async function findRelease(tag) {
  const matches = [];
  for (let page = 1; ; page++) {
    const releases = await githubRequest(`/repos/${githubRepository()}/releases?per_page=100&page=${page}`);
    matches.push(...releases.filter((release) => release.tag_name === tag));
    if (releases.length < 100) break;
  }
  if (matches.length > 1) {
    throw new Error(`GitHub has ${matches.length} releases for ${tag}`);
  }
  return matches[0];
}

function githubHeaders(accept = "application/vnd.github+json") {
  const token = process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN is required for GitHub API access");
  }
  return {
    accept,
    authorization: `Bearer ${token}`,
    "user-agent": "rejudge-pi-autorelease",
    "x-github-api-version": "2022-11-28",
  };
}

async function githubRequest(path, options = {}) {
  const url = path.startsWith("https://") ? path : `https://api.github.com${path}`;
  const jsonBody = options.body !== undefined && !(options.body instanceof Buffer);
  const headers = {
    ...githubHeaders(options.accept),
    ...(jsonBody ? { "content-type": "application/json" } : {}),
    ...options.headers,
  };
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body instanceof Buffer ? options.body : jsonBody ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw new Error(`GitHub API ${options.method ?? "GET"} ${url} returned ${response.status}: ${body}`);
  }
  if (options.raw) return response;
  return response.status === 204 ? undefined : response.json();
}

async function uploadReleaseAsset(release, name, path) {
  const uploadUrl = release.upload_url.replace(/\{.*$/, "");
  const body = await readFile(path);
  await githubRequest(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body,
    raw: false,
    headers: { "content-type": "application/octet-stream" },
  });
}

async function downloadReleaseAsset(asset, path) {
  const response = await githubRequest(asset.url, {
    accept: "application/octet-stream",
    raw: true,
  });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

function validateReleaseIdentity(release, version) {
  if (release.tag_name !== `v${version}` || release.name !== releaseTitle(version)) {
    throw new Error(`GitHub Release ${release.id} identity is ${release.tag_name}/${release.name}, expected v${version}/${releaseTitle(version)}`);
  }
}

function assertReleaseAssetSubset(release, version) {
  const expected = new Set(expectedReleaseFiles(version));
  const extra = release.assets.map((asset) => asset.name).filter((name) => !expected.has(name));
  if (extra.length > 0) {
    throw new Error(`GitHub Release v${version} has unexpected assets: ${extra.join(", ")}`);
  }
}

function assertReleaseAssetNames(release, version) {
  assertReleaseAssetSubset(release, version);
  const names = release.assets.map((asset) => asset.name).sort();
  const expected = expectedReleaseFiles(version).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`GitHub Release v${version} assets ${JSON.stringify(names)} differ from ${JSON.stringify(expected)}`);
  }
}

async function verifyAssetIntegrity(name, path, metadata, version) {
  const expected = name === tarballFilename(version) ? metadata.tarballIntegrity : metadata.manifestIntegrity;
  const found = await sriFile(path);
  if (found !== expected) {
    throw new Error(`GitHub asset ${name} has ${found}, expected ${expected}`);
  }
}

async function changelogNotes(version) {
  const changelog = await readFile(CHANGELOG_PATH, "utf8");
  const startMarker = `## ${version} —`;
  const start = changelog.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`${CHANGELOG_PATH} has no release ${version}`);
  }
  const bodyStart = changelog.indexOf("\n\n", start);
  const next = changelog.indexOf("\n## ", bodyStart + 2);
  return changelog.slice(bodyStart + 2, next < 0 ? undefined : next).trim();
}

function expectedReleaseFiles(version) {
  return [tarballFilename(version), manifestFilename(version)];
}

function tarballFilename(version) {
  return `rejudge-${version}.tgz`;
}

function manifestFilename(version) {
  return `rejudge-${version}.release.json`;
}

function releaseTitle(version) {
  return `Rejudge v${version}`;
}

function tagOutputs(metadata) {
  return {
    version: metadata.version,
    piVersion: metadata.piVersion,
    commit: metadata.commit,
    tarball: metadata.tarball,
    integrity: metadata.tarballIntegrity,
    manifestIntegrity: metadata.manifestIntegrity,
    runId: metadata.runId,
    artifactId: metadata.artifactId,
  };
}

function emitState(mode, values) {
  const state = { mode, ...values };
  emitOutputs(state);
  console.log(JSON.stringify(state));
}

function emitOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${camelToSnake(key)}=${String(value)}\n`).join("");
  appendFileSync(outputPath, lines);
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed for ${ROOT}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function tarRead(tarball, path) {
  const result = spawnSync("tar", ["-xOf", tarball, path], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`Could not read ${path} from ${tarball}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function tarList(tarball) {
  const result = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`Could not list ${tarball}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim().split("\n").filter(Boolean);
}

async function sriFile(path) {
  return sri(await readFile(path));
}

function sri(body) {
  return `sha512-${createHash("sha512").update(body).digest("base64")}`;
}

function requireIntegrity(value, label) {
  if (typeof value !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} must be an SRI SHA-512 string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requiredArgument(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function requiredDigits(value, label) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${label} must contain only digits, got ${JSON.stringify(value)}`);
  }
  return value;
}

function githubRepository() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error(`GITHUB_REPOSITORY must be owner/repo, got ${JSON.stringify(repository)}`);
  }
  return repository;
}

async function fetchChecked(url, options, label) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return response;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export { releaseManifestData, validateReleaseManifest };
