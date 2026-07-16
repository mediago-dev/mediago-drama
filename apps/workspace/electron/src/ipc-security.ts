import type { IpcMainInvokeEvent } from "electron";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

export interface TrustedRendererOptions {
	developmentRendererRoot: string;
	developmentRendererURL?: string;
	packaged: boolean;
}

export const normalizeDevelopmentRendererURL = (value: string | undefined): string | undefined => {
	const raw = value?.trim();
	if (!raw) return undefined;

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		!isLoopbackHost(url.hostname) ||
		url.username ||
		url.password
	) {
		return undefined;
	}
	return url.toString();
};

export const isTrustedRendererURL = (value: string, options: TrustedRendererOptions): boolean => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}

	if (options.packaged) {
		return url.protocol === "app:" && url.host === "localhost" && !url.username && !url.password;
	}

	const developmentRendererURL = normalizeDevelopmentRendererURL(options.developmentRendererURL);
	if (developmentRendererURL) {
		return url.origin === new URL(developmentRendererURL).origin;
	}
	if (url.protocol !== "file:") return false;

	try {
		const root = resolve(options.developmentRendererRoot);
		const candidate = fileURLToPath(url);
		const relativePath = relative(root, candidate);
		return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
	} catch {
		return false;
	}
};

export const assertTrustedIpcSender = (
	event: IpcMainInvokeEvent,
	options: TrustedRendererOptions,
): void => {
	const frame = event.senderFrame;
	if (!frame || frame !== event.sender.mainFrame || !isTrustedRendererURL(frame.url, options)) {
		throw new Error("desktop IPC request came from an untrusted renderer");
	}
};

const isLoopbackHost = (hostname: string): boolean =>
	hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
