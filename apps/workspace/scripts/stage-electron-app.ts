import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type WorkspacePackage = {
	name?: string;
	version?: string;
	devDependencies?: {
		electron?: string;
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
	const githubPublisher = githubPublisherOptions();
	const appPackage = {
		name: "mediago-drama",
		productName: "MediaGo Drama",
		version: workspacePackage.version ?? "0.0.0",
		description: "MediaGo Drama desktop workspace",
		author: "MediaGo Dev",
		private: true,
		type: "module",
		main: "main.js",
		dependencies: {},
		build: {
			appId: "team.torchstellar.mediagodrama",
			productName: "MediaGo Drama",
			electronVersion,
			npmRebuild: false,
			directories: {
				output: "../../release",
			},
			...(githubPublisher ? { publish: [githubPublisher] } : {}),
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
				...(electronTargetPlatform === "darwin-arm64"
					? { identity: null, hardenedRuntime: false }
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
}

function readWorkspacePackage(): WorkspacePackage {
	return JSON.parse(readFileSync(workspacePackagePath, "utf8")) as WorkspacePackage;
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

function githubPublisherOptions():
	| { provider: "github"; releaseType: GitHubReleaseType; owner: string; repo: string }
	| undefined {
	const value = process.env.MEDIAGO_ELECTRON_RELEASE_TYPE?.trim();
	if (!value) return undefined;
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
