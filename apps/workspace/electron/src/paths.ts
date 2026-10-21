import { app } from "electron";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAppDataPaths } from "./data-paths.js";

const electronDir = dirname(fileURLToPath(import.meta.url));

export const workspaceDir = resolve(electronDir, "..", "..");
export const isPackaged = () => app.isPackaged;

export const appDataPaths = () =>
	resolveAppDataPaths(isPackaged(), app.getPath("appData"), homedir());

export const configureAppDataPaths = () => {
	const paths = appDataPaths();
	mkdirSync(paths.sessionData, { recursive: true });
	app.setPath("userData", paths.userData);
	app.setPath("sessionData", paths.sessionData);
};

export const rendererDistDir = () =>
	isPackaged() ? join(electronDir, "renderer") : join(workspaceDir, "dist");
export const preloadPath = () => join(electronDir, "preload.cjs");

export const resourceRoot = () =>
	isPackaged() ? process.resourcesPath : join(workspaceDir, "electron", "resources");

export const serverBinaryPath = () => {
	const binary = process.platform === "win32" ? "mediago-server.exe" : "mediago-server";
	return join(resourceRoot(), "bin", binary);
};

export const agentsDir = () => join(resourceRoot(), "agents");
export const toolsDir = () => join(resourceRoot(), "tools");
