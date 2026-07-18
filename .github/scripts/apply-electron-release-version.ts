import { readFileSync, writeFileSync } from "node:fs";

import { isMainModule, requireEnvironment } from "./workflow-script-utils.ts";

type JsonObject = Record<string, unknown>;

export function applyReleaseVersion(
  workspacePackage: JsonObject,
  manifest: JsonObject,
  version: string,
): { workspacePackage: JsonObject; manifest: JsonObject } {
  if (!version.trim()) throw new Error("release version must not be empty");

  const nextWorkspacePackage = structuredClone(workspacePackage);
  nextWorkspacePackage.version = version;

  const nextManifest = structuredClone(manifest);
  if (Array.isArray(nextManifest.projects)) {
    const workspaceProject = nextManifest.projects.find(
      (project): project is JsonObject =>
        typeof project === "object" && project !== null && project.name === "workspace",
    );
    if (workspaceProject) workspaceProject.buildVersion = version;
  }

  return { workspacePackage: nextWorkspacePackage, manifest: nextManifest };
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function writeJson(path: string, value: JsonObject): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main(): void {
  const version = requireEnvironment("APP_VERSION");
  const workspacePackagePath = "apps/workspace/package.json";
  const manifestPath = "one.manifest.json";
  const result = applyReleaseVersion(
    readJson(workspacePackagePath),
    readJson(manifestPath),
    version,
  );

  writeJson(workspacePackagePath, result.workspacePackage);
  writeJson(manifestPath, result.manifest);
  console.log(`Applied Electron release version: ${version}`);
}

if (isMainModule(import.meta.url)) main();
