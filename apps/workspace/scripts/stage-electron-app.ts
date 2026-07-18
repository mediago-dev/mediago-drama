import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type WorkspacePackage = {
	name?: string;
	version?: string;
	license?: string;
	dependencies?: {
		"electron-updater"?: string;
	};
	devDependencies?: {
		electron?: string;
		"electron-updater"?: string;
	};
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const workspacePackagePath = join(workspaceDir, "package.json");
const rendererDistDir = join(workspaceDir, "dist");
const electronDistDir = join(workspaceDir, "electron", "dist");
const electronAppDir = join(workspaceDir, "electron", "app");
const sidecarIntegrityManifestPath = join(
	workspaceDir,
	"electron",
	"resources",
	"sidecar-integrity.json",
);
const electronTargetPlatform = process.env.MEDIAGO_ELECTRON_TARGET_PLATFORM?.trim();
const buildsMacOS = electronTargetPlatform
	? electronTargetPlatform.startsWith("darwin-")
	: process.platform === "darwin";
const requiresCodeSigning =
	process.env.MEDIAGO_CODE_SIGN === "1" || process.env.MEDIAGO_MAC_SIGN === "1";
const enablesElectronFuses = !buildsMacOS || requiresCodeSigning;

function main(): void {
	ensureDirectory(rendererDistDir, "missing renderer build output");
	ensureDirectory(electronDistDir, "missing Electron main process build output");
	ensureStagedServerBinary();
	ensureFile(sidecarIntegrityManifestPath, "missing sidecar integrity manifest");

	const workspacePackage = readWorkspacePackage();
	const electronVersion = normalizeVersion(workspacePackage.devDependencies?.electron);
	const electronUpdaterVersion =
		workspacePackage.dependencies?.["electron-updater"] ??
		workspacePackage.devDependencies?.["electron-updater"];
	if (!electronUpdaterVersion) {
		throw new Error("missing electron-updater dependency in workspace package");
	}
	const stagedDependencies = { "electron-updater": electronUpdaterVersion };
	const channel = readElectronChannel();
	const githubPublisher = githubPublisherOptions(channel);
	const appPackage = {
		name: "mediago-drama",
		productName: "MediaGo Drama",
		version: workspacePackage.version ?? "0.0.0",
		description: "MediaGo Drama desktop workspace",
		author: "MediaGo Dev",
		license: workspacePackage.license ?? "Apache-2.0",
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
			asar: true,
			// Flipping Electron fuses mutates the macOS framework binary. Only do so when
			// the build will be signed afterwards; otherwise its embedded signature becomes
			// invalid and macOS terminates the app with CODESIGNING/Invalid Page at launch.
			...(enablesElectronFuses
				? {
						electronFuses: {
							runAsNode: false,
							enableCookieEncryption: true,
							enableNodeOptionsEnvironmentVariable: false,
							enableNodeCliInspectArguments: false,
							enableEmbeddedAsarIntegrityValidation: true,
							onlyLoadAppFromAsar: true,
							// Electron does not ship browser_v8_context_snapshot.bin by default.
							// Keep the browser process on the bundled architecture-specific snapshot.
							loadBrowserProcessSpecificV8Snapshot: false,
							grantFileProtocolExtraPrivileges: false,
						},
					}
				: {}),
			...(requiresCodeSigning ? { forceCodeSigning: true } : {}),
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
			files: [
				"package.json",
				"*.js",
				"*.cjs",
				"sidecar-integrity.json",
				"renderer/**/*",
				"!**/*.map",
			],
			extraResources: [
				{
					from: "../resources",
					to: ".",
					filter: ["**/*", "!sidecar-integrity.json"],
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
				...(buildsMacOS
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
	cpSync(sidecarIntegrityManifestPath, join(electronAppDir, "sidecar-integrity.json"));
}

function readWorkspacePackage(): WorkspacePackage {
	return JSON.parse(readFileSync(workspacePackagePath, "utf8")) as WorkspacePackage;
}

function ensureDirectory(path: string, message: string): void {
	if (!existsSync(path)) {
		throw new Error(`${message}: ${path}`);
	}
}

function ensureFile(path: string, message: string): void {
	if (!existsSync(path)) {
		throw new Error(`${message}: ${path}`);
	}
}

function ensureStagedServerBinary(): void {
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
	if (!existsSync(path)) {
		throw new Error(`missing staged server binary: ${path}`);
	}
}

function normalizeVersion(version: string | undefined): string {
	return version?.replace(/^[^\d]*/, "") || "42.4.1";
}

type GitHubReleaseType = "draft" | "prerelease" | "release";

const githubOwner = "mediago-dev";
const githubRepo = "mediago-drama";

function readElectronChannel(): string {
	const channel = process.env.MEDIAGO_ELECTRON_CHANNEL?.trim() || "beta";
	if (!/^[a-z0-9-]+$/.test(channel)) {
		throw new Error(`invalid MEDIAGO_ELECTRON_CHANNEL: ${channel}`);
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
