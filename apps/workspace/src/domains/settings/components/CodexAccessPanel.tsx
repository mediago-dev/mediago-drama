import { LogOut } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { isAgentRuntimeConfigKey } from "@/domains/agent/api/agent";
import {
	type CodexLoginAttempt,
	beginCodexAccountLogin,
	cancelCodexAccountLogin,
	codexAccountKey,
	getCodexAccount,
	getCodexAccountLogin,
	logoutCodexAccount,
} from "@/domains/settings/api/settings";
import { CodexRelayPanel } from "@/domains/settings/components/CodexRelayPanel";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { openExternalUrl } from "@/shared/desktop/actions";

export const CodexAccessPanel: React.FC = () => {
	const toast = useToast();
	const { mutate: mutateGlobal } = useSWRConfig();
	const {
		data: account,
		error: accountError,
		isLoading,
		mutate,
	} = useSWR(codexAccountKey, getCodexAccount);
	const [attempt, setAttempt] = useState<CodexLoginAttempt>();
	const [busy, setBusy] = useState("");

	const refreshAccount = useCallback(async () => {
		await mutate();
		void mutateGlobal(isAgentRuntimeConfigKey, undefined, { revalidate: true });
	}, [mutate, mutateGlobal]);

	useEffect(() => {
		if (!attempt || attempt.status !== "pending") return;
		let disposed = false;
		const check = async () => {
			try {
				const next = await getCodexAccountLogin(attempt.loginId);
				if (disposed) return;
				setAttempt(next);
				if (next.status === "completed") {
					await refreshAccount();
					toast.success("ChatGPT 登录成功", { description: "已复用全局 Codex 登录态。" });
				} else if (next.status !== "pending" && next.status !== "canceled") {
					toast.error("ChatGPT 登录失败", { description: next.error || "请重新发起登录。" });
				}
			} catch (error) {
				if (!disposed) {
					toast.error("检查登录状态失败", { description: errorMessage(error) });
					setAttempt(undefined);
				}
			}
		};
		const interval = window.setInterval(() => void check(), 1500);
		void check();
		return () => {
			disposed = true;
			window.clearInterval(interval);
		};
	}, [attempt?.loginId, attempt?.status, refreshAccount, toast]);

	const startLogin = async () => {
		setBusy("login");
		try {
			const next = await beginCodexAccountLogin();
			setAttempt(next);
			if (next.authUrl) await openExternalUrl(next.authUrl);
			toast.info("ChatGPT 登录页已打开", { description: "请在浏览器中完成授权。" });
		} catch (error) {
			toast.error("无法开始登录", { description: errorMessage(error) });
		} finally {
			setBusy("");
		}
	};

	const reopenLogin = async () => {
		if (!attempt?.authUrl) return;
		try {
			await openExternalUrl(attempt.authUrl);
		} catch (error) {
			toast.error("打开登录页失败", { description: errorMessage(error) });
		}
	};

	const cancelLogin = async () => {
		if (!attempt) return;
		setBusy("cancel");
		try {
			const next = await cancelCodexAccountLogin(attempt.loginId);
			setAttempt(next);
			toast.info("登录已取消");
		} catch (error) {
			toast.error("取消失败", { description: errorMessage(error) });
		} finally {
			setBusy("");
		}
	};

	const logout = async () => {
		setBusy("logout");
		try {
			const next = await logoutCodexAccount();
			await mutate(next, false);
			toast.success("已退出全局 Codex 账号");
			return true;
		} catch (error) {
			toast.error("退出失败", { description: errorMessage(error) });
			return false;
		} finally {
			setBusy("");
		}
	};

	const confirmLogout = () => {
		void confirmDialog({
			title: "退出全局 Codex 账号？",
			description: "退出后，共享同一 Codex 目录的 CLI、IDE 和其他客户端也需要重新登录。",
			confirmLabel: "退出全局账号",
			confirmIcon: <LogOut />,
			onConfirm: logout,
		});
	};

	const loggedIn = account?.status === "loggedIn";
	const pending = attempt?.status === "pending";
	const status = isLoading
		? ("loading" as const)
		: accountError
			? ("error" as const)
			: loggedIn
				? ("loggedIn" as const)
				: pending
					? ("pending" as const)
					: ("loggedOut" as const);

	return (
		<CodexRelayPanel
			title="Codex 接入"
			description="选择 ChatGPT 官方订阅，或通过中转平台接入 Codex。"
			officialChannel={{
				status,
				email: account?.email,
				detail: loggedIn ? `${planLabel(account.planType)} · ${account.codexHome}` : undefined,
				busy: busy !== "",
				onCancel: () => void cancelLogin(),
				onLogin: () => void startLogin(),
				onLogout: confirmLogout,
				onReopen: () => void reopenLogin(),
			}}
		/>
	);
};

const planLabel = (value?: string) => {
	if (!value) return "ChatGPT 订阅";
	return `ChatGPT ${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

const errorMessage = (error: unknown) =>
	error instanceof Error && error.message ? error.message : "操作失败，请重试。";
