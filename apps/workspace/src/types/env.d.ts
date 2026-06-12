/// <reference types="vite/client" />

interface ImportMetaEnv {
	// 应用配置
	readonly VITE_APP_NAME: string;
	readonly VITE_APP_VERSION: string;
	readonly VITE_ENVIRONMENT: "development" | "staging" | "production";
	readonly VITE_MEDIAGO_SERVER_PORT?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
