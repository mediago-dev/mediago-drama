import { readFileSync, writeFileSync } from "node:fs";

import { isMainModule, requireEnvironment } from "./workflow-script-utils.ts";

type JsonObject = Record<string, unknown>;

export function applyReleaseVersion(workspacePackage: JsonObject, version: string): JsonObject {
  if (!version.trim()) throw new Error("release version must not be empty");

  const nextWorkspacePackage = structuredClone(workspacePackage);
  nextWorkspacePackage.version = version;

  return nextWorkspacePackage;
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
  const result = applyReleaseVersion(readJson(workspacePackagePath), version);

  writeJson(workspacePackagePath, result);
  console.log(`Applied Electron release version: ${version}`);
}

if (isMainModule(import.meta.url)) main();
