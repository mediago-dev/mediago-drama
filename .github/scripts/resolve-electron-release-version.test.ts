import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseReleaseTag, resolveReleaseVersion } from "./resolve-electron-release-version.ts";

const existingTags = ["v0.1.1", "v0.1.2-beta.3", "v0.1.3-beta.0", "not-a-release"];

describe("parseReleaseTag", () => {
  it("parses stable and prerelease tags", () => {
    assert.deepEqual(parseReleaseTag("v1.2.3"), {
      major: 1,
      minor: 2,
      patch: 3,
      channel: null,
      prereleaseNumber: null,
    });
    assert.deepEqual(parseReleaseTag("v1.2.3-beta.4"), {
      major: 1,
      minor: 2,
      patch: 3,
      channel: "beta",
      prereleaseNumber: 4,
    });
  });

  it("ignores malformed tags", () => {
    assert.equal(parseReleaseTag("1.2.3"), null);
    assert.equal(parseReleaseTag("v1.2.3-rc.0"), null);
  });
});

describe("resolveReleaseVersion", () => {
  it("increments stable releases using the selected bump", () => {
    assert.deepEqual(
      resolveReleaseVersion({ tags: existingTags, channel: "latest", bump: "patch" }),
      { appVersion: "0.1.4", prerelease: false },
    );
    assert.deepEqual(
      resolveReleaseVersion({ tags: existingTags, channel: "latest", bump: "minor" }),
      { appVersion: "0.2.0", prerelease: false },
    );
    assert.deepEqual(
      resolveReleaseVersion({ tags: existingTags, channel: "latest", bump: "major" }),
      { appVersion: "1.0.0", prerelease: false },
    );
  });

  it("continues the current prerelease sequence", () => {
    assert.deepEqual(
      resolveReleaseVersion({ tags: existingTags, channel: "beta", bump: "major" }),
      { appVersion: "0.1.3-beta.1", prerelease: true },
    );
  });

  it("starts another prerelease channel on the current unreleased base", () => {
    assert.deepEqual(
      resolveReleaseVersion({ tags: existingTags, channel: "alpha", bump: "minor" }),
      { appVersion: "0.1.3-alpha.0", prerelease: true },
    );
  });

  it("starts a new patch prerelease after the highest stable release", () => {
    assert.deepEqual(
      resolveReleaseVersion({
        tags: ["v0.1.2-beta.3", "v0.1.2"],
        channel: "beta",
        bump: "minor",
      }),
      { appVersion: "0.1.3-beta.0", prerelease: true },
    );
  });

  it("rejects unsupported inputs and an empty release history", () => {
    assert.throws(
      () => resolveReleaseVersion({ tags: existingTags, channel: "nightly", bump: "patch" }),
      /unsupported channel/,
    );
    assert.throws(
      () => resolveReleaseVersion({ tags: existingTags, channel: "latest", bump: "build" }),
      /unsupported version bump/,
    );
    assert.throws(
      () => resolveReleaseVersion({ tags: ["invalid"], channel: "latest", bump: "patch" }),
      /no valid v\* release tags found/,
    );
  });
});
