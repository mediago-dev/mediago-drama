import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
	SHELL_API_VERSION,
	bundleServerBinaryEnvName,
	bundleServerBinaryName,
	bundleTargetPlatforms,
	type BundleComponentRef,
} from "../electron/src/ipc-contract.ts";
import { hashBundleFile, hashRendererTree } from "../electron/src/bundle-content.ts";
import { bundleUpdatePublicKey } from "../electron/src/hot-update-config.ts";

// Packages the application bundle (renderer + per-platform server binaries) into a
// signed hot-update artifact set under release/bundle/:
//   renderer-<rev>.zip                 — flat renderer (index.html at zip root)
//   server-<rev>-<platform>.zip        — single server binary at zip root
//   bundle-manifest.json               — { payloadB64, signature } envelope
//
// Environment:
//   RENDERER_UPDATE_PRIVATE_KEY     base64 PKCS8 DER Ed25519 private key (required)
//   RENDERER_UPDATE_CHANNEL         channel cohort, default "beta"
//   RENDERER_UPDATE_EDITION         edition cohort, default "community"
//   RENDERER_UPDATE_NOTES           optional human-readable notes
//   RENDERER_UPDATE_URL_BASE        override download base URL (local testing)
//   RENDERER_UPDATE_EXPECTED_PUBLIC_KEY test-only expected SPKI key override
//   MEDIAGO_BUNDLE_SCHEMA_VERSION   optional assertion matching bundle-update.json
//   MEDIAGO_BUNDLE_WORKSPACE_LAYOUT_VERSION optional assertion matching bundle-update.json
//   MEDIAGO_BUNDLE_APP_BASELINE     full-installer version for this cohort (CI supplied)
//   MEDIAGO_BUNDLE_DISABLED         "1" signs a cohort kill-switch into the payload
//   MEDIAGO_SERVER_BINARY_<PLATFORM> absolute path per platform, e.g.
//     MEDIAGO_SERVER_BINARY_DARWIN_ARM64=/path/to/mediago-server
//     MEDIAGO_SERVER_BINARY_WINDOWS_X64=/path/to/mediago-server.exe
//   At least one platform binary is required.
//
// The bundleRev comes from bundle-update.json — bump it in a normal PR before
// dispatching the bundle-hot-release workflow.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const distDir = join(workspaceDir, "dist");
const outputDir = join(workspaceDir, "release", "bundle");

const githubOwner = "mediago-dev";
const githubRepo = "mediago-drama";
// The ZIP writer converts local date fields to DOS time. Constructing the DOS epoch
// in local time therefore produces the same 1980-01-01 00:00:00 bits in every zone.
const fixedZipTimestamp = new Date(1980, 0, 1, 0, 0, 0);

type BundleVersionConfig = {
	bundleRev: number;
	schemaVersion: number;
	workspaceLayoutVersion: number;
};

function main(): void {
	if (!existsSync(join(distDir, "index.html"))) {
		throw new Error(`missing renderer build output: ${distDir} (run pnpm build first)`);
	}

	const privateKeyB64 = process.env.RENDERER_UPDATE_PRIVATE_KEY?.trim();
	if (!privateKeyB64) {
		throw new Error("RENDERER_UPDATE_PRIVATE_KEY is required (base64 PKCS8 DER)");
	}
	const channel = process.env.RENDERER_UPDATE_CHANNEL?.trim() || "beta";
	if (!/^[a-z0-9-]+$/.test(channel)) {
		throw new Error(`invalid RENDERER_UPDATE_CHANNEL: ${channel}`);
	}
	const edition = process.env.RENDERER_UPDATE_EDITION?.trim() || "community";
	if (edition !== "community" && edition !== "pro") {
		throw new Error(`invalid RENDERER_UPDATE_EDITION: ${edition}`);
	}

	const serverBinaries = collectServerBinaries();
	if (Object.keys(serverBinaries).length === 0) {
		throw new Error(
			"no server binaries provided — set at least one MEDIAGO_SERVER_BINARY_<PLATFORM> env var",
		);
	}

	const versions = readBundleVersionConfig();
	assertVersionEnv("MEDIAGO_BUNDLE_SCHEMA_VERSION", versions.schemaVersion);
	assertVersionEnv("MEDIAGO_BUNDLE_WORKSPACE_LAYOUT_VERSION", versions.workspaceLayoutVersion);
	const { bundleRev, schemaVersion, workspaceLayoutVersion } = versions;
	const appBaseline = process.env.MEDIAGO_BUNDLE_APP_BASELINE?.trim() || readAppVersion();
	if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(appBaseline)) {
		throw new Error(`invalid MEDIAGO_BUNDLE_APP_BASELINE: ${appBaseline}`);
	}
	const sourceCommit = readSourceCommit();
	const urlBase =
		process.env.RENDERER_UPDATE_URL_BASE?.trim().replace(/\/$/, "") ||
		`https://github.com/${githubOwner}/${githubRepo}/releases/download/bundle-${channel}-${edition}`;

	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	// Renderer component: zip dist flat. The loader identifies bundles via
	// bundle-meta.json written at stage/assembly time, not inside this zip.
	const rendererZipName = `renderer-${bundleRev}.zip`;
	const rendererZipPath = join(outputDir, rendererZipName);
	writeDeterministicRendererZip(distDir, rendererZipPath);
	const rendererRef = componentRef(
		rendererZipPath,
		`${urlBase}/${rendererZipName}`,
		hashRendererTree(distDir),
	);

	// Server components: one zip per platform with the binary at zip root.
	const serverRefs: Record<string, BundleComponentRef> = {};
	for (const [platform, binaryPath] of Object.entries(serverBinaries)) {
		const zipName = `server-${bundleRev}-${platform}.zip`;
		const zipPath = join(outputDir, zipName);
		writeDeterministicFileZip(binaryPath, bundleServerBinaryName(platform), zipPath, 0o755);
		serverRefs[platform] = componentRef(
			zipPath,
			`${urlBase}/${zipName}`,
			hashBundleFile(binaryPath),
		);
	}

	const payload = {
		bundleRev,
		schemaVersion,
		workspaceLayoutVersion,
		channel,
		edition,
		sourceCommit,
		appBaseline,
		minShellApi: SHELL_API_VERSION,
		components: {
			renderer: rendererRef,
			server: serverRefs,
		},
		...(process.env.MEDIAGO_BUNDLE_DISABLED === "1" ? { disabled: true } : {}),
		...(process.env.RENDERER_UPDATE_NOTES?.trim()
			? { notes: process.env.RENDERER_UPDATE_NOTES.trim() }
			: {}),
	};

	const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
	const privateKey = createPrivateKey({
		key: Buffer.from(privateKeyB64, "base64"),
		format: "der",
		type: "pkcs8",
	});
	const signature = sign(null, payloadBytes, privateKey);

	// Self-check against the public key the app ships with, so a key mismatch fails
	// the release instead of bricking every client's update check.
	const expectedPublicKey =
		process.env.RENDERER_UPDATE_EXPECTED_PUBLIC_KEY?.trim() || bundleUpdatePublicKey;
	if (expectedPublicKey) {
		const publicKey = createPublicKey({
			key: Buffer.from(expectedPublicKey, "base64"),
			format: "der",
			type: "spki",
		});
		if (!verify(null, payloadBytes, publicKey, signature)) {
			throw new Error(
				"signature self-check failed: RENDERER_UPDATE_PRIVATE_KEY does not match bundleUpdatePublicKey in hot-update-config.ts",
			);
		}
	} else {
		throw new Error(
			"no expected bundle public key is configured; publish a full installer with bundleUpdatePublicKey before packaging hot updates",
		);
	}

	writeFileSync(
		join(outputDir, "bundle-manifest.json"),
		`${JSON.stringify(
			{ payloadB64: payloadBytes.toString("base64"), signature: signature.toString("base64") },
			null,
			2,
		)}\n`,
	);

	console.log(`bundle hot-update artifacts written to ${outputDir}`);
	console.log(
		`  rev=${bundleRev} schema=${schemaVersion} layout=${workspaceLayoutVersion} cohort=${channel}/${edition} baseline=${appBaseline}`,
	);
	console.log(
		`  renderer=${rendererZipName} archiveSha256=${rendererRef.sha256} contentSha256=${rendererRef.contentSha256}`,
	);
	for (const [platform, ref] of Object.entries(serverRefs)) {
		console.log(
			`  server[${platform}] size=${ref.size} archiveSha256=${ref.sha256} contentSha256=${ref.contentSha256}`,
		);
	}
}

function collectServerBinaries(): Record<string, string> {
	const binaries: Record<string, string> = {};
	for (const platform of bundleTargetPlatforms) {
		const envName = bundleServerBinaryEnvName(platform);
		const path = process.env[envName]?.trim();
		if (!path) continue;
		if (!existsSync(path)) {
			throw new Error(`${envName} points at a missing file: ${path}`);
		}
		binaries[platform] = path;
	}
	return binaries;
}

function componentRef(filePath: string, url: string, contentSha256: string): BundleComponentRef {
	const bytes = readFileSync(filePath);
	return {
		url,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		contentSha256,
		size: bytes.length,
	};
}

function readBundleVersionConfig(): BundleVersionConfig {
	const path = join(workspaceDir, "bundle-update.json");
	const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BundleVersionConfig>;
	for (const key of ["bundleRev", "schemaVersion", "workspaceLayoutVersion"] as const) {
		if (!Number.isInteger(parsed[key]) || (parsed[key] ?? 0) < 1) {
			throw new Error(`invalid ${key} in ${path}`);
		}
	}
	return parsed as BundleVersionConfig;
}

function assertVersionEnv(name: string, expected: number): void {
	const raw = process.env[name]?.trim();
	if (!raw) return;
	if (!/^\d+$/.test(raw) || Number(raw) !== expected) {
		throw new Error(`${name} (${raw}) must match bundle-update.json (${expected})`);
	}
}

function writeDeterministicRendererZip(root: string, outputPath: string): void {
	const zip = new AdmZip(undefined, { noSort: false });
	for (const path of rendererFiles(root)) {
		addDeterministicZipEntry(zip, path.relativePath, readFileSync(path.absolutePath), 0o644);
	}
	zip.writeZip(outputPath);
}

function writeDeterministicFileZip(
	inputPath: string,
	entryName: string,
	outputPath: string,
	mode: number,
): void {
	const zip = new AdmZip(undefined, { noSort: false });
	addDeterministicZipEntry(zip, entryName, readFileSync(inputPath), mode);
	zip.writeZip(outputPath);
}

function addDeterministicZipEntry(
	zip: AdmZip,
	entryName: string,
	content: Buffer,
	mode: number,
): void {
	const entry = zip.addFile(entryName, content, "", mode);
	entry.header.time = fixedZipTimestamp;
	entry.extra = Buffer.alloc(0);
}

function rendererFiles(root: string): Array<{ absolutePath: string; relativePath: string }> {
	return walkFiles(root)
		.map((absolutePath) => ({
			absolutePath,
			relativePath: relative(root, absolutePath).split(sep).join("/"),
		}))
		.filter(({ relativePath }) => isRendererComponentPath(relativePath))
		.sort((left, right) =>
			left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
		);
}

function walkFiles(root: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`renderer tree contains a symbolic link: ${path}`);
		if (entry.isDirectory()) result.push(...walkFiles(path));
		else if (entry.isFile()) result.push(path);
		else throw new Error(`renderer tree contains an unsupported entry: ${path}`);
	}
	return result;
}

function isRendererComponentPath(relativePath: string): boolean {
	return (
		relativePath !== "bundle-meta.json" &&
		relativePath !== "renderer-meta.json" &&
		relativePath !== "bin" &&
		!relativePath.startsWith("bin/")
	);
}

function readAppVersion(): string {
	const parsed = JSON.parse(readFileSync(join(workspaceDir, "package.json"), "utf8")) as {
		version?: string;
	};
	return parsed.version ?? "0.0.0";
}

function readSourceCommit(): string {
	const value =
		process.env.GITHUB_SHA?.trim() ||
		execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceDir, encoding: "utf8" }).trim();
	if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`invalid source commit: ${value}`);
	return value;
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
