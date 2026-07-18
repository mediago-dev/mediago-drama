import { isMainModule } from "./workflow-script-utils.ts";

export const requiredVariables = {
  signing: ["MEDIAGO_MAC_CSC_LINK", "MEDIAGO_MAC_CSC_KEY_PASSWORD"],
  notarization: [
    "MEDIAGO_APPLE_ID",
    "MEDIAGO_APPLE_APP_SPECIFIC_PASSWORD",
    "MEDIAGO_APPLE_TEAM_ID",
  ],
} as const;

type ValidationMode = keyof typeof requiredVariables;

export function findMissingVariables(
  names: readonly string[],
  environment: NodeJS.ProcessEnv,
): string[] {
  return names.filter((name) => !environment[name]?.trim());
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== "signing" && mode !== "notarization") {
    throw new Error(`unsupported release credential mode: ${mode ?? ""}`);
  }

  const missing = findMissingVariables(requiredVariables[mode as ValidationMode], process.env);
  if (missing.length > 0) {
    throw new Error(`Missing required official-release secrets: ${missing.join(" ")}`);
  }
  console.log(`Validated macOS ${mode} credentials`);
}

if (isMainModule(import.meta.url)) main();
