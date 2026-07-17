import { isTrustedRendererURL, type TrustedRendererOptions } from "./ipc-security.js";

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

export type RendererNavigation =
	| { action: "allow" }
	| { action: "deny" }
	| { action: "open-external"; url: string };

export const normalizeExternalURL = (value: string): string | null => {
	const candidate = String(value ?? "").trim();
	if (!candidate || candidate.length > 8_192) return null;

	try {
		const parsed = new URL(candidate);
		if (parsed.username || parsed.password) return null;
		if (parsed.protocol === "https:") return parsed.toString();
		if (parsed.protocol === "http:" && loopbackHosts.has(parsed.hostname)) {
			return parsed.toString();
		}
		return null;
	} catch {
		return null;
	}
};

export const resolveRendererNavigation = (
	value: string,
	options: TrustedRendererOptions,
): RendererNavigation => {
	if (isTrustedRendererURL(value, options)) return { action: "allow" };

	const externalURL = normalizeExternalURL(value);
	if (externalURL) return { action: "open-external", url: externalURL };
	return { action: "deny" };
};
