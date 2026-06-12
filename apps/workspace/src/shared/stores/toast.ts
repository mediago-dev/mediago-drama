import Toast, { type ToastOptions, type ToastType } from "@/shared/lib/toast";
import { createStore } from "@/shared/lib/utils";

// Toast历史记录接口
export interface ToastHistoryItem {
	id: string;
	type: ToastType;
	content: string;
	timestamp: number;
	options?: ToastOptions;
}

// Toast状态接口
interface ToastState {
	/** Toast历史记录 */
	history: ToastHistoryItem[];
	/** 当前活跃的Toast数量 */
	activeCount: number;
	/** 是否启用Toast历史记录 */
	enableHistory: boolean;
	/** 最大历史记录数量 */
	maxHistoryCount: number;

	// 显示方法
	success: (content: string, options?: ToastOptions) => string;
	info: (content: string, options?: ToastOptions) => string;
	warning: (content: string, options?: ToastOptions) => string;
	error: (content: string, options?: ToastOptions) => string;
	loading: (content: string, options?: ToastOptions) => string;

	// 便捷方法
	successAction: (action: string, options?: ToastOptions) => string;
	errorAction: (action: string, reason?: string, options?: ToastOptions) => string;
	loadingAction: (action: string, options?: ToastOptions) => string;
	copySuccess: (options?: ToastOptions) => string;
	networkError: (options?: ToastOptions) => string;
	permissionDenied: (options?: ToastOptions) => string;

	// 管理方法
	update: (
		key: string,
		content: string,
		type?: ToastType,
		options?: Omit<ToastOptions, "key">,
	) => void;
	destroy: (key?: string) => void;
	clearHistory: () => void;
	setEnableHistory: (enable: boolean) => void;
	setMaxHistoryCount: (count: number) => void;
	getHistoryByType: (type: ToastType) => ToastHistoryItem[];
	getTodayHistory: () => ToastHistoryItem[];
}

// 生成唯一ID
const generateId = () => Math.random().toString(36).substring(2, 15);

// 添加到历史记录
const addToHistory = (
	get: () => ToastState,
	set: (partial: Partial<ToastState>) => void,
	type: ToastType,
	content: string,
	options?: ToastOptions,
) => {
	const state = get();
	if (!state.enableHistory) return;

	const historyItem: ToastHistoryItem = {
		id: generateId(),
		type,
		content,
		timestamp: Date.now(),
		options,
	};

	const newHistory = [historyItem, ...state.history].slice(0, state.maxHistoryCount);

	set({ history: newHistory });
};

/**
 * Toast状态管理Store
 */
export const useToastStore = createStore<ToastState>(
	(set, get) => ({
		history: [],
		activeCount: 0,
		enableHistory: true,
		maxHistoryCount: 100,

		success: (content: string, options?: ToastOptions) => {
			const id = options?.key || generateId();
			const finalOptions = { ...options, key: id };

			addToHistory(get, set, "success", content, finalOptions);
			set({ activeCount: get().activeCount + 1 });

			Toast.success(content, finalOptions);
			return id;
		},

		info: (content: string, options?: ToastOptions) => {
			const id = options?.key || generateId();
			const finalOptions = { ...options, key: id };

			addToHistory(get, set, "info", content, finalOptions);
			set({ activeCount: get().activeCount + 1 });

			Toast.info(content, finalOptions);
			return id;
		},

		warning: (content: string, options?: ToastOptions) => {
			const id = options?.key || generateId();
			const finalOptions = { ...options, key: id };

			addToHistory(get, set, "warning", content, finalOptions);
			set({ activeCount: get().activeCount + 1 });

			Toast.warning(content, finalOptions);
			return id;
		},

		error: (content: string, options?: ToastOptions) => {
			const id = options?.key || generateId();
			const finalOptions = { ...options, key: id };

			addToHistory(get, set, "error", content, finalOptions);
			set({ activeCount: get().activeCount + 1 });

			Toast.error(content, finalOptions);
			return id;
		},

		loading: (content: string, options?: ToastOptions) => {
			const id = options?.key || generateId();
			const finalOptions = { ...options, key: id };

			addToHistory(get, set, "loading", content, finalOptions);
			set({ activeCount: get().activeCount + 1 });

			Toast.loading(content, finalOptions);
			return id;
		},

		successAction: (action: string, options?: ToastOptions) => {
			return get().success(`${action}成功！`, options);
		},

		errorAction: (action: string, reason?: string, options?: ToastOptions) => {
			const content = reason ? `${action}失败：${reason}` : `${action}失败！`;
			return get().error(content, options);
		},

		loadingAction: (action: string, options?: ToastOptions) => {
			return get().loading(`${action}中...`, options);
		},

		copySuccess: (options?: ToastOptions) => {
			return get().success("复制成功！", { duration: 2, ...options });
		},

		networkError: (options?: ToastOptions) => {
			return get().error("网络连接失败，请检查网络设置", {
				duration: 5,
				...options,
			});
		},

		permissionDenied: (options?: ToastOptions) => {
			return get().warning("权限不足，请联系管理员", {
				duration: 4,
				...options,
			});
		},

		update: (
			key: string,
			content: string,
			type: ToastType = "info",
			options?: Omit<ToastOptions, "key">,
		) => {
			Toast.update(key, content, type, options);
		},

		destroy: (key?: string) => {
			if (key) {
				set({ activeCount: Math.max(0, get().activeCount - 1) });
			} else {
				set({ activeCount: 0 });
			}
			Toast.destroy(key);
		},

		clearHistory: () => {
			set({ history: [] });
		},

		setEnableHistory: (enable: boolean) => {
			set({ enableHistory: enable });
		},

		setMaxHistoryCount: (count: number) => {
			set({ maxHistoryCount: Math.max(1, count) });
			const { history } = get();
			if (history.length > count) {
				set({ history: history.slice(0, count) });
			}
		},

		getHistoryByType: (type: ToastType) => {
			return get().history.filter((item) => item.type === type);
		},

		getTodayHistory: () => {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const todayTimestamp = today.getTime();

			return get().history.filter((item) => item.timestamp >= todayTimestamp);
		},
	}),
	"toastStore",
);
