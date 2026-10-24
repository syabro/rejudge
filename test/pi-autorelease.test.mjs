import { describe, expect, test } from "vitest";
import {
  LEGACY_RELEASES,
  compareVersions,
  parseStableVersion,
  releaseAssetAction,
  releaseManifestData,
  validateDryRunCandidate,
  validateFreshCandidate,
  validateReleaseManifest,
  validateReleaseTag,
} from "../scripts/pi-autorelease.mjs";

const commit = "0123456789012345678901234567890123456789";
const piPins = {
  "@earendil-works/pi-ai": "1.4.0",
  "@earendil-works/pi-coding-agent": "1.4.0",
  "@earendil-works/pi-tui": "1.4.0",
};

describe("tag release validation", () => {
  test("keeps the pre-transition tested candidate binding", () => {
    expect(LEGACY_RELEASES["0.5.2"]).toEqual({
      commit: "166491a5cf90f3289d0851bf278d0e9011992f43",
      tarballIntegrity: "sha512-yQqXoDFUI4QxxFJ+xS5BMyfA+Xx8XI98NNK8peY/QLhkVwLTiAcAK4pGb8maCDicY96aJbWWydFl4vkda46kJw==",
      manifestIntegrity: "sha512-lBdv0XczbGLqGSnrayCQ3prs9caiiBrchONTjBYt84bb3nESOt2Ue7wm9PLxNIzqF63BMMWEd4kSNf1xDgZrWg==",
    });
  });

  test("compares stable versions numerically", () => {
    expect(parseStableVersion("1.20.3")).toEqual({ major: 1, minor: 20, patch: 3 });
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
    expect(() => parseStableVersion("1.3.0-beta.1")).toThrow(/stable x\.y\.z/);
  });

  test("requires an annotated version tag on the checked-out main commit", () => {
    const input = {
      version: "0.6.0",
      refName: "v0.6.0",
      tagType: "tag",
      tagCommit: commit,
      checkoutCommit: commit,
      packageVersion: "0.6.0",
      onMain: true,
    };

    expect(validateReleaseTag(input)).toEqual({ version: "0.6.0", commit });
    expect(() => validateReleaseTag({ ...input, refName: "v0.6.1" })).toThrow(/must equal/);
    expect(() => validateReleaseTag({ ...input, tagType: "commit" })).toThrow(/annotated/);
    expect(() => validateReleaseTag({ ...input, tagCommit: "not-a-commit", checkoutCommit: "not-a-commit" })).toThrow(/target commit is invalid/);
    expect(() => validateReleaseTag({ ...input, checkoutCommit: "f".repeat(40) })).toThrow(/Checked-out commit/);
    expect(() => validateReleaseTag({ ...input, packageVersion: "0.5.2" })).toThrow(/package version/);
    expect(() => validateReleaseTag({ ...input, onMain: false })).toThrow(/origin\/main/);
  });

  test("requires fresh source to use the matching latest Pi 1.x pins", () => {
    const input = {
      version: "0.6.0",
      registryHighest: "0.5.2",
      registryLatest: "0.5.2",
      published: false,
      piPins,
      latestPiPins: piPins,
    };

    expect(validateFreshCandidate(input)).toEqual({ piVersion: "1.4.0" });
    expect(() => validateFreshCandidate({ ...input, registryHighest: "0.5.3" })).toThrow(/registry disagrees/);
    expect(() => validateFreshCandidate({ ...input, published: true })).toThrow(/already contains/);
    expect(() => validateFreshCandidate({ ...input, version: "0.5.2" })).toThrow(/must be newer/);
    expect(() => validateFreshCandidate({ ...input, latestPiPins: { ...piPins, "@earendil-works/pi-tui": "1.4.1" } })).toThrow(/latest tags diverge/);
    expect(() => validateFreshCandidate({ ...input, latestPiPins: Object.fromEntries(Object.keys(piPins).map((name) => [name, "2.0.0"])) })).toThrow(/outside major 1/);
    expect(() => validateFreshCandidate({ ...input, piPins: Object.fromEntries(Object.keys(piPins).map((name) => [name, "1.3.0"])) })).toThrow(/must pin latest Pi 1\.4\.0/);
  });

  test("allows a dry run of the currently published main version", () => {
    expect(validateDryRunCandidate({
      version: "0.5.2",
      registryHighest: "0.5.2",
      registryLatest: "0.5.2",
      published: true,
      piPins,
      latestPiPins: piPins,
    })).toEqual({ piVersion: "1.4.0" });
  });

  test("reuses matching assets and replaces only unpublished mismatches", () => {
    expect(releaseAssetAction(undefined, "sha512-YWJj")).toBe("upload");
    expect(releaseAssetAction("sha512-YWJj", "sha512-YWJj")).toBe("skip");
    expect(releaseAssetAction("sha512-ZGVm", "sha512-YWJj")).toBe("replace");
  });

  test("binds the packed tarball to the tagged source commit", () => {
    const manifest = releaseManifestData(
      "0.6.0",
      "1.4.0",
      commit,
      "rejudge-0.6.0.tgz",
      "sha512-YWJj",
    );

    expect(() => validateReleaseManifest(manifest, "0.6.0", { commit, piVersion: "1.4.0" })).not.toThrow();
    expect(() => validateReleaseManifest({ ...manifest, smokes: ["renamed-smoke"] }, "0.6.0", { commit, piVersion: "1.4.0" })).not.toThrow();
    expect(() => validateReleaseManifest({ ...manifest, smokes: [] }, "0.6.0", { commit, piVersion: "1.4.0" })).toThrow(/smokes/);
    expect(() => validateReleaseManifest(manifest, "0.6.0", { commit: "f".repeat(40), piVersion: "1.4.0" })).toThrow(/commit/);
    expect(() => validateReleaseManifest({ ...manifest, tarballIntegrity: "bad" }, "0.6.0", { commit, piVersion: "1.4.0" })).toThrow(/integrity/);
  });
});
