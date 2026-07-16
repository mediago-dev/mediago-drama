/// <reference types="vite/client" />

interface ImportMetaEnv {
	// 应用配置
	readonly VITE_APP_NAME: string;
	readonly VITE_APP_VERSION: string;
	readonly VITE_ENVIRONMENT: "development" | "staging" | "production";
	readonly VITE_MEDIAGO_SERVER_PORT?: string;
	readonly VITE_ENABLE_JIANYING_DRAFT_EXPORT?: string;
	readonly VITE_MEDIAGO_APIKEY_URL?: string;
	readonly VITE_MEDIAGO_PROMPT_PACK_PUBLISH_URL?: string;
	readonly VITE_ENABLE_CUSTOM_PROVIDERS?: string;
	readonly VITE_TALKINGDATA_APP_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
