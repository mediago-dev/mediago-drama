import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2]?.trim();
if (!base || !/^[0-9a-f]{7,40}$/.test(base)) {
  throw new Error("usage: node check-bundle-version-bumps.mjs <base-commit>");
}

const configPath = "apps/workspace/bundle-update.json";
const parseConfig = (raw, label, allowLegacyMissing = false) => {
  const config = JSON.parse(raw);
  for (const key of ["bundleRev", "schemaVersion", "workspaceLayoutVersion"]) {
    if (allowLegacyMissing && config[key] === undefined) config[key] = 0;
    if (!Number.isInteger(config[key]) || config[key] < (allowLegacyMissing ? 0 : 1)) {
      throw new Error(`${label} has invalid ${key}`);
    }
  }
  return config;
};

execFileSync("git", ["cat-file", "-e", `${base}^{commit}`]);
const baseHasConfig =
  execFileSync("git", ["ls-tree", "-r", "--name-only", base, "--", configPath], {
    encoding: "utf8",
  }).trim() === configPath;
const baseConfig = parseConfig(
  baseHasConfig
    ? execFileSync("git", ["show", `${base}:${configPath}`], { encoding: "utf8" })
    : "{}",
  `${configPath} at ${base}`,
  true,
);
const headConfig = parseConfig(readFileSync(configPath, "utf8"), configPath);
const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const schemaPaths = [
  "services/server/internal/repository/db.go",
  "services/server/internal/app/settings_db_migration.go",
  "services/server/migrations/",
];
const layoutPrefixes = [
  "services/server/internal/service/shared/workspace_paths.go",
  "services/server/internal/service/workspace_state_service.go",
  "services/server/internal/app/workspace/",
  "services/server/internal/app/workspace_file_watcher.go",
];

const touches = (paths) =>
  changed.some((path) => paths.some((prefix) => path === prefix || path.startsWith(prefix)));
const failures = [];
const touchesSchema =
  touches(schemaPaths) ||
  changed.some((path) => /^services\/server\/internal\/domain\/[^/]+_models\.go$/.test(path));
if (touchesSchema && headConfig.schemaVersion <= baseConfig.schemaVersion) {
  failures.push(
    `schema-sensitive files changed but schemaVersion did not increase (${baseConfig.schemaVersion} -> ${headConfig.schemaVersion})`,
  );
}
if (
  touches(layoutPrefixes) &&
  headConfig.workspaceLayoutVersion <= baseConfig.workspaceLayoutVersion
) {
  failures.push(
    `workspace-layout files changed but workspaceLayoutVersion did not increase (${baseConfig.workspaceLayoutVersion} -> ${headConfig.workspaceLayoutVersion})`,
  );
}
if (failures.length > 0) throw new Error(failures.join("\n"));

console.log(
  `bundle version bump guard passed (${changed.length} changed files, schema=${headConfig.schemaVersion}, layout=${headConfig.workspaceLayoutVersion})`,
);
