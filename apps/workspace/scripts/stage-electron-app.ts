import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
	const githubPublisher = githubPublisherOptions();
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
	writeBundleMeta(join(electronAppDir, "renderer"), appPackage.version);
}

function readWorkspacePackage(): WorkspacePackage {
	return JSON.parse(readFileSync(workspacePackagePath, "utf8")) as WorkspacePackage;
}

// Identity of the builtin application bundle (renderer + server), consumed by the
// hot-update loader (electron/src/bundle-store.ts) to compare against downloaded
// bundles. Component identities are unknown at stage time (empty strings), which
// makes the first hot update download every component — by design.
function writeBundleMeta(stagedRendererDir: string, appBaseline: string): void {
	const bundleUpdatePath = join(workspaceDir, "bundle-update.json");
	const parsed = JSON.parse(readFileSync(bundleUpdatePath, "utf8")) as {
		bundleRev?: number;
	};
	if (!Number.isInteger(parsed.bundleRev) || (parsed.bundleRev ?? 0) < 1) {
		throw new Error(`invalid bundleRev in ${bundleUpdatePath}`);
	}
	const meta = {
		bundleRev: parsed.bundleRev,
		minShellApi: SHELL_API_VERSION,
		appBaseline,
		components: { renderer: "", server: "" },
	};
	writeFileSync(join(stagedRendererDir, "bundle-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
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

function githubPublisherOptions(): {
	provider: "github";
	releaseType: GitHubReleaseType;
	owner: string;
	repo: string;
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
	};
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
