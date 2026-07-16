import { isAbsolute, relative, resolve } from "node:path";

const rendererProtocol = "app:";
const rendererHost = "localhost";
const maximumRendererURLLength = 4_096;

export const rendererProtocolScheme = rendererProtocol.slice(0, -1);

export const rendererContentSecurityPolicy = [
	"default-src 'self'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
	"frame-src 'none'",
	"object-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self' data: https:",
	"img-src 'self' data: blob: http: https:",
	"media-src 'self' data: blob: http: https:",
	"connect-src 'self' http://127.0.0.1:48273 https: wss:",
	"worker-src 'self' blob:",
	"manifest-src 'self'",
].join("; ");

export const resolveRendererAssetPath = (
	requestURL: string,
	rendererRoot: string,
): string | null => {
	if (!requestURL || requestURL.length > maximumRendererURLLength) return null;
	if (hasUnsafeRawPath(requestURL)) return null;

	let url: URL;
	try {
		url = new URL(requestURL);
	} catch {
		return null;
	}
	if (
		url.protocol !== rendererProtocol ||
		url.host !== rendererHost ||
		url.username ||
		url.password
	) {
		return null;
	}

	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
	if (pathname.includes("\0") || pathname.includes("\\")) return null;

	const relativeAssetPath = pathname.replace(/^\/+/, "") || "index.html";
	const root = resolve(rendererRoot);
	const assetPath = resolve(root, relativeAssetPath);
	const relativePath = relative(root, assetPath);
	if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;

	return assetPath;
};

const hasUnsafeRawPath = (requestURL: string): boolean => {
	const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i.exec(requestURL);
	if (!match) return true;
	const rawPath = match[1] ?? "/";
	if (/%(?:2f|5c|00)/i.test(rawPath)) return true;

	for (const segment of rawPath.split("/")) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			return true;
		}
		if (decoded === "." || decoded === ".." || decoded.includes("\\") || decoded.includes("\0")) {
			return true;
		}
	}
	return false;
};
