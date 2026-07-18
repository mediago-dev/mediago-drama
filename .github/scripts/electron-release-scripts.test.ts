import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { applyReleaseVersion } from "./apply-electron-release-version.ts";
import { buildReleaseCreateArgs, collectReleaseArtifacts } from "./publish-electron-release.ts";
import { findMissingVariables } from "./validate-electron-release-env.ts";
import { assertSafeBrowserSnapshotFuse } from "./verify-macos-electron-release.ts";

describe("applyReleaseVersion", () => {
  it("updates the workspace package and manifest without mutating its inputs", () => {
    const workspacePackage = { name: "workspace", version: "0.1.0" };
    const manifest = {
      projects: [
        { name: "server", buildVersion: "0.1.0" },
        { name: "workspace", buildVersion: "0.1.0" },
      ],
    };

    const result = applyReleaseVersion(workspacePackage, manifest, "0.2.0-beta.1");

    assert.equal(result.workspacePackage.version, "0.2.0-beta.1");
    assert.deepEqual(result.manifest.projects, [
      { name: "server", buildVersion: "0.1.0" },
      { name: "workspace", buildVersion: "0.2.0-beta.1" },
    ]);
    assert.equal(workspacePackage.version, "0.1.0");
  });
});

describe("findMissingVariables", () => {
  it("returns variables that are empty or absent", () => {
    assert.deepEqual(findMissingVariables(["A", "B", "C"], { A: "value", B: " " }), ["B", "C"]);
  });
});

describe("assertSafeBrowserSnapshotFuse", () => {
  it("accepts the disabled fuse and rejects an enabled fuse", () => {
    assert.doesNotThrow(() =>
      assertSafeBrowserSnapshotFuse("LoadBrowserProcessSpecificV8Snapshot is Disabled"),
    );
    assert.throws(
      () => assertSafeBrowserSnapshotFuse("LoadBrowserProcessSpecificV8Snapshot is Enabled"),
      /browser_v8_context_snapshot/,
    );
  });
});

describe("release publication helpers", () => {
  it("collects supported artifacts recursively and excludes builder diagnostics", () => {
    const root = mkdtempSync(join(tmpdir(), "mediago-release-artifacts-"));
    try {
      mkdirSync(join(root, "mac"));
      mkdirSync(join(root, "windows"));
      writeFileSync(join(root, "mac", "app.zip"), "zip");
      writeFileSync(join(root, "mac", "app.zip.blockmap"), "blockmap");
      writeFileSync(join(root, "windows", "app.exe"), "exe");
      writeFileSync(join(root, "builder-debug.yml"), "debug");
      writeFileSync(join(root, "notes.txt"), "notes");

      assert.deepEqual(collectReleaseArtifacts(root), [
        join(root, "mac", "app.zip"),
        join(root, "mac", "app.zip.blockmap"),
        join(root, "windows", "app.exe"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds draft prerelease arguments without shell interpolation", () => {
    assert.deepEqual(
      buildReleaseCreateArgs({
        repository: "mediago-dev/mediago-drama",
        tag: "v0.2.0-beta.1",
        appVersion: "0.2.0-beta.1",
        prerelease: true,
        files: ["release/app.zip"],
      }),
      [
        "release",
        "create",
        "v0.2.0-beta.1",
        "release/app.zip",
        "--repo",
        "mediago-dev/mediago-drama",
        "--draft",
        "--verify-tag",
        "--title",
        "0.2.0-beta.1",
        "--notes",
        "MediaGo Drama 0.2.0-beta.1",
        "--prerelease",
      ],
    );
  });
});
