import { Download, ExternalLink, RefreshCw, Upload } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { DesktopUpdateCapability, DesktopUpdateStatus } from "@/shared/desktop/types";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import {
	checkDesktopUpdate,
	downloadDesktopUpdate,
	getDesktopAppVersion,
	getDesktopUpdateCapability,
	installDesktopUpdate,
	openExternalUrl,
	subscribeDesktopUpdateStatus,
} from "@/shared/desktop/actions";

type LocalUiState = {
	appVersion: string | null;
	capability: DesktopUpdateCapability | null;
	status: DesktopUpdateStatus | null;
	checking: boolean;
	downloading: boolean;
	installing: boolean;
};

const initialState: LocalUiState = {
	appVersion: null,
	capability: null,
	status: null,
	checking: false,
	downloading: false,
	installing: false,
};

export const UpdatesPanel: React.FC = () => {
	const toast = useToast();
	const [state, setState] = useState<LocalUiState>(initialState);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			const [appVersion, capability] = await Promise.all([
				getDesktopAppVersion(),
				getDesktopUpdateCapability(),
			]);
			if (cancelled) return;
			setState((current) => ({
				...current,
				appVersion: appVersion ?? null,
				capability,
			}));
		})();

		const unsubscribe = subscribeDesktopUpdateStatus((status) => {
			setState((current) => ({ ...current, status }));
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const supportsAutoUpdate = state.capability?.supportsAutoUpdate === true;
	const status = state.status;
	const busy = state.checking || state.downloading || state.installing;
	const canDownload = supportsAutoUpdate && status?.phase === "available";
	const canInstall = supportsAutoUpdate && status?.phase === "downloaded";

	const check = async () => {
		setState((current) => ({ ...current, checking: true }));
		try {
			const ack = await checkDesktopUpdate();
			if (!ack.ok) {
				toast.error("检查更新失败", { description: ack.message });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "无法连接更新服务，请稍后再试。";
			toast.error("检查更新失败", { description: message });
		} finally {
			setState((current) => ({ ...current, checking: false }));
		}
	};

	const download = async () => {
		if (!canDownload) return;
		setState((current) => ({ ...current, downloading: true }));
		try {
			const ack = await downloadDesktopUpdate();
			if (!ack.ok) {
				toast.error("下载更新失败", { description: ack.message });
			} else {
				toast.success("下载完成", { description: "点击“安装更新并重启”以完成升级。" });
			}
		} finally {
			setState((current) => ({ ...current, downloading: false }));
		}
	};

	const install = async () => {
		if (!canInstall) return;
		setState((current) => ({ ...current, installing: true }));
		try {
			const ack = await installDesktopUpdate();
			if (!ack.ok) {
				toast.error("安装更新失败", { description: ack.message });
				setState((current) => ({ ...current, installing: false }));
			}
			// On success the app quits immediately; no need to reset state.
		} catch (error) {
			const message = error instanceof Error ? error.message : "安装更新失败。";
			toast.error("安装更新失败", { description: message });
			setState((current) => ({ ...current, installing: false }));
		}
	};

	const openReleasePage = async () => {
		const url = state.capability?.releasePageUrl;
		if (!url) return;
		await openExternalUrl(url);
	};

	const title = useMemo(() => statusTitle(status), [status]);

	return (
		<SettingsPanelLayout
			icon={<RefreshCw />}
			title="应用更新"
			description="检查 GitHub Releases 中的桌面端增量更新包。"
			actions={
				supportsAutoUpdate ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void check()}
					>
						{state.checking ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw />}
						<span>{state.checking ? "检查中" : "检查更新"}</span>
					</Button>
				) : null
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

				{status?.phase === "downloading" && status.progress ? (
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

				{supportsAutoUpdate ? (
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="secondary"
							onClick={() => void download()}
							disabled={busy || !canDownload}
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
							disabled={busy || !canInstall}
						>
							{state.installing ? (
								<RefreshCw className="size-3.5 animate-spin" />
							) : (
								<Upload className="size-3.5" />
							)}
							<span>{state.installing ? "安装中" : "安装更新并重启"}</span>
						</Button>
					</div>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						<Button type="button" variant="default" onClick={() => void openReleasePage()}>
							<ExternalLink className="size-3.5" />
							<span>前往下载页</span>
						</Button>
						<p className="text-xs text-muted-foreground">
							{state.capability?.reason ?? "当前运行环境不支持应用内更新，请前往下载页升级。"}
						</p>
					</div>
				)}
			</section>
		</SettingsPanelLayout>
	);
};

const statusTitle = (status: DesktopUpdateStatus | null): string => {
	if (!status) return "待检测";
	switch (status.phase) {
		case "idle":
			return "待检测";
		case "checking":
			return "正在检查更新";
		case "available":
			return "检测到新版本";
		case "downloading":
			return "下载中";
		case "downloaded":
			return "更新已下载";
		case "up-to-date":
			return "已是最新版本";
		case "error":
			return "更新服务异常";
	}
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
