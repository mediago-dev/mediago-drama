import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fully local, offline harness for the application-bundle hot-update loop. It:
//   1. generates a throwaway Ed25519 keypair (never persisted),
//   2. packages + signs the current dist/ + a server binary, pointing URLs at 127.0.0.1,
//   3. serves release/bundle over http,
//   4. prints the env vars to launch your already-installed app in test mode.
//
// Prereqs:
//   - run `pnpm build` first (dist/ is the NEW renderer you want to ship),
//   - build a server binary for THIS machine's platform, e.g. from the repo root:
//       task build:server:target PLATFORM=darwin-arm64
//     (or set MEDIAGO_SERVER_BINARY to any mediago-server build),
//   - bump apps/workspace/bundle-update.json rev ABOVE the installed app's rev.
//
// Nothing here touches production config or GitHub. Test mode only activates in the
// app because you pass MEDIAGO_HOT_UPDATE_TEST_URL + MEDIAGO_HOT_UPDATE_TEST_PUBKEY.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const repoRoot = resolve(workspaceDir, "..", "..");
const outputDir = join(workspaceDir, "release", "bundle");
const port = Number(process.env.PORT) || 8787;

const platform =
	process.platform === "win32" ? `windows-${process.arch}` : `${process.platform}-${process.arch}`;
const binName = process.platform === "win32" ? "mediago-server.exe" : "mediago-server";

if (!existsSync(join(workspaceDir, "dist", "index.html"))) {
	console.error("missing dist/ — run `pnpm build` first");
	process.exit(1);
}

const serverBinary =
	process.env.MEDIAGO_SERVER_BINARY?.trim() ||
	[join(repoRoot, "bin", platform, binName), join(repoRoot, "bin", binName)].find(existsSync) ||
	"";
if (!serverBinary || !existsSync(serverBinary)) {
	console.error(
		`missing server binary — run \`task build:server:target PLATFORM=${platform}\` at the repo root, or set MEDIAGO_SERVER_BINARY`,
	);
	process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const privateB64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

const serverBinaryEnvName = `MEDIAGO_SERVER_BINARY_${platform.toUpperCase().replace(/-/g, "_")}`;
const packaged = spawnSync(process.execPath, [join(scriptDir, "package-bundle-update.ts")], {
	cwd: workspaceDir,
	stdio: "inherit",
	env: {
		...process.env,
		RENDERER_UPDATE_PRIVATE_KEY: privateB64,
		RENDERER_UPDATE_URL_BASE: `http://127.0.0.1:${port}`,
		RENDERER_UPDATE_NOTES: "本地测试热更新",
		[serverBinaryEnvName]: serverBinary,
	},
});
if (packaged.status !== 0) {
	console.error("packaging failed");
	process.exit(1);
}

const contentType = (name: string) =>
	name.endsWith(".json")
		? "application/json"
		: name.endsWith(".zip")
			? "application/zip"
			: "application/octet-stream";

const server = createServer((req, res) => {
	const name = (req.url ?? "/").split("?")[0].replace(/^\/+/, "");
	const filePath = join(outputDir, name);
	if (!filePath.startsWith(outputDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
		res.writeHead(404).end("not found");
		return;
	}
	res.writeHead(200, { "content-type": contentType(name), "cache-control": "no-store" });
	createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
	const url = `http://127.0.0.1:${port}/bundle-manifest.json`;
	console.log("\n================ bundle hot-update local test ================");
	console.log(`serving ${outputDir} at http://127.0.0.1:${port}`);
	console.log(`server binary: ${serverBinary}`);
	console.log("\nLaunch your INSTALLED app with these env vars to enter test mode:\n");
	console.log(`  MEDIAGO_HOT_UPDATE_TEST_URL="${url}" \\`);
	console.log(`  MEDIAGO_HOT_UPDATE_TEST_PUBKEY="${publicB64}" \\`);
	console.log(`  "/Applications/MediaGo Drama.app/Contents/MacOS/MediaGo Drama"`);
	console.log("\n(macOS example; adjust the path to your installed app.)");
	console.log("Then open 设置 → 应用更新 → 热更新 → 检查热更新.");
	console.log("Ctrl+C to stop the server.\n");
});
