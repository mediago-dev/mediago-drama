import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { isMainModule, requireEnvironment, run } from "./workflow-script-utils.ts";

const releaseExtensions = new Set([".blockmap", ".dmg", ".exe", ".yml", ".zip"]);
const excludedArtifactNames = new Set(["builder-debug.yml", "builder-effective-config.yaml"]);

export function collectReleaseArtifacts(root: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectReleaseArtifacts(path));
      continue;
    }
    if (
      entry.isFile() &&
      !excludedArtifactNames.has(entry.name) &&
      releaseExtensions.has(extensionOf(entry.name))
    ) {
      files.push(path);
    }
  }

  return files.sort();
}

export function buildReleaseCreateArgs({
  repository,
  tag,
  appVersion,
  prerelease,
  files,
}: {
  repository: string;
  tag: string;
  appVersion: string;
  prerelease: boolean;
  files: string[];
}): string[] {
  return [
    "release",
    "create",
    tag,
    ...files,
    "--repo",
    repository,
    "--draft",
    "--verify-tag",
    "--title",
    appVersion,
    "--notes",
    `MediaGo Drama ${appVersion}`,
    ...(prerelease ? ["--prerelease"] : []),
  ];
}

function extensionOf(name: string): string {
  if (name.endsWith(".blockmap")) return ".blockmap";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function main(): void {
  const appVersion = requireEnvironment("APP_VERSION");
  const repository = requireEnvironment("GITHUB_REPOSITORY");
  const sha = requireEnvironment("GITHUB_SHA");
  const prerelease = requireEnvironment("PRERELEASE") === "true";
  const tag = `v${appVersion}`;
  const draftReleaseIds = run("gh", [
    "api",
    `repos/${repository}/releases`,
    "--paginate",
    "--jq",
    `.[] | select(.draft and (.tag_name == "${tag}" or .name == "${appVersion}")) | .id`,
  ])
    .split("\n")
    .map((id) => id.trim())
    .filter(Boolean);

  for (const releaseId of draftReleaseIds) {
    run("gh", ["api", "--method", "DELETE", `repos/${repository}/releases/${releaseId}`], {
      stdio: "inherit",
    });
  }

  const existingTagOutput = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  const existingTagSha = existingTagOutput.trim().split(/\s+/, 1)[0] ?? "";
  if (existingTagSha && existingTagSha !== sha) {
    if (draftReleaseIds.length === 0) {
      throw new Error(`tag ${tag} already exists at ${existingTagSha}, expected ${sha}`);
    }
    run("git", ["push", "origin", `:refs/tags/${tag}`], { stdio: "inherit" });
    run("git", ["tag", "-f", tag, sha], { stdio: "inherit" });
    run("git", ["push", "origin", `refs/tags/${tag}`], { stdio: "inherit" });
  } else if (!existingTagSha) {
    run("git", ["tag", tag, sha], { stdio: "inherit" });
    run("git", ["push", "origin", `refs/tags/${tag}`], { stdio: "inherit" });
  }

  const files = collectReleaseArtifacts("release-artifacts");
  if (files.length === 0) throw new Error("no release artifacts found");

  run("gh", buildReleaseCreateArgs({ repository, tag, appVersion, prerelease, files }), {
    stdio: "inherit",
  });
  console.log(`Published draft release ${basename(tag)}`);
}

if (isMainModule(import.meta.url)) main();
