#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.REJUDGE_RELEASE_ROOT
  ? resolve(process.env.REJUDGE_RELEASE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_PATH = join(ROOT, "package.json");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const PI_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
const PI_HOST_PACKAGE = "@earendil-works/pi-coding-agent";
const EXPECTED_PACKAGE_FILES = [
  "package/LICENSE",
  "package/README.md",
  "package/bin/rejudge.js",
  "package/dist/extension.js",
  "package/docs/skills/rejudge-diff/SKILL.md",
  "package/docs/skills/rejudge/SKILL.md",
  "package/package.json",
];
const SMOKES = ["cli", "pi-current", "pi-floor"];
const REGISTRY_RETRIES = 4;
export const LEGACY_RELEASES = {
  "0.5.2": {
    commit: "166491a5cf90f3289d0851bf278d0e9011992f43",
    tarballIntegrity: "sha512-yQqXoDFUI4QxxFJ+xS5BMyfA+Xx8XI98NNK8peY/QLhkVwLTiAcAK4pGb8maCDicY96aJbWWydFl4vkda46kJw==",
    manifestIntegrity: "sha512-lBdv0XczbGLqGSnrayCQ3prs9caiiBrchONTjBYt84bb3nESOt2Ue7wm9PLxNIzqF63BMMWEd4kSNf1xDgZrWg==",
  },
};
export const RELEASE_AUTOMATION_VERSION = 2;

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  await main(process.argv[2], process.argv.slice(3));
}

async function main(command, args) {
  switch (command) {
    case "classify-tag":
      return classifyTag(args);
    case "classify-dry-run":
      return classifyDryRun();
    case "verify-installed":
      return verifyInstalled();
    case "peer-floor":
      return printPeerFloor();
    case "inspect-tarball":
      return inspectTarballCommand(args);
    case "write-manifest":
      return writeManifestCommand(args);
    case "verify-files":
      return verifyFilesCommand(args);
    case "release-download":
      return releaseDownload(args);
    case "release-reconcile":
      return releaseReconcile(args);
    case "release-finalize":
      return releaseFinalize(args);
    case "registry-prepublish":
      return registryPrepublish(args);
    case "registry-verify":
      return registryVerifyCommand(args);
    case "registry-provenance":
      return registryProvenance(args);
    case "verify-recovery-deps":
      return verifyRecoveryDependencies(args);
    default:
      throw new Error(`Unknown pi-autorelease command ${JSON.stringify(command ?? "")}`);
  }
}

async function classifyTag([version]) {
  version = requireStableVersion(version, "release version");
  const tag = releaseTag(version);
  const release = await findRelease(`v${version}`);
  const registry = await registryState(version);

  if (registry.published) {
    if (!release) {
      throw new Error(`npm serves rejudge@${version}, but GitHub Release v${version} is missing`);
    }
    assertReleaseAssetNames(release, version);
    if (!release.draft) {
      await verifyPublishedRelease(release, version);
    }
    return emitState(release.draft ? "finalize" : "noop", { version, commit: tag.commit, piVersion: tag.piVersion });
  }

  const completeRelease = release ? hasCompleteReleaseAssets(release, version) : false;
  if (LEGACY_RELEASES[version] && !completeRelease) {
    const reason = release
      ? `restore the missing draft asset from Actions run 40074639301 before its artifact expires`
      : "its recorded draft assets are missing, so this release cannot be rebuilt";
    throw new Error(`Legacy release v${version} publishes only its recorded tested bytes; ${reason}`);
  }

  if (completeRelease) {
    if (!release.draft) {
      throw new Error(`GitHub Release v${version} is public before npm publication`);
    }
    validateUnpublishedOrder(version, registry.highest, registry.latest);
    await verifyRecoveryDependencies([version]);
    return emitState("recovery", { version, commit: tag.commit, piVersion: tag.piVersion });
  }

  if (release) {
    if (!release.draft) {
      throw new Error(`GitHub Release v${version} is public before npm publication`);
    }
    validateUnpublishedOrder(version, registry.highest, registry.latest);
    await verifyRecoveryDependencies([version]);
    await changelogNotes(version);
    return emitState("repair", { version, commit: tag.commit, piVersion: tag.piVersion });
  }

  const latestPiPins = await registryPiLatest();
  validateFreshCandidate({
    version,
    registryHighest: registry.highest,
    registryLatest: registry.latest,
    published: false,
    piPins: tag.piPins,
    latestPiPins,
  });
  await changelogNotes(version);
  return emitState("fresh", { version, commit: tag.commit, piVersion: tag.piVersion });
}

async function classifyDryRun() {
  const manifest = await readJson(PACKAGE_PATH);
  const version = requireStableVersion(manifest.version, `${PACKAGE_PATH} version`);
  const piPins = readPiPins(manifest, PACKAGE_PATH);
  const registry = await registryState(version);
  const latestPiPins = await registryPiLatest();
  const { piVersion } = validateDryRunCandidate({
    version,
    registryHighest: registry.highest,
    registryLatest: registry.latest,
    published: registry.published,
    piPins,
    latestPiPins,
  });
  await changelogNotes(version);
  return emitState("dry-run", { version, commit: git(["rev-parse", "HEAD"]), piVersion });
}

function releaseTag(version) {
  const ref = `refs/tags/v${version}`;
  const tagCommit = git(["rev-parse", `${ref}^{commit}`]);
  const checkoutCommit = git(["rev-parse", "HEAD"]);
  const tagType = git(["cat-file", "-t", ref]);
  const manifestText = git(["show", `${tagCommit}:package.json`]);
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Could not parse package.json at tag v${version} commit ${tagCommit}: ${errorMessage(error)}`);
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", tagCommit, "origin/main"], { cwd: ROOT });
  const validated = validateReleaseTag({
    version,
    refName: `v${version}`,
    tagType,
    tagCommit,
    checkoutCommit,
    packageVersion: manifest.version,
    onMain: ancestor.status === 0,
  });
  const piPins = readPiPins(manifest, `${tagCommit}:package.json`);
  return { ...validated, piPins, piVersion: onePiVersion(piPins, `${tagCommit}:package.json`), manifest };
}

export function validateReleaseTag(input) {
  const version = requireStableVersion(input.version, "release version");
  if (input.refName !== `v${version}`) {
    throw new Error(`Release ref ${input.refName} must equal v${version}`);
  }
  if (input.tagType !== "tag") {
    throw new Error(`Release v${version} must be an annotated tag, got ${input.tagType}`);
  }
  if (!/^[a-f0-9]{40}$/.test(input.tagCommit ?? "")) {
    throw new Error(`Release v${version} target commit is invalid: ${JSON.stringify(input.tagCommit)}`);
  }
  if (input.checkoutCommit !== input.tagCommit) {
    throw new Error(`Checked-out commit ${input.checkoutCommit} differs from v${version} target ${input.tagCommit}`);
  }
  if (input.packageVersion !== version) {
    throw new Error(`Release v${version} commit ${input.tagCommit} has package version ${input.packageVersion}`);
  }
  if (!input.onMain) {
    throw new Error(`Release v${version} target ${input.tagCommit} is not on origin/main`);
  }
  return { version, commit: input.tagCommit };
}

export function validateFreshCandidate(input) {
  const version = requireStableVersion(input.version, "release version");
  const registryHighest = requireStableVersion(input.registryHighest, "rejudge highest version");
  const registryLatest = requireStableVersion(input.registryLatest, "rejudge latest version");
  validateRegistryHead(registryHighest, registryLatest);
  if (input.published) {
    throw new Error(`npm registry already contains rejudge@${version}`);
  }
  validateUnpublishedOrder(version, registryHighest, registryLatest);
  return validateCurrentPi(input.piPins, input.latestPiPins);
}

export function validateDryRunCandidate(input) {
  const version = requireStableVersion(input.version, "dry-run version");
  const registryHighest = requireStableVersion(input.registryHighest, "rejudge highest version");
  const registryLatest = requireStableVersion(input.registryLatest, "rejudge latest version");
  validateRegistryHead(registryHighest, registryLatest);
  if (compareVersions(version, registryLatest) < 0) {
    throw new Error(`Dry-run version ${version} is behind npm ${registryLatest}`);
  }
  if (input.published && version !== registryLatest) {
    throw new Error(`Published dry-run version ${version} differs from npm latest ${registryLatest}`);
  }
  return validateCurrentPi(input.piPins, input.latestPiPins);
}

function validateRegistryHead(highest, latest) {
  if (highest !== latest) {
    throw new Error(`rejudge registry disagrees: highest stable ${highest}, latest ${latest}`);
  }
}

function validateUnpublishedOrder(version, highest, latest) {
  if (compareVersions(version, highest) <= 0 || compareVersions(version, latest) <= 0) {
    throw new Error(`Unpublished release ${version} must be newer than npm highest=${highest}, latest=${latest}`);
  }
}

function validateCurrentPi(piPins, latestPiPins) {
  const piVersion = onePiVersion(piPins, "release candidate Pi pins");
  const latestPi = onePiVersion(latestPiPins, "Pi registry latest tags");
  if (parseStableVersion(latestPi).major !== 1) {
    throw new Error(`Pi registry latest tags resolve to ${latestPi}, outside major 1`);
  }
  if (piVersion !== latestPi) {
    throw new Error(`Release candidate must pin latest Pi ${latestPi}, got ${piVersion}`);
  }
  return { piVersion };
}

async function registryState(version) {
  const document = await registryDocument("rejudge", true);
  const highest = highestStableVersion(document);
  const latest = requireStableVersion(document["dist-tags"]?.latest, "rejudge latest tag");
  if (highest !== latest) {
    throw new Error(`rejudge registry disagrees: highest stable ${highest}, latest ${latest}`);
  }
  return { document, highest, latest, published: Boolean(document.versions?.[version]) };
}

async function registryPiLatest() {
  const pins = {};
  for (const packageName of PI_PACKAGES) {
    const document = await registryDocument(packageName);
    pins[packageName] = requireStableVersion(document["dist-tags"]?.latest, `${packageName} latest tag`);
  }
  return pins;
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

async function inspectTarballCommand([tarball]) {
  const details = await inspectTarball(requiredArgument(tarball, "tarball path"));
  console.log(JSON.stringify(details));
}

async function writeManifestCommand([tarball, outputPath]) {
  tarball = requiredArgument(tarball, "tarball path");
  outputPath = requiredArgument(outputPath, "release manifest path");
  const details = await inspectTarball(tarball);
  const releaseManifest = releaseManifestData(
    details.version,
    details.piVersion,
    git(["rev-parse", "HEAD"]),
    details.filename,
    details.integrity,
  );
  await writeFile(outputPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
}

async function verifyFilesCommand([directory, version]) {
  const result = await verifyReleaseFiles(
    requiredArgument(directory, "release files directory"),
    requireStableVersion(version, "release version"),
  );
  console.log(JSON.stringify(result));
}

async function releaseDownload([version, directory]) {
  version = requireStableVersion(version, "release version");
  directory = requiredArgument(directory, "release files directory");
  const release = await findRelease(`v${version}`);
  if (!release) {
    throw new Error(`GitHub Release v${version} does not exist`);
  }
  validateReleaseIdentity(release, version);
  assertReleaseAssetNames(release, version);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const asset of release.assets) {
    await downloadReleaseAsset(asset, join(directory, asset.name));
  }
  await verifyReleaseFiles(directory, version);
}

async function verifyPublishedRelease(release, version) {
  const directory = await mkdtemp(join(tmpdir(), `rejudge-published-${version}-`));
  try {
    for (const asset of release.assets) {
      await downloadReleaseAsset(asset, join(directory, asset.name));
    }
    await verifyRegistryVersion(version, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function releaseAssetAction(remoteIntegrity, localIntegrity) {
  requireIntegrity(localIntegrity, "local release asset integrity");
  if (!remoteIntegrity) return "upload";
  requireIntegrity(remoteIntegrity, "remote release asset integrity");
  return remoteIntegrity === localIntegrity ? "skip" : "replace";
}

async function verifyReleaseAssets(release, directory, version) {
  assertReleaseAssetNames(release, version);
  for (const asset of release.assets) {
    const tempPath = join(tmpdir(), `rejudge-release-verify-${asset.id}-${process.pid}`);
    await downloadReleaseAsset(asset, tempPath);
    try {
      const [remoteIntegrity, localIntegrity] = await Promise.all([
        sriFile(tempPath),
        sriFile(join(directory, asset.name)),
      ]);
      if (releaseAssetAction(remoteIntegrity, localIntegrity) !== "skip") {
        throw new Error(`GitHub asset ${asset.name} in release v${version} does not match the local candidate`);
      }
    } finally {
      await rm(tempPath, { force: true });
    }
  }
}

async function releaseReconcile([version, directory]) {
  version = requireStableVersion(version, "release version");
  directory = requiredArgument(directory, "release files directory");
  await registryPrepublish([version]);
  await verifyReleaseFiles(directory, version);
  let release = await findRelease(`v${version}`);
  if (!release) {
    release = await githubRequest(`/repos/${githubRepository()}/releases`, {
      method: "POST",
      body: {
        tag_name: `v${version}`,
        name: releaseTitle(version),
        body: await changelogNotes(version),
        draft: true,
        prerelease: false,
      },
    });
  }

  validateReleaseIdentity(release, version);
  if (!release.draft) {
    throw new Error(`GitHub Release v${version} is public before npm publication`);
  }
  assertReleaseAssetSubset(release, version);

  const existing = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const name of expectedReleaseFiles(version)) {
    const localPath = join(directory, name);
    const localIntegrity = await sriFile(localPath);
    const asset = existing.get(name);
    if (!asset) {
      await uploadReleaseAsset(release, name, localPath);
      continue;
    }

    const tempPath = join(tmpdir(), `rejudge-release-asset-${asset.id}-${process.pid}`);
    await downloadReleaseAsset(asset, tempPath);
    try {
      const action = releaseAssetAction(await sriFile(tempPath), localIntegrity);
      if (action === "skip") continue;

      // npm version immutability is the final guard against the unavoidable check-then-delete race.
      await registryPrepublish([version]);
      await githubRequest(`/repos/${githubRepository()}/releases/assets/${asset.id}`, { method: "DELETE" });
      await uploadReleaseAsset(release, name, localPath);
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  release = await githubRequest(`/repos/${githubRepository()}/releases/${release.id}`);
  await verifyReleaseAssets(release, directory, version);
}

async function releaseFinalize([version]) {
  version = requireStableVersion(version, "release version");
  const release = await findRelease(`v${version}`);
  if (!release) {
    throw new Error(`GitHub Release v${version} does not exist`);
  }
  validateReleaseIdentity(release, version);
  assertReleaseAssetNames(release, version);

  const directory = await mkdtemp(join(tmpdir(), `rejudge-finalize-${version}-`));
  try {
    for (const asset of release.assets) {
      await downloadReleaseAsset(asset, join(directory, asset.name));
    }
    await verifyReleaseFiles(directory, version);
    await waitForRegistryVersion(version, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
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

async function registryPrepublish([version]) {
  version = requireStableVersion(version, "release version");
  const { highest, latest, published } = await registryState(version);
  if (published) {
    throw new Error(`rejudge@${version} already exists immediately before publish`);
  }
  if (compareVersions(highest, version) >= 0 || compareVersions(latest, version) >= 0) {
    throw new Error(`Refusing to publish ${version}: npm highest=${highest}, latest=${latest}`);
  }
}

async function registryVerifyCommand([version, directory]) {
  version = requireStableVersion(version, "release version");
  await waitForRegistryVersion(version, requiredArgument(directory, "release files directory"));
  await requireRegistryHead(version);
}

async function requireRegistryHead(version) {
  const document = await registryDocument("rejudge", true);
  if (document["dist-tags"]?.latest !== version) {
    throw new Error(`npm latest is ${document["dist-tags"]?.latest}, expected newly published ${version}`);
  }
}

async function registryProvenance([version]) {
  version = requireStableVersion(version, "release version");
  const document = await registryDocument("rejudge", true);
  const predicate = document.versions?.[version]?.dist?.attestations?.provenance?.predicateType;
  if (predicate !== "https://slsa.dev/provenance/v1") {
    throw new Error(`npm rejudge@${version} has no SLSA provenance attestation`);
  }
  console.log(`Verified npm provenance for rejudge@${version}`);
}

async function waitForRegistryVersion(version, directory) {
  const releaseFiles = await verifyReleaseFiles(directory, version);
  let lastError;
  for (let attempt = 1; attempt <= 31; attempt++) {
    try {
      await verifyRegistryVersion(version, directory, releaseFiles);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 31) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10000));
      }
    }
  }
  throw new Error(`npm did not expose verified rejudge@${version} after 31 checks over 5 minutes: ${errorMessage(lastError)}`);
}

async function verifyRegistryVersion(version, directory, verifiedFiles) {
  const releaseFiles = verifiedFiles ?? await verifyReleaseFiles(directory, version);
  const document = await registryDocument("rejudge", true);
  const published = document.versions?.[version];
  if (!published) {
    throw new Error(`rejudge@${version} is not visible in npm`);
  }
  if (published.dist?.integrity !== releaseFiles.integrity) {
    throw new Error(`npm integrity ${published.dist?.integrity} differs from ${releaseFiles.integrity}`);
  }
  const tag = releaseTag(version);
  if (published.gitHead && published.gitHead !== tag.commit) {
    throw new Error(`npm gitHead ${published.gitHead} differs from tag commit ${tag.commit}`);
  }
  const response = await fetchChecked(published.dist.tarball, {}, `npm tarball rejudge@${version}`);
  const downloadedIntegrity = sri(Buffer.from(await response.arrayBuffer()));
  if (downloadedIntegrity !== releaseFiles.integrity) {
    throw new Error(`npm tarball rejudge@${version} has ${downloadedIntegrity}, expected ${releaseFiles.integrity}`);
  }
  console.log(`Verified npm rejudge@${version} at ${releaseFiles.integrity}`);
}

async function verifyRecoveryDependencies([version]) {
  version = requireStableVersion(version, "release version");
  const tag = releaseTag(version);
  for (const [packageName, piVersion] of Object.entries(tag.piPins)) {
    const document = await registryDocument(packageName);
    if (!document.versions?.[piVersion]) {
      throw new Error(`${packageName}@${piVersion} required by release recovery or repair ${version} is absent from npm`);
    }
  }
  const floor = readPeerFloor(tag.manifest, `${tag.commit}:package.json`);
  const host = await registryDocument(PI_HOST_PACKAGE);
  if (!host.versions?.[floor]) {
    throw new Error(`${PI_HOST_PACKAGE}@${floor} required by release recovery or repair ${version} is absent from npm`);
  }
}

async function inspectTarball(tarball, expectedRelease) {
  const manifestText = tarRead(tarball, "package/package.json");
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Could not parse package/package.json from ${tarball}: ${errorMessage(error)}`);
  }
  const rootManifest = expectedRelease ? undefined : await readJson(PACKAGE_PATH);
  const expectedVersion = expectedRelease?.version ?? rootManifest.version;
  if (manifest.name !== "rejudge" || manifest.version !== expectedVersion) {
    throw new Error(`${tarball} contains ${manifest.name}@${manifest.version}, expected rejudge@${expectedVersion}`);
  }

  const foundPins = readPiPins(manifest, `${tarball}:package/package.json`);
  const expectedPins = expectedRelease?.piPins ?? readPiPins(rootManifest, PACKAGE_PATH);
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
  if (tarRead(tarball, "package/dist/extension.js").trim().length === 0) {
    throw new Error(`${tarball} contains an empty Pi extension bundle`);
  }

  return {
    filename: basename(tarball),
    integrity: await sriFile(tarball),
    version: manifest.version,
    piVersion,
  };
}

async function verifyReleaseFiles(directory, version) {
  const tag = releaseTag(version);
  const expectedFiles = expectedReleaseFiles(version).sort();
  const files = (await readdir(directory)).filter((name) => !name.startsWith(".")).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${directory} contains ${JSON.stringify(files)}, expected ${JSON.stringify(expectedFiles)}`);
  }

  const manifestPath = join(directory, manifestFilename(version));
  const releaseManifest = await readJson(manifestPath);
  validateReleaseManifest(releaseManifest, version, { commit: tag.commit, piVersion: tag.piVersion });

  const legacy = LEGACY_RELEASES[version];
  if (legacy) {
    const manifestIntegrity = await sriFile(manifestPath);
    if (tag.commit !== legacy.commit || manifestIntegrity !== legacy.manifestIntegrity) {
      throw new Error(`Legacy release v${version} tag or manifest differs from its recorded tested candidate`);
    }
  }

  const tarballPath = join(directory, tarballFilename(version));
  const details = await inspectTarball(tarballPath, { version, piPins: tag.piPins });
  if (details.integrity !== releaseManifest.tarballIntegrity) {
    throw new Error(`${tarballPath} integrity ${details.integrity} differs from manifest ${releaseManifest.tarballIntegrity}`);
  }
  if (legacy && details.integrity !== legacy.tarballIntegrity) {
    throw new Error(`Legacy release v${version} tarball integrity ${details.integrity} differs from its recorded tested candidate`);
  }
  return { ...details, tarball: tarballPath, manifest: manifestPath };
}

export function releaseManifestData(version, piVersion, commit, tarball, tarballIntegrity) {
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

export function validateReleaseManifest(manifest, version, expected = {}) {
  version = requireStableVersion(version, "release version");
  requireStableVersion(manifest.piVersion, `release manifest ${version} Pi version`);
  requireIntegrity(manifest.tarballIntegrity, `release manifest ${version} tarball integrity`);
  if (!Array.isArray(manifest.smokes) || manifest.smokes.length === 0 || manifest.smokes.some((smoke) => typeof smoke !== "string" || !smoke)) {
    throw new Error(`Release manifest ${version} smokes must be a non-empty string array, got ${JSON.stringify(manifest.smokes)}`);
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.commit ?? "")) {
    throw new Error(`Release manifest ${version} commit is invalid: ${JSON.stringify(manifest.commit)}`);
  }
  const wanted = {
    schemaVersion: 1,
    package: "rejudge",
    version,
    piVersion: expected.piVersion ?? manifest.piVersion,
    commit: expected.commit ?? manifest.commit,
    tarball: tarballFilename(version),
    tarballIntegrity: manifest.tarballIntegrity,
    smokes: manifest.smokes,
  };
  const foundKeys = Object.keys(manifest).sort();
  const expectedKeys = Object.keys(wanted).sort();
  if (JSON.stringify(foundKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`Release manifest for ${version} has keys ${JSON.stringify(foundKeys)}, expected ${JSON.stringify(expectedKeys)}`);
  }
  for (const [key, value] of Object.entries(wanted)) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(value)) {
      throw new Error(`Release manifest for ${version} has ${key}=${JSON.stringify(manifest[key])}, expected ${JSON.stringify(value)}`);
    }
  }
}

function readPiPins(manifest, label) {
  const pins = {};
  for (const packageName of PI_PACKAGES) {
    pins[packageName] = requireStableVersion(manifest.devDependencies?.[packageName], `${label} ${packageName}`);
  }
  return pins;
}

function onePiVersion(pins, label) {
  const versions = [...new Set(Object.values(pins))];
  if (versions.length !== 1) {
    throw new Error(`${label} diverge: ${JSON.stringify(pins)}`);
  }
  return versions[0];
}

function readPeerFloor(manifest, label) {
  let floor;
  for (const packageName of [PI_HOST_PACKAGE, "@earendil-works/pi-tui"]) {
    const range = manifest.peerDependencies?.[packageName];
    const match = typeof range === "string" ? range.match(/^>=(\d+\.\d+\.\d+) <2$/) : undefined;
    if (!match || match[1] !== "1.3.0") {
      throw new Error(`${label} ${packageName} peer range must remain >=1.3.0 <2, got ${JSON.stringify(range)}`);
    }
    floor = match[1];
  }
  return floor;
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

async function registryDocument(packageName, fresh = false) {
  const suffix = fresh ? `?rejudge_check=${Date.now()}` : "";
  return fetchJsonWithRetry(`https://registry.npmjs.org/${encodeURIComponent(packageName)}${suffix}`, `npm package ${packageName}`);
}

async function fetchJsonWithRetry(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= REGISTRY_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
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
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...githubHeaders(options.accept),
      ...(jsonBody ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
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
  await githubRequest(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body: await readFile(path),
    headers: { "content-type": "application/octet-stream" },
  });
}

async function downloadReleaseAsset(asset, path) {
  const response = await githubRequest(asset.url, { accept: "application/octet-stream", raw: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

function validateReleaseIdentity(release, version) {
  if (release.tag_name !== `v${version}` || release.name !== releaseTitle(version)) {
    throw new Error(`GitHub Release ${release.id} identity is ${release.tag_name}/${release.name}, expected v${version}/${releaseTitle(version)}`);
  }
}

function hasCompleteReleaseAssets(release, version) {
  validateReleaseIdentity(release, version);
  assertReleaseAssetSubset(release, version);
  const names = release.assets.map((asset) => asset.name).sort();
  return JSON.stringify(names) === JSON.stringify(expectedReleaseFiles(version).sort());
}

function assertReleaseAssetSubset(release, version) {
  const expected = new Set(expectedReleaseFiles(version));
  const extra = release.assets.map((asset) => asset.name).filter((name) => !expected.has(name));
  if (extra.length > 0) {
    throw new Error(`GitHub Release v${version} has unexpected assets: ${extra.join(", ")}; delete each with gh release delete-asset v${version} <asset> --yes before recovery`);
  }
}

function assertReleaseAssetNames(release, version) {
  if (!hasCompleteReleaseAssets(release, version)) {
    const names = release.assets.map((asset) => asset.name).sort();
    throw new Error(`GitHub Release v${version} assets ${JSON.stringify(names)} differ from ${JSON.stringify(expectedReleaseFiles(version).sort())}`);
  }
}

async function changelogNotes(version) {
  const changelog = await readFile(CHANGELOG_PATH, "utf8");
  const marker = `## ${version} —`;
  const start = changelog.indexOf(marker);
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

function emitState(mode, values) {
  const state = { mode, ...values };
  emitOutputs(state);
  console.log(JSON.stringify(state));
  return state;
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
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse JSON ${path}: ${errorMessage(error)}`);
  }
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
