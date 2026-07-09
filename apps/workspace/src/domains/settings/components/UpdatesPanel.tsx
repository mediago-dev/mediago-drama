import { Download, ExternalLink, RefreshCw, Upload } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type {
	DesktopUpdateCapability,
	DesktopUpdateStatus,
	BundleUpdateCapability,
	BundleUpdateStatus,
} from "@/shared/desktop/types";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import {
	applyBundleUpdate,
	checkDesktopUpdate,
	checkBundleUpdate,
	downloadDesktopUpdate,
	getDesktopAppVersion,
	getDesktopUpdateCapability,
	getBundleUpdateCapability,
	installDesktopUpdate,
	openExternalUrl,
	subscribeDesktopUpdateStatus,
	subscribeBundleUpdateStatus,
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

				<BundleUpdateSection />
			</section>
		</SettingsPanelLayout>
	);
};

// Application-bundle hot updates (renderer + server binary pair): staged in the
// background, applied on next launch or immediately while the server is idle.
// Hidden entirely until the shell reports the feature enabled.
const BundleUpdateSection: React.FC = () => {
	const toast = useToast();
	const [capability, setCapability] = useState<BundleUpdateCapability | null>(null);
	const [status, setStatus] = useState<BundleUpdateStatus | null>(null);
	const [checking, setChecking] = useState(false);
	const [applying, setApplying] = useState(false);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			const next = await getBundleUpdateCapability();
			if (!cancelled) setCapability(next);
		})();

		const unsubscribe = subscribeBundleUpdateStatus((next) => {
			setStatus(next);
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	if (!capability?.enabled) return null;

	const check = async () => {
		setChecking(true);
		try {
			const ack = await checkBundleUpdate();
			if (!ack.ok) {
				toast.error("检查更新失败", { description: ack.message });
			}
		} finally {
			setChecking(false);
		}
	};

	// On success the window reloads from the new bundle — this component unmounts.
	const applyNow = async () => {
		setApplying(true);
		try {
			const ack = await applyBundleUpdate();
			if (!ack.ok) {
				toast.error("应用更新失败", { description: ack.message });
				setApplying(false);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "应用更新失败。";
			toast.error("应用更新失败", { description: message });
			setApplying(false);
		}
	};

	return (
		<div className="space-y-3 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-2">
				<div>
					<p className="text-sm font-medium text-foreground">热更新</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						小体积更新包（界面 + 服务），后台下载，重启应用或空闲时立即应用，无需重新安装。
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={checking}
					onClick={() => void check()}
				>
					{checking ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw />}
					<span>{checking ? "检查中" : "检查热更新"}</span>
				</Button>
			</div>

			<div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm">
				<div className="flex items-center justify-between gap-2">
					<p className="text-muted-foreground">当前热更版本</p>
					<p className="font-mono text-foreground">
						rev {capability.currentRev}
						{capability.source === "downloaded" ? "（热更新）" : "（内置）"}
					</p>
				</div>
				<div className="mt-2 flex items-center justify-between gap-2">
					<p className="text-muted-foreground">状态</p>
					<p className="truncate text-foreground">{bundleStatusTitle(status)}</p>
				</div>
			</div>

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

			{status?.phase === "staged" ? (
				<div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-success-surface px-3 py-2">
					<p className="text-xs text-success-foreground">
						新版本（rev {status.targetRev}）已就绪，重启应用后生效；服务空闲时也可立即应用。
						{status.notes ? ` ${status.notes}` : ""}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={applying}
						onClick={() => void applyNow()}
					>
						{applying ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw />}
						<span>{applying ? "应用中" : "立即应用"}</span>
					</Button>
				</div>
			) : null}

			{status?.phase === "requires-full-update" ? (
				<p className="rounded-md border border-border bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
					{status.notes ?? "新版本需要更新桌面端主程序，请通过上方应用更新升级完整版本。"}
				</p>
			) : null}

			{status?.error ? (
				<p className="rounded-md border border-error/40 bg-error-surface px-3 py-2 text-xs text-error-foreground">
					{status.error}
				</p>
			) : null}
		</div>
	);
};

const bundleStatusTitle = (status: BundleUpdateStatus | null): string => {
	if (!status) return "待检测";
	switch (status.phase) {
		case "idle":
			return "待检测";
		case "checking":
			return "正在检查";
		case "downloading":
			return "下载中";
		case "staged":
			return "待生效（重启或立即应用）";
		case "applying":
			return "正在应用";
		case "up-to-date":
			return "已是最新版本";
		case "requires-full-update":
			return "需要完整更新";
		case "error":
			return "热更新异常";
	}
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
