import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function run(
  command: string,
  args: string[],
  options: Partial<ExecFileSyncOptionsWithStringEncoding> = {},
): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

export function isMainModule(metaUrl: string): boolean {
  return Boolean(process.argv[1] && fileURLToPath(metaUrl) === resolve(process.argv[1]));
}
