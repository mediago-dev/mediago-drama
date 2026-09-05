import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const checks = [
	{
		name: "前端类型检查与生产构建",
		command: pnpmCommand,
		args: ["-C", "apps/workspace", "build"],
	},
	{
		name: "核心生产流程测试",
		command: pnpmCommand,
		args: [
			"-C",
			"apps/workspace",
			"exec",
			"vitest",
			"run",
			"src/lib/overview/production-pipeline.test.ts",
			"src/lib/production/output-archive.test.ts",
			"src/lib/production/production-templates.test.ts",
			"src/lib/production/project-context.test.ts",
			"src/pages/ProjectOverview.test.tsx",
		],
	},
	{
		name: "桌面端 preload 编译",
		command: pnpmCommand,
		args: ["-C", "apps/workspace", "electron:compile"],
	},
	{
		name: "Go 本地服务测试",
		command: "go",
		args: [
			"test",
			"./services/server/internal/service/document",
			"./services/server/internal/service/shared",
			"./packages/mcp/pkg/mcp",
		],
	},
];

const requiredFiles = [
	"启动桌面App.command",
	"apps/workspace/src/domains/production/components/ProductionWorkbench.tsx",
	"apps/workspace/src/lib/overview/production-pipeline.ts",
	"apps/workspace/src/domains/production/components/ProductionControlPanel.tsx",
	"apps/workspace/src/pages/Settings.tsx",
	"docs/20-15-production-engineering-checklist.md",
];

let failed = false;
for (const file of requiredFiles) {
	const ok = existsSync(resolve(root, file));
	console.log(`${ok ? "PASS" : "FAIL"} 文件存在：${file}`);
	if (!ok) failed = true;
}

for (const check of checks) {
	console.log(`\n▶ ${check.name}`);
	const result = spawnSync(check.command, check.args, {
		cwd: root,
		stdio: "inherit",
		env: process.env,
		shell: process.platform === "win32",
	});
	if (result.status !== 0) {
		failed = true;
		if (result.error) console.error(result.error.message);
		console.log(`FAIL ${check.name}`);
	} else {
		console.log(`PASS ${check.name}`);
	}
}

if (failed) {
	console.error("\n交付检查未通过：请修复失败项后再交付。");
	process.exit(1);
}

console.log("\n交付检查通过：可以提供本地桌面项目文件夹进行测试。");
