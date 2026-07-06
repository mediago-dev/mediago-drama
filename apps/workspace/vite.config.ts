import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const templateDir = path.dirname(fileURLToPath(import.meta.url));
const isElectronBuild = process.env.VITE_ELECTRON_BUILD === "1";
const reactDOMDir = path.resolve(templateDir, "node_modules/react-dom");

export default defineConfig({
	base: isElectronBuild ? "./" : "/",
	clearScreen: false,
	envPrefix: ["VITE_"],
	plugins: [tailwindcss(), react()],
	server: {
		host: false,
		proxy: {
			"/api": {
				target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8080",
				changeOrigin: true,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(templateDir, "src"),
			"@components": path.resolve(templateDir, "src/components"),
			"@lib": path.resolve(templateDir, "src/lib"),
			"@pages": path.resolve(templateDir, "src/pages"),
			"@hooks": path.resolve(templateDir, "src/hooks"),
			"@types": path.resolve(templateDir, "src/types"),
			"react-dom": reactDOMDir,
		},
	},
	build: {
		target: "chrome120",
		minify: "oxc",
		sourcemap: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("node_modules")) {
						if (id.includes("@tiptap") || id.includes("prosemirror")) return "tiptap";
						if (id.includes("@vidstack") || id.includes("react-photo-view")) return "media";
						if (id.includes("@xterm")) return "xterm";
						if (id.includes("@a2ui")) return "a2ui";
						if (
							id.includes("@radix-ui") ||
							id.includes("lucide-react") ||
							id.includes("sonner") ||
							id.includes("class-variance-authority")
						) {
							return "ui";
						}
						if (id.includes("react-router")) return "router";
						return "vendor";
					}
				},
			},
		},
	},
});
