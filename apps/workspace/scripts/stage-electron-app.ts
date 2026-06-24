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

function main(): void {
	ensureDirectory(rendererDistDir, "missing renderer build output");
	ensureDirectory(electronDistDir, "missing Electron main process build output");

	const workspacePackage = readWorkspacePackage();
	const electronVersion = normalizeVersion(workspacePackage.devDependencies?.electron);
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
			files: ["package.json", "*.js", "renderer/**/*"],
			extraResources: [
				{
					from: "../resources",
					to: ".",
				},
			],
			mac: {
				category: "public.app-category.productivity",
				target: ["dmg", "zip"],
				icon: "../../build/icons/icon.icns",
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

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
