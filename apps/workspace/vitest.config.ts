import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const templateDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(templateDir, "src"),
			"@components": path.resolve(templateDir, "src/components"),
			"@lib": path.resolve(templateDir, "src/lib"),
			"@pages": path.resolve(templateDir, "src/pages"),
			"@hooks": path.resolve(templateDir, "src/hooks"),
			"@types": path.resolve(templateDir, "src/types"),
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
	},
});
