import { CheckCircle2, ExternalLink, Loader2, LogIn, LogOut, RefreshCw } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { isAgentRuntimeConfigKey } from "@/domains/agent/api/agent";
import {
	type CodexLoginAttempt,
	beginCodexAccountLogin,
	cancelCodexAccountLogin,
	codexAccountKey,
	codexRelaySettingsKey,
	getCodexAccount,
	getCodexAccountLogin,
	getCodexRelaySettings,
	logoutCodexAccount,
	saveCodexRelaySettings,
} from "@/domains/settings/api/settings";
import { CodexRelayPanel } from "@/domains/settings/components/CodexRelayPanel";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Button } from "@/shared/components/ui/button";
import { openExternalUrl } from "@/shared/desktop/actions";
import { cn } from "@/shared/lib/utils";

export const CodexAccessPanel: React.FC = () => {
	const toast = useToast();
	const { mutate: mutateGlobal } = useSWRConfig();
	const {
		data: account,
		error: accountError,
		isLoading,
		mutate,
	} = useSWR(codexAccountKey, getCodexAccount);
	const { data: relay } = useSWR(codexRelaySettingsKey, getCodexRelaySettings);
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

	const useOfficialChannel = async () => {
		if (!relay?.enabled) return;
		setBusy("official");
		try {
			const next = await saveCodexRelaySettings({
				enabled: false,
				activeProfileId: relay.activeProfileId || "",
				profiles: relay.profiles.map(({ id, name, baseURL, model, protocol, enabled }) => ({
					id,
					name,
					baseURL,
					model,
					protocol,
					enabled,
				})),
			});
			await mutateGlobal(codexRelaySettingsKey, next, { revalidate: false });
			void mutateGlobal(isAgentRuntimeConfigKey, undefined, { revalidate: true });
			toast.success("已切换到 ChatGPT 官方订阅");
		} catch (error) {
			toast.error("切换失败", { description: errorMessage(error) });
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

	return (
		<CodexRelayPanel
			title="Codex 接入"
			description="使用 ChatGPT 官方订阅，或配置 Codex 中转站。"
			beforeContent={
				<OfficialAccountCard
					account={account}
					attempt={attempt}
					busy={busy}
					error={accountError}
					isLoading={isLoading}
					relayEnabled={relay?.enabled ?? false}
					onCancel={() => void cancelLogin()}
					onLogin={() => void startLogin()}
					onLogout={confirmLogout}
					onReopen={() => void reopenLogin()}
					onUseOfficial={() => void useOfficialChannel()}
				/>
			}
		/>
	);
};

const OfficialAccountCard: React.FC<{
	account?: Awaited<ReturnType<typeof getCodexAccount>>;
	attempt?: CodexLoginAttempt;
	busy: string;
	error?: unknown;
	isLoading: boolean;
	relayEnabled: boolean;
	onCancel: () => void;
	onLogin: () => void;
	onLogout: () => void;
	onReopen: () => void;
	onUseOfficial: () => void;
}> = ({
	account,
	attempt,
	busy,
	error,
	isLoading,
	relayEnabled,
	onCancel,
	onLogin,
	onLogout,
	onReopen,
	onUseOfficial,
}) => {
	const loggedIn = account?.status === "loggedIn";
	const pending = attempt?.status === "pending";
	return (
		<div className="rounded-md border border-border bg-card p-4">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-sm font-semibold text-foreground">ChatGPT 官方订阅</h3>
						<span
							className={cn(
								"rounded-control border px-2 py-0.5 text-[11px] font-medium",
								relayEnabled
									? "border-border text-muted-foreground"
									: "border-primary/30 bg-primary/10 text-primary",
							)}
						>
							{relayEnabled ? "未使用" : "当前渠道"}
						</span>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						复用全局 Codex 登录态，无需另外安装或重复配置 Codex。
					</p>
					{isLoading ? (
						<p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							正在读取全局账号
						</p>
					) : error ? (
						<p className="mt-3 text-xs text-error-foreground">内置 Codex 账号服务不可用。</p>
					) : loggedIn ? (
						<div className="mt-3 space-y-1 text-xs">
							<p className="flex items-center gap-2 text-success-foreground">
								<CheckCircle2 className="size-3.5" />
								已登录
							</p>
							{account.email ? <p className="text-foreground">{account.email}</p> : null}
							<p className="text-muted-foreground">
								{planLabel(account.planType)} · {account.codexHome}
							</p>
						</div>
					) : (
						<p className="mt-3 text-xs text-muted-foreground">尚未登录全局 Codex 账号。</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{relayEnabled ? (
						<Button disabled={busy !== ""} variant="outline" onClick={onUseOfficial}>
							{busy === "official" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
							使用官方渠道
						</Button>
					) : null}
					{pending ? (
						<>
							<Button
								disabled={!attempt?.authUrl || busy !== ""}
								variant="outline"
								onClick={onReopen}
							>
								<ExternalLink />
								重新打开浏览器
							</Button>
							<Button disabled={busy !== ""} variant="outline" onClick={onCancel}>
								{busy === "cancel" ? <Loader2 className="animate-spin" /> : null}取消
							</Button>
						</>
					) : loggedIn ? (
						<Button disabled={busy !== ""} variant="outline" onClick={onLogout}>
							<LogOut />
							退出全局账号
						</Button>
					) : (
						<Button disabled={busy !== "" || Boolean(error)} onClick={onLogin}>
							{busy === "login" ? <Loader2 className="animate-spin" /> : <LogIn />}
							使用 ChatGPT 登录
						</Button>
					)}
				</div>
			</div>
		</div>
	);
};

const planLabel = (value?: string) => {
	if (!value) return "ChatGPT 订阅";
	return `ChatGPT ${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

const errorMessage = (error: unknown) =>
	error instanceof Error && error.message ? error.message : "操作失败，请重试。";
