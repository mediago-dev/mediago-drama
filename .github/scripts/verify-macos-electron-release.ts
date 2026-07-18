import { resolve } from "node:path";

import { isMainModule, run } from "./workflow-script-utils.ts";

const defaultAppPath = "apps/workspace/release/mac-arm64/MediaGo Drama.app";
const expectedFuseState = "LoadBrowserProcessSpecificV8Snapshot is Disabled";

export function assertSafeBrowserSnapshotFuse(fuseState: string): void {
  if (!fuseState.includes(expectedFuseState)) {
    throw new Error("macOS release unexpectedly requires browser_v8_context_snapshot.bin");
  }
}

export function resolveMacAppPath(appPath: string, repositoryRoot = process.cwd()): string {
  return resolve(repositoryRoot, appPath);
}

function main(): void {
  const configuredAppPath = process.env.MEDIAGO_MAC_APP_PATH?.trim() || defaultAppPath;
  const appPath = resolveMacAppPath(configuredAppPath);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath], {
    stdio: "inherit",
  });
  const fuseState = run("pnpm", [
    "--dir",
    "apps/workspace",
    "exec",
    "electron-fuses",
    "read",
    "--app",
    appPath,
  ]);

  console.log(fuseState.trim());
  assertSafeBrowserSnapshotFuse(fuseState);
}

if (isMainModule(import.meta.url)) main();
