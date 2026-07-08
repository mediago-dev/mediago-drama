import AdmZip from "adm-zip";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SHELL_API_VERSION } from "../electron/src/ipc-contract.ts";
import { rendererUpdatePublicKey } from "../electron/src/hot-update-config.ts";

// Packages the built renderer (dist/) into a signed hot-update artifact pair:
//   release/renderer/renderer-<rev>.zip        — flat bundle (index.html at zip root)
//   release/renderer/renderer-manifest.json    — { payloadB64, signature } envelope
//
// Environment:
//   RENDERER_UPDATE_PRIVATE_KEY   base64 PKCS8 DER Ed25519 private key (required)
//   RENDERER_UPDATE_CHANNEL       release channel tag suffix, default "beta"
//   RENDERER_UPDATE_NOTES         optional human-readable notes for the manifest
//
// The rendererRev comes from renderer-update.json — bump it in a normal PR before
// dispatching the renderer-hot-release workflow.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const distDir = join(workspaceDir, "dist");
const outputDir = join(workspaceDir, "release", "renderer");

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

	const rendererRev = readRendererRev();
	const appBaseline = readAppVersion();

	// The zip must carry the same identity file the loader checks after extraction.
	writeFileSync(
		join(distDir, "renderer-meta.json"),
		`${JSON.stringify({ rendererRev, minShellApi: SHELL_API_VERSION, appBaseline }, null, 2)}\n`,
	);

	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	const zipName = `renderer-${rendererRev}.zip`;
	const zipPath = join(outputDir, zipName);
	const zip = new AdmZip();
	zip.addLocalFolder(distDir);
	zip.writeZip(zipPath);

	const zipBytes = readFileSync(zipPath);
	// RENDERER_UPDATE_URL_BASE lets local tests point the bundle at http://127.0.0.1:PORT;
	// defaults to the GitHub channel release download URL.
	const urlBase =
		process.env.RENDERER_UPDATE_URL_BASE?.trim().replace(/\/$/, "") ||
		`https://github.com/${githubOwner}/${githubRepo}/releases/download/renderer-${channel}`;
	const payload = {
		rendererRev,
		appBaseline,
		minShellApi: SHELL_API_VERSION,
		url: `${urlBase}/${zipName}`,
		sha256: createHash("sha256").update(zipBytes).digest("hex"),
		size: zipBytes.length,
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
	if (rendererUpdatePublicKey) {
		const publicKey = createPublicKey({
			key: Buffer.from(rendererUpdatePublicKey, "base64"),
			format: "der",
			type: "spki",
		});
		if (!verify(null, payloadBytes, publicKey, signature)) {
			throw new Error(
				"signature self-check failed: RENDERER_UPDATE_PRIVATE_KEY does not match rendererUpdatePublicKey in hot-update-config.ts",
			);
		}
	} else {
		console.warn(
			"warning: rendererUpdatePublicKey is empty in hot-update-config.ts — clients cannot verify this manifest",
		);
	}

	const envelope = {
		payloadB64: payloadBytes.toString("base64"),
		signature: signature.toString("base64"),
	};
	writeFileSync(
		join(outputDir, "renderer-manifest.json"),
		`${JSON.stringify(envelope, null, 2)}\n`,
	);

	console.log(`renderer hot-update artifacts written to ${outputDir}`);
	console.log(`  rev=${rendererRev} channel=${channel} baseline=${appBaseline}`);
	console.log(`  zip=${zipName} size=${payload.size} sha256=${payload.sha256}`);
}

function readRendererRev(): number {
	const path = join(workspaceDir, "renderer-update.json");
	const parsed = JSON.parse(readFileSync(path, "utf8")) as { rendererRev?: number };
	if (!Number.isInteger(parsed.rendererRev) || (parsed.rendererRev ?? 0) < 1) {
		throw new Error(`invalid rendererRev in ${path}`);
	}
	return parsed.rendererRev as number;
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
