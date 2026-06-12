/**
 * 应用信息工具类
 * 提供应用配置和环境信息
 */

export const appInfo = {
	name: import.meta.env.VITE_APP_NAME || "MediaGo Drama 工作区",
	version: import.meta.env.VITE_APP_VERSION || "1.0.0",
	environment: import.meta.env.VITE_ENVIRONMENT || "development",
	isDev: import.meta.env.DEV,
	isProd: import.meta.env.PROD,
	isTest: import.meta.env.MODE === "test",
} as const;

/**
 * 获取应用完整版本信息
 */
export const getVersionInfo = () => ({
	name: appInfo.name,
	version: appInfo.version,
	environment: appInfo.environment,
	buildTime: new Date().toISOString(),
	userAgent: navigator.userAgent,
});

/**
 * 检查是否为开发环境
 */
export const isDevelopment = () => appInfo.isDev;

/**
 * 检查是否为生产环境
 */
export const isProduction = () => appInfo.isProd;

/**
 * 获取环境标识字符串
 */
export const getEnvironmentLabel = () => {
	if (appInfo.isDev) return "🔧 开发环境";
	if (appInfo.isProd) return "🚀 生产环境";
	return "🧪 测试环境";
};
