import { describe, expect, test } from "vitest";
import {
  compareVersions,
  parseStableVersion,
  parseTagMessage,
  releaseManifestData,
  validateReleaseManifest,
} from "../scripts/pi-autorelease.mjs";

const tagMessage = `Rejudge v0.5.2

rejudge-release-schema=1
version=0.5.2
pi-version=1.4.0
commit=0123456789012345678901234567890123456789
tarball=rejudge-0.5.2.tgz
tarball-integrity=sha512-YWJj
manifest-integrity=sha512-ZGVm
run-id=123
artifact-id=456
smokes=cli,pi-new,pi-floor
`;

describe("Pi autorelease metadata", () => {
  test("compares stable versions numerically", () => {
    expect(parseStableVersion("1.20.3")).toEqual({ major: 1, minor: 20, patch: 3 });
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
    expect(() => parseStableVersion("1.3.0-beta.1")).toThrow(/stable x\.y\.z/);
  });

  test("reads every binding from an annotated release tag", () => {
    expect(parseTagMessage(tagMessage)).toEqual({
      schema: "1",
      version: "0.5.2",
      piVersion: "1.4.0",
      commit: "0123456789012345678901234567890123456789",
      tarball: "rejudge-0.5.2.tgz",
      tarballIntegrity: "sha512-YWJj",
      manifestIntegrity: "sha512-ZGVm",
      runId: "123",
      artifactId: "456",
      smokes: "cli,pi-new,pi-floor",
    });
    expect(() => parseTagMessage(tagMessage.replace("version=0.5.2\n", ""))).toThrow(/missing version/);
    expect(() => parseTagMessage(`${tagMessage}version=0.5.3\n`)).toThrow(/repeats version/);
  });

  test("validates the deterministic release manifest", () => {
    const manifest = releaseManifestData(
      "0.5.2",
      "1.4.0",
      "0123456789012345678901234567890123456789",
      "rejudge-0.5.2.tgz",
      "sha512-YWJj",
    );
    expect(() => validateReleaseManifest(manifest, "0.5.2")).not.toThrow();
    expect(() => validateReleaseManifest({ ...manifest, piVersion: "1.4.1" }, "0.5.2", {
      ...parseTagMessage(tagMessage),
    })).toThrow(/expected/);
  });
});
