import { resolve } from "node:path";

import { isMainModule, run } from "./workflow-script-utils.ts";

const defaultAppPath = "apps/workspace/release/mac-arm64/MediaGo Drama.app";

export function resolveMacAppPath(appPath: string, repositoryRoot = process.cwd()): string {
  return resolve(repositoryRoot, appPath);
}

function main(): void {
  const configuredAppPath = process.env.MEDIAGO_MAC_APP_PATH?.trim() || defaultAppPath;
  const appPath = resolveMacAppPath(configuredAppPath);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath], {
    stdio: "inherit",
  });
}

if (isMainModule(import.meta.url)) main();
