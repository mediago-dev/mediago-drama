import { app } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const electronDir = dirname(fileURLToPath(import.meta.url));

export const workspaceDir = resolve(electronDir, "..", "..");
export const isPackaged = () => app.isPackaged;

export const rendererDistDir = () =>
	isPackaged() ? join(electronDir, "renderer") : join(workspaceDir, "dist");
export const preloadPath = () => join(electronDir, "preload.js");

export const resourceRoot = () =>
	isPackaged() ? process.resourcesPath : join(workspaceDir, "electron", "resources");

export const serverBinaryPath = () => {
	const binary = process.platform === "win32" ? "mediago-server.exe" : "mediago-server";
	return join(resourceRoot(), "bin", binary);
};

export const agentsDir = () => join(resourceRoot(), "agents");
export const toolsDir = () => join(resourceRoot(), "tools");
