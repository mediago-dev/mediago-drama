import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { applyReleaseVersion } from "./apply-electron-release-version.ts";
import { buildReleaseCreateArgs, collectReleaseArtifacts } from "./publish-electron-release.ts";
import { findMissingVariables } from "./validate-electron-release-env.ts";
import { resolveMacAppPath } from "./verify-macos-electron-release.ts";

describe("applyReleaseVersion", () => {
  it("updates the workspace package without mutating its input", () => {
    const workspacePackage = { name: "workspace", version: "0.1.0" };

    const result = applyReleaseVersion(workspacePackage, "0.2.0-beta.1");

    assert.deepEqual(result, { name: "workspace", version: "0.2.0-beta.1" });
    assert.equal(workspacePackage.version, "0.1.0");
  });

  it("rejects an empty release version", () => {
    assert.throws(() => applyReleaseVersion({ version: "0.1.0" }, " "), /must not be empty/);
  });

  it("runs in a TOML workspace without reading or changing the manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "mediago-release-version-"));
    const manifest =
      'version = 2\n\n[projects.workspace]\npath = "apps/workspace"\ntoolchain = "node"\n';
    try {
      mkdirSync(join(root, "apps/workspace"), { recursive: true });
      writeFileSync(join(root, "apps/workspace/package.json"), '{"version":"0.1.0"}\n');
      writeFileSync(join(root, "one.manifest.toml"), manifest);

      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("./apply-electron-release-version.ts", import.meta.url))],
        {
          cwd: root,
          env: { ...process.env, APP_VERSION: "0.2.0-beta.1" },
        },
      );

      assert.equal(
        JSON.parse(readFileSync(join(root, "apps/workspace/package.json"), "utf8")).version,
        "0.2.0-beta.1",
      );
      assert.equal(readFileSync(join(root, "one.manifest.toml"), "utf8"), manifest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("findMissingVariables", () => {
  it("returns variables that are empty or absent", () => {
    assert.deepEqual(findMissingVariables(["A", "B", "C"], { A: "value", B: " " }), ["B", "C"]);
  });
});

describe("resolveMacAppPath", () => {
  it("resolves the final app bundle from the repository root", () => {
    const repositoryRoot = join(tmpdir(), "mediago-drama");

    assert.equal(
      resolveMacAppPath("apps/workspace/release/mac-arm64/MediaGo Drama.app", repositoryRoot),
      join(repositoryRoot, "apps/workspace/release/mac-arm64/MediaGo Drama.app"),
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
