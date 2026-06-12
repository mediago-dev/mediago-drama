import {
	Check,
	ExternalLink,
	FolderOpen,
	KeyRound,
	Loader2,
	LogIn,
	Save,
	SlidersHorizontal,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import useSWR from "swr";
import {
	type APIKeyLoginChallenge,
	type APIKeyProvider,
	apiKeysKey,
	beginProviderLogin,
	clearAPIKey,
	completeProviderLogin,
	getAPIKeys,
	saveAPIKey,
} from "@/domains/settings/api/settings";
import { AgentModelProfilesPanel } from "@/domains/settings/components/AgentModelProfilesPanel";
import { BillingPanel } from "@/domains/billing/components/BillingPanel";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { useToast } from "@/hooks/useToast";
import { settingsInsetRowClassName } from "@/lib/settings-layout";
import { useSettingsNavigationStore } from "@/lib/stores/settings";
import { useThemeStore, type ThemeMode } from "@/shared/stores/theme";
import { cn } from "@/shared/lib/utils";
import { DebugTabPanel, debugTabs, type DebugTabValue } from "@/pages/Debug";
import { ProjectSettings } from "@/pages/ProjectSettings";
import { getRouteProjectId } from "@/domains/workspace/lib/workbench-route";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import { isTauriRuntime, openProjectDirectory } from "@/domains/projects/lib/project-directory";

type SettingsTabValue =
	| "appearance"
	| "api-keys"
	| "agent-model-profiles"
	| "billing"
	| DebugTabValue;

const isSettingsTabValue = (value: string): value is SettingsTabValue =>
	value === "appearance" ||
	value === "api-keys" ||
	value === "agent-model-profiles" ||
	value === "billing" ||
	debugTabs.some((tab) => tab.value === value);

export const Settings: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const themeMode = useThemeStore((state) => state.mode);
	const setThemeMode = useThemeStore((state) => state.setMode);
	const activeTab = useSettingsNavigationStore((state) => state.activeTab);
	const visibleTab = isSettingsTabValue(activeTab) ? activeTab : "appearance";

	if (projectId) return <ProjectSettings />;

	return (
		<div className="h-full min-h-0 overflow-hidden bg-ide-editor text-ide-editor-foreground">
			{visibleTab === "appearance" ? (
				<AppearancePanel mode={themeMode} onSelectMode={setThemeMode} />
			) : null}

			{visibleTab === "api-keys" ? <APIKeysPanel /> : null}
			{visibleTab === "agent-model-profiles" ? <AgentModelProfilesPanel /> : null}
			{visibleTab === "billing" ? <BillingPanel /> : null}

			{debugTabs.map((tab) =>
				visibleTab === tab.value ? <DebugTabPanel key={tab.value} value={tab.value} /> : null,
			)}
		</div>
	);
};

const APIKeysPanel: React.FC = () => {
	const toast = useToast();
	const { data, mutate, isLoading } = useSWR(apiKeysKey, getAPIKeys);
	const providers = data?.providers ?? [];
	const [apiKeys, setAPIKeys] = useState<Record<string, string>>({});
	const [savingID, setSavingID] = useState<string>();
	const [clearingID, setClearingID] = useState<string>();
	const [loggingInID, setLoggingInID] = useState<string>();
	const [checkingLoginID, setCheckingLoginID] = useState<string>();
	const [loginChallenges, setLoginChallenges] = useState<Record<string, APIKeyLoginChallenge>>({});

	const updateAPIKey = (providerID: string, value: string) => {
		setAPIKeys((current) => ({ ...current, [providerID]: value }));
	};

	const save = async (provider: APIKeyProvider) => {
		const apiKey = apiKeys[provider.id]?.trim() ?? "";
		if (!apiKey) return;

		setSavingID(provider.id);
		try {
			const nextData = await saveAPIKey(provider.id, apiKey);
			await mutate(nextData, false);
			setAPIKeys((current) => ({ ...current, [provider.id]: "" }));
			toast.success("API Key 已保存", { description: provider.label });
		} catch (err) {
			const message = err instanceof Error ? err.message : "保存 API Key 失败。";
			toast.error("保存失败", { description: message });
		} finally {
			setSavingID(undefined);
		}
	};

	const clear = async (provider: APIKeyProvider) => {
		setClearingID(provider.id);
		try {
			const nextData = await clearAPIKey(provider.id);
			await mutate(nextData, false);
			setAPIKeys((current) => ({ ...current, [provider.id]: "" }));
			toast.success("API Key 已清除", { description: provider.label });
		} catch (err) {
			const message = err instanceof Error ? err.message : "清除 API Key 失败。";
			toast.error("清除失败", { description: message });
		} finally {
			setClearingID(undefined);
		}
	};

	const login = async (provider: APIKeyProvider) => {
		setLoggingInID(provider.id);
		try {
			const nextData = await beginProviderLogin(provider.id, provider.configured);
			await mutate(nextData, false);
			if (nextData.login.status === "pending") {
				setLoginChallenges((current) => ({ ...current, [provider.id]: nextData.login }));
				if (nextData.login.verificationUri) {
					await openExternalURL(nextData.login.verificationUri);
				}
				toast.info("即梦授权已打开", {
					description: nextData.login.userCode
						? `验证码：${nextData.login.userCode}`
						: provider.label,
				});
				return;
			}
			setLoginChallenges((current) => withoutRecordKey(current, provider.id));
			toast.success("登录已完成", { description: provider.label });
		} catch (err) {
			const message = err instanceof Error ? err.message : "登录失败。";
			toast.error("登录失败", { description: message });
		} finally {
			setLoggingInID(undefined);
		}
	};

	const openLoginChallenge = async (provider: APIKeyProvider) => {
		const challenge = loginChallenges[provider.id];
		if (!challenge?.verificationUri) return;
		try {
			await openExternalURL(challenge.verificationUri);
		} catch (err) {
			const message = err instanceof Error ? err.message : "打开即梦授权页失败。";
			toast.error("打开失败", { description: message });
		}
	};

	const completeLogin = async (provider: APIKeyProvider) => {
		const challenge = loginChallenges[provider.id];
		if (!challenge?.deviceCode) return;

		setCheckingLoginID(provider.id);
		try {
			const nextData = await completeProviderLogin(provider.id, challenge.deviceCode);
			await mutate(nextData, false);
			setLoginChallenges((current) => withoutRecordKey(current, provider.id));
			toast.success("登录已完成", { description: provider.label });
		} catch (err) {
			const message = err instanceof Error ? err.message : "登录确认失败。";
			toast.error("确认失败", { description: message });
		} finally {
			setCheckingLoginID(undefined);
		}
	};

	return (
		<SettingsPanelLayout
			title="API 密钥"
			description="管理所有供应商凭据。"
			icon={<KeyRound className="size-4" />}
		>
			<div className="space-y-3">
				{isLoading && providers.length === 0 ? (
					<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>加载中</span>
					</div>
				) : null}
				{!isLoading && providers.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">暂无可配置供应商。</p>
				) : null}
				{providers.map((provider) => {
					const apiKey = apiKeys[provider.id] ?? "";
					const isSaving = savingID === provider.id;
					const isClearing = clearingID === provider.id;
					const isLoggingIn = loggingInID === provider.id;
					const isCheckingLogin = checkingLoginID === provider.id;
					return (
						<APIKeyProviderRow
							key={provider.id}
							provider={provider}
							apiKey={apiKey}
							isSaving={isSaving}
							isClearing={isClearing}
							isLoggingIn={isLoggingIn}
							isCheckingLogin={isCheckingLogin}
							loginChallenge={loginChallenges[provider.id]}
							onAPIKeyChange={(value) => updateAPIKey(provider.id, value)}
							onClear={() => void clear(provider)}
							onConfirmLogin={() => void completeLogin(provider)}
							onLogin={() => void login(provider)}
							onOpenLogin={() => void openLoginChallenge(provider)}
							onSave={() => void save(provider)}
						/>
					);
				})}
			</div>
		</SettingsPanelLayout>
	);
};

const withoutRecordKey = <TValue,>(values: Record<string, TValue>, key: string) => {
	const next = { ...values };
	delete next[key];
	return next;
};

const openExternalURL = async (url: string) => {
	if (isTauriRuntime()) {
		const { openUrl } = await import("@tauri-apps/plugin-opener");
		await openUrl(url);
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
};

const AppearancePanel: React.FC<{
	mode: ThemeMode;
	onSelectMode: (mode: ThemeMode) => void;
}> = ({ mode, onSelectMode }) => {
	const toast = useToast();
	const { data: projectsPayload } = useSWR(projectsKey, getProjects);
	const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
	const selectedThemeOption =
		themeModeOptions.find((option) => option.value === mode) ?? themeModeOptions[0];
	const workspaceDir = projectsPayload?.workspaceDir ?? "";
	const canOpenWorkspaceDir = Boolean(workspaceDir) && isTauriRuntime();

	const openWorkspaceDir = async () => {
		if (!workspaceDir || isOpeningWorkspace) return;

		setIsOpeningWorkspace(true);
		try {
			await openProjectDirectory(workspaceDir);
		} catch (err) {
			const message = err instanceof Error ? err.message : "打开全局目录失败。";
			toast.error("打开失败", { description: message });
		} finally {
			setIsOpeningWorkspace(false);
		}
	};

	return (
		<SettingsPanelLayout
			title="基础设置"
			description="管理工作区的基础偏好。"
			icon={<SlidersHorizontal className="size-4" />}
		>
			<div className="space-y-3">
				<div className={cn(settingsInsetRowClassName, "flex items-center justify-between gap-3")}>
					<div className="min-w-0">
						<p className="text-sm font-medium text-foreground">全局目录</p>
						<p className="mt-1 truncate text-xs text-muted-foreground">
							{workspaceDir || "正在读取工作区目录"}
						</p>
					</div>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="shrink-0"
						disabled={!canOpenWorkspaceDir || isOpeningWorkspace}
						onClick={() => void openWorkspaceDir()}
						title={canOpenWorkspaceDir ? "打开全局目录" : "当前运行环境不支持打开本地文件夹"}
					>
						{isOpeningWorkspace ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<FolderOpen className="size-3.5" />
						)}
						<span>打开</span>
					</Button>
				</div>
				<div
					className={cn(
						settingsInsetRowClassName,
						"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,var(--settings-control-column-max))] md:items-start",
					)}
				>
					<div className="min-w-0">
						<Label htmlFor="theme-mode" className="text-sm font-medium text-foreground">
							外观
						</Label>
						<p className="mt-1 text-xs text-muted-foreground">选择工作区主题显示方式。</p>
					</div>
					<div className="min-w-0">
						<Select value={mode} onValueChange={(value) => onSelectMode(value as ThemeMode)}>
							<SelectTrigger id="theme-mode" className="rounded-md">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{themeModeOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="mt-2 text-xs text-muted-foreground">{selectedThemeOption.description}</p>
					</div>
				</div>
			</div>
		</SettingsPanelLayout>
	);
};

const themeModeOptions: Array<{
	description: string;
	label: string;
	value: ThemeMode;
}> = [
	{ value: "light", label: "浅色", description: "使用浅色编辑器和面板。" },
	{ value: "dark", label: "深色", description: "使用深色编辑器和面板。" },
	{ value: "system", label: "跟随系统", description: "根据系统外观自动切换。" },
];

const APIKeyProviderRow: React.FC<{
	apiKey: string;
	isCheckingLogin: boolean;
	isClearing: boolean;
	isLoggingIn: boolean;
	isSaving: boolean;
	loginChallenge?: APIKeyLoginChallenge;
	onAPIKeyChange: (value: string) => void;
	onClear: () => void;
	onConfirmLogin: () => void;
	onLogin: () => void;
	onOpenLogin: () => void;
	onSave: () => void;
	provider: APIKeyProvider;
}> = ({
	apiKey,
	isCheckingLogin,
	isClearing,
	isLoggingIn,
	isSaving,
	loginChallenge,
	onAPIKeyChange,
	onClear,
	onConfirmLogin,
	onLogin,
	onOpenLogin,
	onSave,
	provider,
}) => {
	const inputID = `api-key-${provider.id}`;
	const canClear = provider.configured || Boolean(apiKey);
	const isOAuthProvider = provider.credentialKind === "oauth";
	const isLoginPending = loginChallenge?.status === "pending";

	return (
		<section className="grid gap-3 py-2 lg:grid-cols-[minmax(var(--settings-provider-column-min),var(--settings-provider-column-max))_minmax(0,1fr)_auto] lg:items-start">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<h3 className="truncate text-sm font-semibold text-foreground">{provider.label}</h3>
					<ProviderBadge provider={provider} />
				</div>
				<p className="mt-1 text-xs text-muted-foreground">
					{providerDescription(provider.description)}
				</p>
				{provider.masked ? (
					<p className="mt-2 truncate rounded-md bg-ide-toolbar px-2 py-1 font-mono text-xs text-foreground">
						{provider.masked}
					</p>
				) : null}
			</div>

			<div className="min-w-0">
				{isOAuthProvider ? (
					<div>
						<Label className="mb-2 block text-xs text-muted-foreground">登录状态</Label>
						<div className="flex min-h-8 items-center rounded-md border border-border bg-ide-toolbar px-3 text-xs text-foreground">
							<span>
								{isLoginPending
									? "等待即梦授权确认"
									: provider.configured
										? "本地即梦会话已记录"
										: "需要登录即梦账号"}
							</span>
						</div>
						{isLoginPending ? (
							<div className="mt-2 grid gap-1.5 rounded-md border border-border bg-ide-toolbar px-3 py-2 text-xs text-muted-foreground">
								{loginChallenge.userCode ? (
									<div className="flex items-center justify-between gap-2">
										<span>验证码</span>
										<span className="font-mono text-foreground">{loginChallenge.userCode}</span>
									</div>
								) : null}
								{loginChallenge.verificationUri ? (
									<div className="flex items-center justify-between gap-2">
										<span className="shrink-0">授权页</span>
										<span className="min-w-0 truncate font-mono text-foreground">
											{loginChallenge.verificationUri}
										</span>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				) : (
					<>
						<Label htmlFor={inputID} className="mb-2 block text-xs text-muted-foreground">
							{providerCredentialLabel(provider.credentialLabel)}
						</Label>
						<Input
							id={inputID}
							type="password"
							value={apiKey}
							onChange={(event) => onAPIKeyChange(event.target.value)}
							placeholder={
								provider.placeholder ??
								(provider.configured ? "输入新的 Key 以替换当前凭据" : "输入 API Key")
							}
							className="h-8 rounded-md font-mono text-xs text-foreground"
						/>
					</>
				)}
				{provider.help ? (
					<p className="mt-2 text-xs text-muted-foreground">{providerHelp(provider.help)}</p>
				) : null}
			</div>

			<div className="flex items-center gap-2 lg:pt-6">
				<Button
					type="button"
					variant="outline"
					disabled={isClearing || !canClear}
					onClick={onClear}
					className="rounded-md"
				>
					{isClearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
					<span>清除</span>
				</Button>
				{isOAuthProvider ? (
					<>
						{isLoginPending && loginChallenge?.verificationUri ? (
							<Button
								type="button"
								variant="outline"
								onClick={onOpenLogin}
								className="rounded-md"
								title="打开即梦授权页"
							>
								<ExternalLink />
								<span>打开</span>
							</Button>
						) : null}
						{isLoginPending ? (
							<Button
								type="button"
								disabled={isCheckingLogin}
								onClick={onConfirmLogin}
								className="rounded-md"
								title="确认即梦登录"
							>
								{isCheckingLogin ? <Loader2 className="animate-spin" /> : <Check />}
								<span>确认</span>
							</Button>
						) : (
							<Button
								type="button"
								disabled={isLoggingIn}
								onClick={onLogin}
								className="rounded-md"
								title="打开即梦登录授权"
							>
								{isLoggingIn ? <Loader2 className="animate-spin" /> : <LogIn />}
								<span>{provider.configured ? "重新登录" : "登录"}</span>
							</Button>
						)}
					</>
				) : (
					<Button
						type="button"
						disabled={!apiKey.trim() || isSaving}
						onClick={onSave}
						className="rounded-md"
					>
						{isSaving ? <Loader2 className="animate-spin" /> : <Save />}
						<span>保存</span>
					</Button>
				)}
			</div>
		</section>
	);
};

const ProviderBadge: React.FC<{
	provider: APIKeyProvider;
}> = ({ provider }) => {
	if (!provider.configured) {
		return (
			<Badge variant="outline" className="rounded-md">
				未填写
			</Badge>
		);
	}

	return (
		<Badge variant="secondary" className="rounded-md">
			{provider.credentialKind === "oauth" ? "已登录" : "已保存"}
		</Badge>
	);
};

const providerDescription = (description: string) => {
	const descriptions: Record<string, string> = {
		"DMX aggregation platform": "DMX 聚合平台",
		"OpenRouter multimodal routes": "OpenRouter 多模态供应商",
		"OpenAI official image routes": "OpenAI 官方图像供应商",
		"Google official image routes": "Google 官方图像供应商",
		"Seedream and Seedance official routes": "Seedream 和 Seedance 官方供应商",
		"Jimeng CLI local OAuth session": "即梦 CLI 本地登录",
	};
	return descriptions[description] ?? description;
};

const providerCredentialLabel = (label?: string) => {
	if (!label) return "API Key";
	if (label === "AccessKey / SecretKey") return "AccessKey / SecretKey";
	return label;
};

const providerHelp = (help?: string) => {
	return help ?? "";
};
