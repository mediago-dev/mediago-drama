import AdmZip from "adm-zip";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	SHELL_API_VERSION,
	bundleServerBinaryEnvName,
	bundleServerBinaryName,
	bundleTargetPlatforms,
} from "../electron/src/ipc-contract.ts";
import { bundleUpdatePublicKey } from "../electron/src/hot-update-config.ts";

// Packages the application bundle (renderer + per-platform server binaries) into a
// signed hot-update artifact set under release/bundle/:
//   renderer-<rev>.zip                 — flat renderer (index.html at zip root)
//   server-<rev>-<platform>.zip        — single server binary at zip root
//   bundle-manifest.json               — { payloadB64, signature } envelope
//
// Environment:
//   RENDERER_UPDATE_PRIVATE_KEY     base64 PKCS8 DER Ed25519 private key (required)
//   RENDERER_UPDATE_CHANNEL         channel tag suffix, default "beta"
//   RENDERER_UPDATE_NOTES           optional human-readable notes
//   RENDERER_UPDATE_URL_BASE        override download base URL (local testing)
//   MEDIAGO_BUNDLE_HAS_MIGRATION    "1" marks this release as containing DB migrations
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

	const serverBinaries = collectServerBinaries();
	if (Object.keys(serverBinaries).length === 0) {
		throw new Error(
			"no server binaries provided — set at least one MEDIAGO_SERVER_BINARY_<PLATFORM> env var",
		);
	}

	const bundleRev = readBundleRev();
	const appBaseline = readAppVersion();
	const urlBase =
		process.env.RENDERER_UPDATE_URL_BASE?.trim().replace(/\/$/, "") ||
		`https://github.com/${githubOwner}/${githubRepo}/releases/download/bundle-${channel}`;

	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	// Renderer component: zip dist flat. The loader identifies bundles via
	// bundle-meta.json written at stage/assembly time, not inside this zip.
	const rendererZipName = `renderer-${bundleRev}.zip`;
	const rendererZip = new AdmZip();
	rendererZip.addLocalFolder(distDir, "", (entryPath) => {
		const name = basename(entryPath);
		return name !== "bundle-meta.json" && name !== "renderer-meta.json";
	});
	rendererZip.writeZip(join(outputDir, rendererZipName));
	const rendererRef = componentRef(
		join(outputDir, rendererZipName),
		`${urlBase}/${rendererZipName}`,
	);

	// Server components: one zip per platform with the binary at zip root.
	const serverRefs: Record<string, { url: string; sha256: string; size: number }> = {};
	for (const [platform, binaryPath] of Object.entries(serverBinaries)) {
		const zipName = `server-${bundleRev}-${platform}.zip`;
		const zip = new AdmZip();
		zip.addLocalFile(binaryPath, "", bundleServerBinaryName(platform));
		zip.writeZip(join(outputDir, zipName));
		serverRefs[platform] = componentRef(join(outputDir, zipName), `${urlBase}/${zipName}`);
	}

	const payload = {
		bundleRev,
		appBaseline,
		minShellApi: SHELL_API_VERSION,
		components: {
			renderer: rendererRef,
			server: serverRefs,
		},
		...(process.env.MEDIAGO_BUNDLE_HAS_MIGRATION === "1" ? { hasMigration: true } : {}),
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
	if (bundleUpdatePublicKey) {
		const publicKey = createPublicKey({
			key: Buffer.from(bundleUpdatePublicKey, "base64"),
			format: "der",
			type: "spki",
		});
		if (!verify(null, payloadBytes, publicKey, signature)) {
			throw new Error(
				"signature self-check failed: RENDERER_UPDATE_PRIVATE_KEY does not match bundleUpdatePublicKey in hot-update-config.ts",
			);
		}
	} else {
		console.warn(
			"warning: bundleUpdatePublicKey is empty in hot-update-config.ts — clients cannot verify this manifest",
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
	console.log(`  rev=${bundleRev} channel=${channel} baseline=${appBaseline}`);
	console.log(`  renderer=${rendererZipName} sha256=${rendererRef.sha256}`);
	for (const [platform, ref] of Object.entries(serverRefs)) {
		console.log(`  server[${platform}] size=${ref.size} sha256=${ref.sha256}`);
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

function componentRef(filePath: string, url: string) {
	const bytes = readFileSync(filePath);
	return {
		url,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		size: bytes.length,
	};
}

function readBundleRev(): number {
	const path = join(workspaceDir, "bundle-update.json");
	const parsed = JSON.parse(readFileSync(path, "utf8")) as { bundleRev?: number };
	if (!Number.isInteger(parsed.bundleRev) || (parsed.bundleRev ?? 0) < 1) {
		throw new Error(`invalid bundleRev in ${path}`);
	}
	return parsed.bundleRev as number;
}

function readAppVersion(): string {
	const parsed = JSON.parse(readFileSync(join(workspaceDir, "package.json"), "utf8")) as {
		version?: string;
	};
	return parsed.version ?? "0.0.0";
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
