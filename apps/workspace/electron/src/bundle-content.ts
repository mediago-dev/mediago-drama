import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const metadataFiles = new Set(["bundle-meta.json", "renderer-meta.json"]);

/** Return the lowercase SHA-256 digest of a file's raw bytes. */
export const hashBundleFile = (path: string): string =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Return a deterministic digest of the renderer file tree. Paths are POSIX-style,
 * sorted lexicographically and framed with 64-bit path/content lengths.
 * Bundle metadata and the top-level server bin directory are excluded because they
 * are authenticated independently.
 */
export const hashRendererTree = (rootDir: string): string => {
	const root = resolve(rootDir);
	const files: string[] = [];
	const visit = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const absolutePath = resolve(dir, entry.name);
			const relativePath = relative(root, absolutePath).split(sep).join("/");
			if (relativePath === "bin" || relativePath.startsWith("bin/")) continue;
			if (!relativePath.includes("/") && metadataFiles.has(relativePath)) continue;
			if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) {
				throw new Error(`renderer bundle contains a symbolic link: ${relativePath}`);
			}
			if (entry.isDirectory()) {
				visit(absolutePath);
			} else if (entry.isFile()) {
				files.push(relativePath);
			} else {
				throw new Error(`renderer bundle contains an unsupported entry: ${relativePath}`);
			}
		}
	};

	visit(root);
	files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const hash = createHash("sha256");
	const updateLength = (length: number): void => {
		const frame = Buffer.allocUnsafe(8);
		frame.writeBigUInt64BE(BigInt(length));
		hash.update(frame);
	};
	for (const relativePath of files) {
		const pathBytes = Buffer.from(relativePath, "utf8");
		const content = readFileSync(resolve(root, relativePath));
		updateLength(pathBytes.length);
		hash.update(pathBytes);
		updateLength(content.length);
		hash.update(content);
	}
	return hash.digest("hex");
};
