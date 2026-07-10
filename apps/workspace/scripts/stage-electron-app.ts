import { execFileSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hashRendererTree } from "../electron/src/bundle-content.ts";
import { bundleUpdatePublicKey, hotUpdateEnabled } from "../electron/src/hot-update-config.ts";
import { SHELL_API_VERSION } from "../electron/src/ipc-contract.ts";

type WorkspacePackage = {
	name?: string;
	version?: string;
	dependencies?: {
		"electron-updater"?: string;
		"extract-zip"?: string;
	};
	devDependencies?: {
		electron?: string;
		"electron-updater"?: string;
		"extract-zip"?: string;
	};
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const workspacePackagePath = join(workspaceDir, "package.json");
const rendererDistDir = join(workspaceDir, "dist");
const electronDistDir = join(workspaceDir, "electron", "dist");
const electronAppDir = join(workspaceDir, "electron", "app");
const electronTargetPlatform = process.env.MEDIAGO_ELECTRON_TARGET_PLATFORM?.trim();

type BundleVersionConfig = {
	bundleRev: number;
	schemaVersion: number;
	workspaceLayoutVersion: number;
};

function main(): void {
	ensureDirectory(rendererDistDir, "missing renderer build output");
	ensureDirectory(electronDistDir, "missing Electron main process build output");

	const workspacePackage = readWorkspacePackage();
	const electronVersion = normalizeVersion(workspacePackage.devDependencies?.electron);
	const stagedDependencies = Object.fromEntries(
		(["electron-updater", "extract-zip"] as const).flatMap((name) => {
			const version =
				workspacePackage.dependencies?.[name] ?? workspacePackage.devDependencies?.[name];
			return version ? [[name, version]] : [];
		}),
	);
	const channel = readBundleChannel();
	const githubPublisher = githubPublisherOptions(channel);
	const appPackage = {
		name: "mediago-drama",
		productName: "MediaGo Drama",
		version: workspacePackage.version ?? "0.0.0",
		description: "MediaGo Drama desktop workspace",
		author: "MediaGo Dev",
		repository: {
			type: "git",
			url: `https://github.com/${githubOwner}/${githubRepo}.git`,
		},
		private: true,
		type: "module",
		main: "main.js",
		dependencies: stagedDependencies,
		build: {
			appId: "team.torchstellar.mediagodrama",
			productName: "MediaGo Drama",
			// Keep the on-disk filename identical to electron-builder's updater YAML path.
			// Spaces in productName otherwise trigger provider-specific safeArtifactName
			// rewriting, while our manual GitHub upload keeps a different basename.
			artifactName: "${name}-${version}-${os}-${arch}.${ext}",
			electronVersion,
			npmRebuild: false,
			directories: {
				output: "../../release",
			},
			publish: [githubPublisher],
			files: ["package.json", "*.js", "renderer/**/*"],
			extraResources: [
				{
					from: "../resources",
					to: ".",
				},
			],
			mac: {
				category: "public.app-category.productivity",
				target: electronTargetPlatform === "darwin-arm64" ? ["zip"] : ["dmg", "zip"],
				icon: "../../build/icons/icon.icns",
				// MEDIAGO_MAC_SIGN=1 (set by CI when the signing cert exists) enables Developer
				// ID signing; MEDIAGO_MAC_NOTARIZE=1 (set only when the Apple notary secrets
				// also exist) additionally enables notarization — signed-but-not-notarized
				// builds must not fail on missing notary credentials.
				...(electronTargetPlatform === "darwin-arm64"
					? process.env.MEDIAGO_MAC_SIGN === "1"
						? { hardenedRuntime: true, notarize: process.env.MEDIAGO_MAC_NOTARIZE === "1" }
						: { identity: null, hardenedRuntime: false }
					: {}),
			},
			win: {
				target: ["nsis", "zip"],
				icon: "../../build/icons/icon.ico",
			},
			nsis: {
				oneClick: false,
				allowToChangeInstallationDirectory: true,
			},
			linux: {
				target: ["AppImage", "deb"],
				icon: "../../build/icons",
			},
		},
	};

	rmSync(electronAppDir, { recursive: true, force: true });
	mkdirSync(electronAppDir, { recursive: true });

	writeFileSync(join(electronAppDir, "package.json"), `${JSON.stringify(appPackage, null, 2)}\n`);
	cpSync(electronDistDir, electronAppDir, { recursive: true });
	cpSync(rendererDistDir, join(electronAppDir, "renderer"), { recursive: true });
	writeBundleMeta(join(electronAppDir, "renderer"), appPackage.version, channel);
}

function readWorkspacePackage(): WorkspacePackage {
	return JSON.parse(readFileSync(workspacePackagePath, "utf8")) as WorkspacePackage;
}

// Identity and cohort of the builtin application bundle, consumed by the hot-update
// loader to compare against downloaded bundles and choose the matching manifest tag.
function writeBundleMeta(stagedRendererDir: string, appBaseline: string, channel: string): void {
	const bundleUpdatePath = join(workspaceDir, "bundle-update.json");
	const parsed = JSON.parse(readFileSync(bundleUpdatePath, "utf8")) as Partial<BundleVersionConfig>;
	for (const key of ["bundleRev", "schemaVersion", "workspaceLayoutVersion"] as const) {
		if (!Number.isInteger(parsed[key]) || (parsed[key] ?? 0) < 1) {
			throw new Error(`invalid ${key} in ${bundleUpdatePath}`);
		}
	}
	const edition =
		process.env.MEDIAGO_BUNDLE_EDITION?.trim() ||
		process.env.VITE_MEDIAGO_EDITION?.trim() ||
		"community";
	if (edition !== "community" && edition !== "pro") {
		throw new Error(`invalid bundle edition: ${edition}`);
	}
	assertHotUpdateTrustAnchor();
	stagedServerBinaryPath();
	const meta = {
		bundleRev: parsed.bundleRev,
		schemaVersion: parsed.schemaVersion,
		workspaceLayoutVersion: parsed.workspaceLayoutVersion,
		channel,
		edition,
		sourceCommit: readSourceCommit(),
		hotUpdateEnabled,
		bundleUpdatePublicKey,
		minShellApi: SHELL_API_VERSION,
		appBaseline,
		components: {
			renderer: { contentSha256: hashRendererTree(stagedRendererDir) },
			// electron-builder may codesign this nested binary after staging, changing its
			// bytes. Unknown is explicit and forces the first hot update to download server.
			server: { contentSha256: "" },
		},
	};
	writeFileSync(join(stagedRendererDir, "bundle-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

function assertHotUpdateTrustAnchor(): void {
	if (!bundleUpdatePublicKey) {
		if (hotUpdateEnabled) {
			throw new Error("hotUpdateEnabled requires a non-empty bundleUpdatePublicKey");
		}
		return;
	}
	const key = createPublicKey({
		key: Buffer.from(bundleUpdatePublicKey, "base64"),
		format: "der",
		type: "spki",
	});
	if (key.asymmetricKeyType !== "ed25519") {
		throw new Error(`bundleUpdatePublicKey must be Ed25519, got ${key.asymmetricKeyType}`);
	}
}

function readSourceCommit(): string {
	const value =
		process.env.GITHUB_SHA?.trim() ||
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: workspaceDir,
			encoding: "utf8",
		}).trim();
	if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`invalid source commit: ${value}`);
	return value;
}

function stagedServerBinaryPath(): string {
	const isWindows = electronTargetPlatform
		? electronTargetPlatform.startsWith("windows-")
		: process.platform === "win32";
	const path = join(
		workspaceDir,
		"electron",
		"resources",
		"bin",
		`mediago-server${isWindows ? ".exe" : ""}`,
	);
	if (!existsSync(path)) throw new Error(`missing staged server binary: ${path}`);
	return path;
}

function ensureDirectory(path: string, message: string): void {
	if (!existsSync(path)) {
		throw new Error(`${message}: ${path}`);
	}
}

function normalizeVersion(version: string | undefined): string {
	return version?.replace(/^[^\d]*/, "") || "42.4.1";
}

type GitHubReleaseType = "draft" | "prerelease" | "release";

const githubOwner = "mediago-dev";
const githubRepo = "mediago-drama";

function readBundleChannel(): string {
	const channel = process.env.MEDIAGO_BUNDLE_CHANNEL?.trim() || "beta";
	if (!/^[a-z0-9-]+$/.test(channel)) {
		throw new Error(`invalid MEDIAGO_BUNDLE_CHANNEL: ${channel}`);
	}
	return channel;
}

function githubPublisherOptions(channel: string): {
	provider: "github";
	releaseType: GitHubReleaseType;
	owner: string;
	repo: string;
	channel: string;
} {
	const value = process.env.MEDIAGO_ELECTRON_RELEASE_TYPE?.trim() || "release";
	if (value !== "draft" && value !== "prerelease" && value !== "release") {
		throw new Error(`invalid MEDIAGO_ELECTRON_RELEASE_TYPE: ${value}`);
	}

	return {
		provider: "github",
		releaseType: value,
		owner: githubOwner,
		repo: githubRepo,
		channel,
	};
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
