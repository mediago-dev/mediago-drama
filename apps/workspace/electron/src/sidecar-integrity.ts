import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

type SidecarIntegrityManifest = {
	algorithm?: unknown;
	files?: unknown;
	format?: unknown;
	version?: unknown;
};

const manifestFilename = "sidecar-integrity.json";

export const verifySidecarIntegrity = (serverPath: string, resourcesRoot: string): void => {
	const manifest = readManifest(join(resourcesRoot, manifestFilename));
	const filename = basename(serverPath);
	const expected = manifest.files[filename];
	if (!expected) {
		throw new Error(`sidecar integrity manifest does not contain ${filename}`);
	}
	const actual = createHash("sha256").update(readFileSync(serverPath)).digest("hex");
	if (actual !== expected) {
		throw new Error(`server sidecar integrity check failed: ${filename}`);
	}
};

const readManifest = (path: string): { files: Record<string, string> } => {
	let value: SidecarIntegrityManifest;
	try {
		value = JSON.parse(readFileSync(path, "utf8")) as SidecarIntegrityManifest;
	} catch {
		throw new Error(`missing or invalid sidecar integrity manifest: ${path}`);
	}
	if (
		value.format !== "mediago-sidecar-integrity" ||
		value.version !== 1 ||
		value.algorithm !== "sha256" ||
		!value.files ||
		typeof value.files !== "object" ||
		Array.isArray(value.files)
	) {
		throw new Error(`unsupported sidecar integrity manifest: ${path}`);
	}
	const files: Record<string, string> = {};
	for (const [filename, digest] of Object.entries(value.files)) {
		if (!filename || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
			throw new Error(`invalid sidecar integrity entry: ${filename || "<empty>"}`);
		}
		files[filename] = digest;
	}
	return { files };
};
