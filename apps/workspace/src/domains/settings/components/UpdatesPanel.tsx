import { Download, RefreshCw, Upload } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
	type DesktopUpdateActionResult,
	type DesktopUpdateCheckResult,
	type DesktopUpdateStatus,
} from "@/shared/desktop/types";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import {
	checkDesktopUpdate,
	downloadDesktopUpdate,
	getDesktopAppVersion,
	installDesktopUpdate,
	subscribeDesktopUpdateStatus,
} from "@/shared/desktop/actions";
import { isDesktopRuntime } from "@/shared/desktop/runtime";

type LocalUiState = {
	appVersion: string | null;
	checking: boolean;
	downloading: boolean;
	installing: boolean;
	checkResult: DesktopUpdateCheckResult | null;
	latestStatus: DesktopUpdateStatus | null;
};

export const UpdatesPanel: React.FC = () => {
	const toast = useToast();
	const [state, setState] = useState<LocalUiState>({
		appVersion: null,
		checking: false,
		downloading: false,
		installing: false,
		checkResult: null,
		latestStatus: null,
	});

	useEffect(() => {
		let cancelled = false;

		if (!isDesktopRuntime()) return;

		void (async () => {
			const appVersion = await getDesktopAppVersion();
			if (!cancelled) {
				setState((current) => ({ ...current, appVersion: appVersion ?? null }));
			}
		})();

		const unsubscribe = subscribeDesktopUpdateStatus((status) => {
			setState((current) => ({ ...current, latestStatus: status }));
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const checkSupported = isDesktopRuntime() && (state.checkResult?.supported ?? true);
	const status = state.latestStatus || state.checkResult?.status || null;
	const isCheckingDisabled = state.checking || state.downloading || state.installing;
	const canDownload = status?.phase === "available" && state.checkResult?.supported !== false;
	const canInstall = status?.phase === "downloaded" && state.checkResult?.supported !== false;

	const runAction = async (
		action: () => Promise<DesktopUpdateActionResult>,
		successMessage: string,
	) => {
		try {
			const result = await action();
			if (!result.ok) {
				toast.error("更新操作失败", { description: result.message || "请稍后重试。" });
				return;
			}
			toast.success(successMessage, {
				description: result.message,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "更新操作失败。";
			toast.error("更新操作失败", { description: message });
		}
	};

	const check = async () => {
		setState((current) => ({ ...current, checking: true }));
		try {
			const next = await checkDesktopUpdate();
			const mergedStatus: DesktopUpdateStatus = next.info
				? { ...next.status, info: next.info }
				: next.status;
			setState((current) => ({
				...current,
				checking: false,
				checkResult: next,
				latestStatus: mergedStatus,
			}));
			if (!next.supported) {
				toast.info("更新不可用", { description: next.message || "当前环境暂不支持自动更新。" });
				return;
			}
			if (next.status.phase === "error") {
				const message = next.status.error || next.message;
				if (message) {
					toast.error("检查更新失败", { description: message });
				}
			}
		} catch {
			setState((current) => ({ ...current, checking: false }));
			toast.error("检查更新失败", { description: "无法连接更新服务，请稍后再试。" });
		}
	};

	const download = async () => {
		if (!canDownload) return;
		setState((current) => ({ ...current, downloading: true }));
		await runAction(() => downloadDesktopUpdate(), "开始下载更新包");
		setState((current) => ({ ...current, downloading: false }));
	};

	const install = async () => {
		if (!canInstall) return;
		setState((current) => ({ ...current, installing: true }));
		await runAction(() => installDesktopUpdate(), "准备安装更新");
		setState((current) => ({ ...current, installing: false }));
	};

	const title = useMemo(() => {
		if (!status) return "未检测";
		switch (status.phase) {
			case "checking":
				return "正在检查更新";
			case "available":
				return "检测到新版本";
			case "download-progress":
				return "下载中";
			case "downloaded":
				return "更新已下载";
			case "up-to-date":
				return "已是最新版本";
			case "not-available":
				return "未发现更新";
			case "error":
				return "更新服务异常";
		}
		return "待检测";
	}, [status]);

	return (
		<SettingsPanelLayout
			icon={<RefreshCw />}
			title="应用更新"
			description="检查 GitHub Releases 中的桌面端增量更新包。"
			actions={
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={isCheckingDisabled}
					onClick={() => void check()}
				>
					{state.checking ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw />}
					<span>{state.checking ? "检查中" : "检查更新"}</span>
				</Button>
			}
		>
			<section className="space-y-4">
				<div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm">
					<div className="flex items-center justify-between gap-2">
						<p className="text-muted-foreground">当前版本</p>
						<p className="font-mono text-foreground">{state.appVersion ?? "—"}</p>
					</div>
					<div className="mt-2 flex items-center justify-between gap-2">
						<p className="text-muted-foreground">更新状态</p>
						<p className="truncate text-foreground">{title}</p>
					</div>
				</div>

				{status?.info?.version ? (
					<div className="rounded-md border border-border px-3 py-2 text-sm">
						<p className="text-muted-foreground">可用版本</p>
						<p className="mt-0.5 font-medium text-foreground">{status.info.version}</p>
						{status.info.releaseName ? (
							<p className="mt-1 text-xs text-muted-foreground">{status.info.releaseName}</p>
						) : null}
						{status.info.releaseDate ? (
							<p className="mt-1 text-xs text-muted-foreground">{status.info.releaseDate}</p>
						) : null}
					</div>
				) : null}

				{status?.phase === "download-progress" && status.progress ? (
					<div className="rounded-md border border-border px-3 py-2 text-sm">
						<p className="text-muted-foreground">下载进度：{status.progress.percent.toFixed(1)}%</p>
						<div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full bg-primary transition-all"
								style={{ width: `${Math.min(status.progress.percent, 100).toFixed(1)}%` }}
							/>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							{formatBytes(status.progress.transferred)} / {formatBytes(status.progress.total)}
						</p>
					</div>
				) : null}

				{status?.error ? (
					<p className="rounded-md border border-error/40 bg-error-surface px-3 py-2 text-xs text-error-foreground">
						{status.error}
					</p>
				) : null}

				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={() => void download()}
						disabled={isCheckingDisabled || !canDownload}
					>
						{state.downloading ? (
							<RefreshCw className="size-3.5 animate-spin" />
						) : (
							<Download className="size-3.5" />
						)}
						<span>{state.downloading ? "下载中" : "下载更新"}</span>
					</Button>
					<Button
						type="button"
						variant="default"
						onClick={() => void install()}
						disabled={isCheckingDisabled || !canInstall}
					>
						{state.installing ? (
							<RefreshCw className="size-3.5 animate-spin" />
						) : (
							<Upload className="size-3.5" />
						)}
						<span>{state.installing ? "安装中" : "安装更新并重启"}</span>
					</Button>
					{checkSupported ? null : (
						<p className="w-full text-xs text-muted-foreground">
							当前运行环境不支持桌面自动更新，请使用安装包升级。
						</p>
					)}
				</div>
			</section>
		</SettingsPanelLayout>
	);
};

const formatBytes = (value: number) => {
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = value;
	let index = 0;
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024;
		index += 1;
	}
	return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};
