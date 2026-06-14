import type React from "react";
import type { Cache, State, SWRConfiguration } from "swr";
import { SWRConfig } from "swr";

export const persistentSWRCacheStorageKey = "mediago-drama:swr-cache:v1";

type PersistedSWRState = State<unknown> & {
	_k?: unknown;
};

type PersistedSWREntry = [string, PersistedSWRState];

const workspaceStateCacheKeyPattern = /^\/projects\/[^/]+\/workspace\/state$/;
const maxPersistedCacheEntries = 20;

let persistentSWRCache: Map<string, PersistedSWRState> | null = null;
let persistentSWRCacheEventsRegistered = false;

export const shouldPersistSWRCacheKey = (key: string) =>
	key === "/projects" || workspaceStateCacheKeyPattern.test(key);

export const createPersistentSWRCache = (storage: Storage) =>
	new PersistentSWRCache(storage, readPersistedSWRCache(storage));

export const readPersistedSWRCache = (storage: Storage): PersistedSWREntry[] => {
	try {
		const raw = storage.getItem(persistentSWRCacheStorageKey);
		if (!raw) return [];

		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];

		return parsed.flatMap((entry): PersistedSWREntry[] => {
			if (!Array.isArray(entry) || typeof entry[0] !== "string") return [];
			const [key, state] = entry;
			const persistedState = normalizePersistedSWRState(state);
			if (!shouldPersistSWRCacheKey(key) || !persistedState) return [];
			return [[key, persistedState]];
		});
	} catch {
		storage.removeItem(persistentSWRCacheStorageKey);
		return [];
	}
};

export const writePersistedSWRCache = (cache: Map<string, PersistedSWRState>, storage: Storage) => {
	const entries = Array.from(cache.entries())
		.flatMap((entry): PersistedSWREntry[] => {
			const [key, state] = entry;
			const persistedState = normalizePersistedSWRState(state);
			if (!shouldPersistSWRCacheKey(key) || !persistedState) return [];
			return [[key, persistedState]];
		})
		.slice(-maxPersistedCacheEntries);

	try {
		if (entries.length === 0) {
			storage.removeItem(persistentSWRCacheStorageKey);
			return;
		}
		storage.setItem(persistentSWRCacheStorageKey, JSON.stringify(entries));
	} catch {
		storage.removeItem(persistentSWRCacheStorageKey);
	}
};

const normalizePersistedSWRState = (value: unknown): PersistedSWRState | null => {
	if (!value || typeof value !== "object") return null;

	const state = value as PersistedSWRState;
	if (!("data" in state) || state.data === undefined) return null;

	return state._k === undefined ? { data: state.data } : { data: state.data, _k: state._k };
};

class PersistentSWRCache extends Map<string, PersistedSWRState> {
	private readonly storage: Storage;

	constructor(storage: Storage, entries: PersistedSWREntry[]) {
		super();
		this.storage = storage;
		for (const [key, value] of entries) {
			Map.prototype.set.call(this, key, value);
		}
	}

	set(key: string, value: PersistedSWRState) {
		const result = super.set(key, value);
		if (shouldPersistSWRCacheKey(key)) this.persist();
		return result;
	}

	delete(key: string) {
		const deleted = super.delete(key);
		if (deleted && shouldPersistSWRCacheKey(key)) this.persist();
		return deleted;
	}

	clear() {
		super.clear();
		this.persist();
	}

	private persist() {
		writePersistedSWRCache(this, this.storage);
	}
}

const createSWRCacheProvider = (): Cache<unknown> => {
	const storage = safeLocalStorage();
	if (!storage) return new Map<string, PersistedSWRState>();

	persistentSWRCache ??= createPersistentSWRCache(storage);
	registerPersistentSWRCacheEvents(storage, persistentSWRCache);

	return persistentSWRCache;
};

const registerPersistentSWRCacheEvents = (
	storage: Storage,
	cache: Map<string, PersistedSWRState>,
) => {
	if (persistentSWRCacheEventsRegistered || typeof window === "undefined") return;

	const persistCache = () => writePersistedSWRCache(cache, storage);
	window.addEventListener("pagehide", persistCache);
	window.addEventListener("beforeunload", persistCache);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") persistCache();
	});
	persistentSWRCacheEventsRegistered = true;
};

const safeLocalStorage = () => {
	if (typeof window === "undefined") return null;

	try {
		return window.localStorage;
	} catch {
		return null;
	}
};

const swrConfig: SWRConfiguration = {
	provider: createSWRCacheProvider,
	refreshInterval: 0,
	revalidateOnFocus: false,
	revalidateOnReconnect: true,
	shouldRetryOnError: true,
	errorRetryCount: 3,
	errorRetryInterval: 5000,
	dedupingInterval: 2000,
};

export const SWRProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
	return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
};
