import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const source = "apps/workspace/dist";
const target = "services/server/internal/workspace/dist";

if (!existsSync(source)) {
	console.error(`missing workspace build output: ${source}`);
	process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
