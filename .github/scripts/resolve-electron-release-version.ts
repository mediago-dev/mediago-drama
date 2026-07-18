import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ReleaseChannel = "alpha" | "beta" | "latest";
type VersionBump = "patch" | "minor" | "major";

type BaseVersion = {
  major: number;
  minor: number;
  patch: number;
};

type ReleaseTag = BaseVersion & {
  channel: Exclude<ReleaseChannel, "latest"> | null;
  prereleaseNumber: number | null;
};

type ResolvedRelease = {
  appVersion: string;
  prerelease: boolean;
};

const releaseTagPattern = /^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/;
const supportedChannels = new Set<ReleaseChannel>(["alpha", "beta", "latest"]);
const supportedBumps = new Set<VersionBump>(["patch", "minor", "major"]);

export function parseReleaseTag(tag: string): ReleaseTag | null {
  const match = releaseTagPattern.exec(tag.trim());
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: match[4] === "alpha" || match[4] === "beta" ? match[4] : null,
    prereleaseNumber: match[5] === undefined ? null : Number(match[5]),
  };
}

export function resolveReleaseVersion({
  tags,
  channel,
  bump,
}: {
  tags: string[];
  channel: string;
  bump: string;
}): ResolvedRelease {
  if (!isReleaseChannel(channel)) {
    throw new Error(`unsupported channel: ${channel}`);
  }
  if (!isVersionBump(bump)) {
    throw new Error(`unsupported version bump: ${bump}`);
  }

  const releases = tags.map(parseReleaseTag).filter((release) => release !== null);
  if (releases.length === 0) {
    throw new Error("no valid v* release tags found");
  }

  const highestBase = releases.reduce((highest, release) =>
    compareBaseVersions(release, highest) > 0 ? release : highest,
  );

  if (channel === "latest") {
    return {
      appVersion: formatBaseVersion(incrementBaseVersion(highestBase, bump)),
      prerelease: false,
    };
  }

  const highestBaseIsStable = releases.some(
    (release) => release.channel === null && compareBaseVersions(release, highestBase) === 0,
  );
  const prereleaseBase = highestBaseIsStable
    ? incrementBaseVersion(highestBase, "patch")
    : highestBase;
  const matchingPrereleases = releases.filter(
    (release) => release.channel === channel && compareBaseVersions(release, prereleaseBase) === 0,
  );
  if (matchingPrereleases.length > 0) {
    const nextNumber =
      Math.max(...matchingPrereleases.map((release) => release.prereleaseNumber ?? -1)) + 1;
    return {
      appVersion: `${formatBaseVersion(prereleaseBase)}-${channel}.${nextNumber}`,
      prerelease: true,
    };
  }

  return {
    appVersion: `${formatBaseVersion(prereleaseBase)}-${channel}.0`,
    prerelease: true,
  };
}

function isReleaseChannel(value: string): value is ReleaseChannel {
  return supportedChannels.has(value as ReleaseChannel);
}

function isVersionBump(value: string): value is VersionBump {
  return supportedBumps.has(value as VersionBump);
}

function compareBaseVersions(left: BaseVersion, right: BaseVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function incrementBaseVersion(version: BaseVersion, bump: VersionBump): BaseVersion {
  switch (bump) {
    case "major":
      return { major: version.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case "patch":
      return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }
}

function formatBaseVersion(version: BaseVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function main(): void {
  const channel = process.env.CHANNEL?.trim() ?? "";
  const bump = process.env.BUMP?.trim() ?? "";
  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const release = resolveReleaseVersion({ tags, channel, bump });
  const output = [
    `app_version=${release.appVersion}`,
    `prerelease=${release.prerelease}`,
    "github_release_type=draft",
  ].join("\n");

  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_OUTPUT is not set");
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  console.log(`Resolved Electron release version: ${release.appVersion}`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) main();
