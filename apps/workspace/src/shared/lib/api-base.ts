const devLocalServerPort = "8080";
const packagedLocalServerPort = "48273";

const localServerPort = () =>
	import.meta.env.VITE_MEDIAGO_SERVER_PORT?.trim() ||
	(import.meta.env.DEV ? devLocalServerPort : packagedLocalServerPort);

const localServerOrigin = () => `http://127.0.0.1:${localServerPort()}`;
const apiBasePath = "/api/v1";

export const isTauriRuntime = () =>
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const apiOrigin = () => (isTauriRuntime() ? localServerOrigin() : "");

export const apiBaseURL = () => {
	const origin = apiOrigin();
	return origin ? `${origin}${apiBasePath}` : apiBasePath;
};

const normalizeV1ApiPath = (path: string) => {
	if (path.startsWith(`${apiBasePath}/media/assets/`)) {
		return `${apiBasePath}/media-assets/${path.slice(`${apiBasePath}/media/assets/`.length)}`;
	}
	return path;
};

const normalizeResourceApiPath = (path: string) => {
	if (path === apiBasePath || path.startsWith(`${apiBasePath}/`)) {
		return normalizeV1ApiPath(path);
	}
	if (path.startsWith("/api/media/assets/")) {
		return `${apiBasePath}/media-assets/${path.slice("/api/media/assets/".length)}`;
	}
	if (path === "/api" || path.startsWith("/api/")) {
		return normalizeV1ApiPath(`${apiBasePath}${path.slice("/api".length)}`);
	}
	return normalizeV1ApiPath(path);
};

export const apiURL = (path: string) => {
	const origin = apiOrigin();
	const normalized = path.startsWith("/") ? path : `/${path}`;
	if (normalized === apiBasePath || normalized.startsWith(`${apiBasePath}/`)) {
		const apiPath = normalizeV1ApiPath(normalized);
		return origin ? `${origin}${apiPath}` : apiPath;
	}
	return `${apiBaseURL()}${normalized}`;
};

export const apiResourceURL = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return value;
	if (trimmed === "api" || trimmed.startsWith("api/")) {
		const origin = apiOrigin();
		const apiPath = normalizeResourceApiPath(`/${trimmed}`);
		return origin ? `${origin}${apiPath}` : apiPath;
	}
	if (
		trimmed === "/api" ||
		trimmed.startsWith("/api/") ||
		trimmed === apiBasePath ||
		trimmed.startsWith(`${apiBasePath}/`)
	) {
		const origin = apiOrigin();
		const apiPath = normalizeResourceApiPath(trimmed);
		return origin ? `${origin}${apiPath}` : apiPath;
	}
	return value;
};
