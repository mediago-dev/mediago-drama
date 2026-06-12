import { toast as sonnerToast } from "sonner";

// Toast提示类型
export type ToastType = "success" | "info" | "warning" | "error" | "loading";

// Toast配置选项
export interface ToastOptions {
	/** 显示时长(秒)，0表示不自动关闭，默认3秒 */
	duration?: number;
	/** 自定义key，用于更新或关闭特定消息 */
	key?: string;
	/** 自定义样式类名 */
	className?: string;
	/** 附加说明 */
	description?: string;
	/** 点击动作 */
	onClick?: () => void;
}

const DEFAULT_DURATION = 3;
const generateToastId = () => Math.random().toString(36).substring(2, 15);

const toDuration = (duration?: number) => {
	if (duration === 0) return Number.POSITIVE_INFINITY;
	return (duration ?? DEFAULT_DURATION) * 1000;
};

const resolveToastId = (options?: ToastOptions) => options?.key ?? generateToastId();

const toToastOptions = (options?: ToastOptions, key?: string) => ({
	id: key ?? options?.key,
	duration: toDuration(options?.duration),
	className: options?.className,
	description: options?.description,
	action: options?.onClick
		? {
				label: "查看",
				onClick: options.onClick,
			}
		: undefined,
});

/**
 * Toast提示工具对象
 */
const Toast = {
	/**
	 * 成功提示
	 * @param content 提示内容
	 * @param options 配置选项
	 * @returns 返回用于关闭的函数
	 */
	success(content: string, options?: ToastOptions) {
		const key = resolveToastId(options);
		sonnerToast.success(content, toToastOptions(options, key));
		return key;
	},

	/**
	 * 信息提示
	 * @param content 提示内容
	 * @param options 配置选项
	 * @returns 返回用于关闭的函数
	 */
	info(content: string, options?: ToastOptions) {
		const key = resolveToastId(options);
		sonnerToast.info(content, toToastOptions(options, key));
		return key;
	},

	/**
	 * 警告提示
	 * @param content 提示内容
	 * @param options 配置选项
	 * @returns 返回用于关闭的函数
	 */
	warning(content: string, options?: ToastOptions) {
		const key = resolveToastId(options);
		sonnerToast.warning(
			content,
			toToastOptions({ ...options, duration: options?.duration ?? 4 }, key),
		);
		return key;
	},

	/**
	 * 错误提示
	 * @param content 提示内容
	 * @param options 配置选项
	 * @returns 返回用于关闭的函数
	 */
	error(content: string, options?: ToastOptions) {
		const key = resolveToastId(options);
		sonnerToast.error(
			content,
			toToastOptions({ ...options, duration: options?.duration ?? 5 }, key),
		);
		return key;
	},

	/**
	 * 加载提示
	 * @param content 提示内容
	 * @param options 配置选项
	 * @returns 返回用于关闭的函数
	 */
	loading(content: string, options?: ToastOptions) {
		const key = resolveToastId(options);
		sonnerToast.loading(
			content,
			toToastOptions({ ...options, duration: options?.duration ?? 0 }, key),
		);
		return key;
	},

	/**
	 * 更新指定key的消息
	 * @param key 消息key
	 * @param content 新内容
	 * @param type 消息类型
	 * @param options 配置选项
	 */
	update(
		key: string,
		content: string,
		type: ToastType = "info",
		options?: Omit<ToastOptions, "key">,
	) {
		const config = toToastOptions(options, key);

		switch (type) {
			case "success":
				return sonnerToast.success(content, config);
			case "warning":
				return sonnerToast.warning(content, config);
			case "error":
				return sonnerToast.error(content, config);
			case "loading":
				return sonnerToast.loading(content, toToastOptions({ ...options, duration: 0 }, key));
			default:
				return sonnerToast.info(content, config);
		}
	},

	/**
	 * 销毁指定key的消息
	 * @param key 消息key，不传则销毁所有
	 */
	destroy(key?: string) {
		if (key) {
			sonnerToast.dismiss(key);
		} else {
			sonnerToast.dismiss();
		}
	},

	/**
	 * 显示操作成功的标准提示
	 * @param action 操作名称，如'保存'、'删除'等
	 * @param options 配置选项
	 */
	successAction(action: string, options?: ToastOptions) {
		return Toast.success(`${action}成功！`, options);
	},

	/**
	 * 显示操作失败的标准提示
	 * @param action 操作名称，如'保存'、'删除'等
	 * @param reason 失败原因，可选
	 * @param options 配置选项
	 */
	errorAction(action: string, reason?: string, options?: ToastOptions) {
		const content = reason ? `${action}失败：${reason}` : `${action}失败！`;
		return Toast.error(content, options);
	},

	/**
	 * 显示加载中的标准提示
	 * @param action 操作名称，如'保存'、'加载'等
	 * @param options 配置选项
	 * @returns 返回用于关闭的函数
	 */
	loadingAction(action: string, options?: ToastOptions) {
		return Toast.loading(`${action}中...`, options);
	},

	/**
	 * 显示复制成功提示
	 * @param options 配置选项
	 */
	copySuccess(options?: ToastOptions) {
		return Toast.success("复制成功！", { duration: 2, ...options });
	},

	/**
	 * 显示网络错误提示
	 * @param options 配置选项
	 */
	networkError(options?: ToastOptions) {
		return Toast.error("网络连接失败，请检查网络设置", {
			duration: 5,
			...options,
		});
	},

	/**
	 * 显示权限不足提示
	 * @param options 配置选项
	 */
	permissionDenied(options?: ToastOptions) {
		return Toast.warning("权限不足，请联系管理员", {
			duration: 4,
			...options,
		});
	},
};

export default Toast;

// 导出常用方法的简写
export const toast = Toast;
export const { success, info, warning, error, loading } = Toast;
