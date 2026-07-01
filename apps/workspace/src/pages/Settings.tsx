import {
	ArrowRight,
	Check,
	Clapperboard,
	ExternalLink,
	FolderOpen,
	KeyRound,
	Loader2,
	LogIn,
	Pencil,
	Save,
	SlidersHorizontal,
	Sparkles,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	type APIKeyLoginChallenge,
	type APIKeyProvider,
	type ModelPlatform,
	type ModelPlatformModelGroup,
	apiKeysKey,
	beginProviderLogin,
	clearAPIKey,
	completeProviderLogin,
	getAPIKeys,
	getJianyingDraftSettings,
	getModelPlatforms,
	jianyingDraftSettingsKey,
	modelPlatformsKey,
	saveAPIKey,
	saveJianyingDraftSettings,
} from "@/domains/settings/api/settings";
import { ShortcutKeysPanel } from "@/domains/settings/components/ShortcutKeysPanel";
import { BillingPanel } from "@/domains/billing/components/BillingPanel";
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
import { projectSettingsGeneralTab, useSettingsNavigationStore } from "@/lib/stores/settings";
import { useThemeStore, type ThemeMode } from "@/shared/stores/theme";
import { cn } from "@/shared/lib/utils";
import { DebugTabPanel, debugTabs, type DebugTabValue } from "@/pages/Debug";
import { ProjectSettings } from "@/pages/ProjectSettings";
import { getRouteProjectId } from "@/domains/workspace/lib/workbench-route";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import { isDesktopRuntime, openProjectDirectory } from "@/domains/projects/lib/project-directory";
import { openExternalUrl, pickDesktopDirectory } from "@/shared/desktop/actions";

const jianyingDraftSettingsEnabled: boolean = false;
const mediagoProviderID = "mediago";
const mediagoAPIKeyURL = "http://localhost:4321/account#apiKeys";
const apiKeyActionColumnClassName = "flex items-start justify-end gap-2 lg:w-[14.5rem]";
const apiKeyActionButtonClassName = "w-[6.75rem] rounded-md";
const manualProviderActionColumnClassName = "flex items-center justify-end gap-2 lg:w-[16rem]";
const manualProviderActionButtonClassName = "h-8 w-[4.75rem] rounded-md text-muted-foreground";

type SettingsTabValue =
	| "appearance"
	| "api-keys"
	| "billing"
	| "jianying-draft"
	| "shortcuts"
	| DebugTabValue;

const isSettingsTabValue = (value: string): value is SettingsTabValue =>
	value === "appearance" ||
	value === "api-keys" ||
	value === "billing" ||
	(jianyingDraftSettingsEnabled && value === "jianying-draft") ||
	value === "shortcuts" ||
	debugTabs.some((tab) => tab.value === value);

const normalizeSettingsTab = (value: string) =>
	value === "agent-model-profiles"
		? "api-keys"
		: value === "prompt-templates" || value === "instructions"
			? "instructions"
			: value === "prompts" || value === "skills" || value === "prompt-library"
				? "prompt-packs"
				: value;

export const Settings: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const themeMode = useThemeStore((state) => state.mode);
	const setThemeMode = useThemeStore((state) => state.setMode);
	const activeTab = useSettingsNavigationStore((state) => state.activeTab);
	const normalizedTab = normalizeSettingsTab(activeTab);
	const visibleTab = isSettingsTabValue(normalizedTab) ? normalizedTab : "appearance";

	if (projectId && normalizedTab === projectSettingsGeneralTab) return <ProjectSettings />;

	return (
		<div className="h-full min-h-0 overflow-hidden bg-ide-editor text-ide-editor-foreground">
			{visibleTab === "appearance" ? (
				<AppearancePanel mode={themeMode} onSelectMode={setThemeMode} />
			) : null}

			{jianyingDraftSettingsEnabled && visibleTab === "jianying-draft" ? (
				<JianyingDraftPanel />
			) : null}
			{visibleTab === "api-keys" ? <APIKeysPanel /> : null}
			{visibleTab === "billing" ? <BillingPanel /> : null}
			{visibleTab === "shortcuts" ? <ShortcutKeysPanel /> : null}

			{debugTabs.map((tab) =>
				visibleTab === tab.value ? <DebugTabPanel key={tab.value} value={tab.value} /> : null,
			)}
		</div>
	);
};

const APIKeysPanel: React.FC = () => {
	const toast = useToast();
	const { mutate: mutateGlobal } = useSWRConfig();
	const { data, mutate, isLoading } = useSWR(apiKeysKey, getAPIKeys);
	const { data: modelPlatformsData, isLoading: isModelPlatformsLoading } = useSWR(
		modelPlatformsKey,
		getModelPlatforms,
	);
	const providers = data?.providers ?? [];
	const modelPlatforms = modelPlatformsData?.platforms ?? [];
	const providersByID = new Map(providers.map((provider) => [provider.id, provider]));
	const unifiedProviders = platformProviders(modelPlatforms, providersByID, "unified");
	const mediagoPlatform = modelPlatforms.find((platform) => platform.id === mediagoProviderID);
	const mediagoProvider =
		unifiedProviders.find((provider) => provider.id === mediagoProviderID) ??
		providersByID.get(mediagoProviderID);
	const visibleUnifiedProviders = unifiedProviders.filter(
		(provider) => provider.id !== mediagoProviderID,
	);
	const customProviders = platformProviders(modelPlatforms, providersByID, "custom");
	const officialProviders = officialAPIKeyProviders(providers, modelPlatforms);
	const [apiKeys, setAPIKeys] = useState<Record<string, string>>({});
	const [savingID, setSavingID] = useState<string>();
	const [clearingID, setClearingID] = useState<string>();
	const [loggingInID, setLoggingInID] = useState<string>();
	const [checkingLoginID, setCheckingLoginID] = useState<string>();
	const [isMediagoSetupOpen, setIsMediagoSetupOpen] = useState(false);
	const [manualProviderID, setManualProviderID] = useState<string>();
	const [loginChallenges, setLoginChallenges] = useState<Record<string, APIKeyLoginChallenge>>({});
	const hasPendingBrowserLogin = Object.values(loginChallenges).some(
		(challenge) => challenge.status === "pending" && Boolean(challenge.verificationUri),
	);

	useEffect(() => {
		if (!hasPendingBrowserLogin) return;
		const intervalID = window.setInterval(() => {
			void mutate();
		}, 3000);
		return () => window.clearInterval(intervalID);
	}, [hasPendingBrowserLogin, mutate]);

	useEffect(() => {
		if (!data?.providers) return;
		setLoginChallenges((current) => {
			let changed = false;
			const next = { ...current };
			for (const provider of data.providers) {
				if (provider.configured && next[provider.id]?.status === "pending") {
					delete next[provider.id];
					changed = true;
				}
			}
			return changed ? next : current;
		});
	}, [data?.providers]);

	const updateAPIKey = (providerID: string, value: string) => {
		setAPIKeys((current) => ({ ...current, [providerID]: value }));
	};

	const revalidateAgentRuntimeConfig = () => {
		void mutateGlobal(isAgentRuntimeConfigKey, undefined, { revalidate: true });
	};

	const save = async (provider: APIKeyProvider) => {
		const apiKey = apiKeys[provider.id]?.trim() ?? "";
		if (!apiKey) return false;

		setSavingID(provider.id);
		try {
			const nextData = await saveAPIKey(provider.id, apiKey);
			await mutate(nextData, false);
			revalidateAgentRuntimeConfig();
			setAPIKeys((current) => ({ ...current, [provider.id]: "" }));
			toast.success("API Key 已保存", { description: provider.label });
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : "保存 API Key 失败。";
			toast.error("保存失败", { description: message });
			return false;
		} finally {
			setSavingID(undefined);
		}
	};

	const clear = async (provider: APIKeyProvider) => {
		setClearingID(provider.id);
		try {
			const nextData = await clearAPIKey(provider.id);
			await mutate(nextData, false);
			revalidateAgentRuntimeConfig();
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
				toast.info("即梦登录页已打开", {
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

	const saveMediagoQuickSetup = async () => {
		if (!mediagoProvider) return;
		const saved = await save(mediagoProvider);
		if (saved) setIsMediagoSetupOpen(false);
	};

	const saveManualConfig = async (provider: APIKeyProvider) => {
		const saved = await save(provider);
		if (saved) setManualProviderID(undefined);
	};

	const renderProvider = (provider: APIKeyProvider) => {
		const apiKey = apiKeys[provider.id] ?? "";
		const isSaving = savingID === provider.id;
		const isClearing = clearingID === provider.id;
		const isLoggingIn = loggingInID === provider.id;
		const isCheckingLogin = checkingLoginID === provider.id;
		const isMediago = provider.id === mediagoProviderID;
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
				onRegister={isMediago ? () => void openMediagoAPIKeyPage() : undefined}
				onSave={() => void save(provider)}
			/>
		);
	};

	const renderManualProvider = (provider: APIKeyProvider, variant: ManualProviderVariant) => {
		if (provider.credentialKind === "oauth") return renderProvider(provider);

		const apiKey = apiKeys[provider.id] ?? "";
		return (
			<ManualAPIKeyProviderRow
				key={provider.id}
				apiKey={apiKey}
				isClearing={clearingID === provider.id}
				isSaving={savingID === provider.id}
				onAPIKeyChange={(value) => updateAPIKey(provider.id, value)}
				onClear={() => void clear(provider)}
				onOpenChange={(open) => setManualProviderID(open ? provider.id : undefined)}
				onSave={() => void saveManualConfig(provider)}
				open={manualProviderID === provider.id}
				provider={provider}
				variant={variant}
			/>
		);
	};

	const renderCustomProvider = (provider: APIKeyProvider) =>
		renderManualProvider(provider, "custom");
	const renderOfficialProvider = (provider: APIKeyProvider) =>
		renderManualProvider(provider, "official");

	return (
		<SettingsPanelLayout
			title="API 密钥"
			description="管理生成和智能体使用的聚合平台与官方供应商凭据。"
			icon={<KeyRound className="size-4" />}
		>
			<div className="space-y-3">
				{(isLoading || isModelPlatformsLoading) && providers.length === 0 ? (
					<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>加载中</span>
					</div>
				) : null}
				{!isLoading && providers.length === 0 ? (
					<p className="py-2 text-sm text-muted-foreground">暂无可配置供应商。</p>
				) : null}
				{mediagoProvider ? (
					<APIKeyProviderGroup title="统一接口">
						<MediaGoQuickSetupCard
							apiKey={apiKeys[mediagoProvider.id] ?? ""}
							isClearing={clearingID === mediagoProvider.id}
							isSaving={savingID === mediagoProvider.id}
							isLoadingModelGroups={isModelPlatformsLoading}
							modelGroups={mediagoPlatform?.modelGroups ?? []}
							onAPIKeyChange={(value) => updateAPIKey(mediagoProvider.id, value)}
							onClear={() => void clear(mediagoProvider)}
							onConfigure={() => setIsMediagoSetupOpen(true)}
							onRegister={() => void openMediagoAPIKeyPage()}
							onSave={() => void saveMediagoQuickSetup()}
							onOpenChange={setIsMediagoSetupOpen}
							open={isMediagoSetupOpen}
							provider={mediagoProvider}
						/>
					</APIKeyProviderGroup>
				) : null}
				{visibleUnifiedProviders.length > 0 ? (
					<APIKeyProviderGroup title={mediagoProvider ? "其他统一接口" : "统一接口"}>
						{visibleUnifiedProviders.map(renderProvider)}
					</APIKeyProviderGroup>
				) : null}
				{customProviders.length > 0 ? (
					<APIKeyProviderGroup title="自定义接口">
						{customProviders.map(renderCustomProvider)}
					</APIKeyProviderGroup>
				) : null}
				{officialProviders.length > 0 ? (
					<APIKeyProviderGroup title={modelPlatforms.length > 0 ? "官方供应商" : "供应商"}>
						{officialProviders.map(renderOfficialProvider)}
					</APIKeyProviderGroup>
				) : null}
			</div>
		</SettingsPanelLayout>
	);
};

const platformProviderIDs = new Set(["mediago", "openrouter", "dmx"]);

const platformProviders = (
	platforms: ModelPlatform[],
	providersByID: Map<string, APIKeyProvider>,
	kind: string,
) =>
	platforms
		.filter((platform) => platform.kind === kind)
		.flatMap((platform) => {
			const provider = providersByID.get(platform.apiKeyProviderId);
			if (!provider) return [];
			return [
				{
					...provider,
					label: platform.label || provider.label,
					description: platform.description || provider.description,
					credentialLabel: undefined,
					help: undefined,
					placeholder: undefined,
				},
			];
		});

const officialAPIKeyProviders = (providers: APIKeyProvider[], platforms: ModelPlatform[]) => {
	if (platforms.length === 0) {
		return providers.filter((provider) => provider.id !== "mediago");
	}
	return providers.filter((provider) => !platformProviderIDs.has(provider.id));
};

const APIKeyProviderGroup: React.FC<{
	children: React.ReactNode;
	title: string;
}> = ({ children, title }) => (
	<section className="space-y-2">
		<h2 className="px-1 text-xs font-semibold text-muted-foreground">{title}</h2>
		<div className="space-y-3">{children}</div>
	</section>
);

const MediaGoQuickSetupCard: React.FC<{
	apiKey: string;
	isClearing: boolean;
	isLoadingModelGroups: boolean;
	isSaving: boolean;
	modelGroups: ModelPlatformModelGroup[];
	onAPIKeyChange: (value: string) => void;
	onClear: () => void;
	onConfigure: () => void;
	onOpenChange: (open: boolean) => void;
	onRegister: () => void;
	onSave: () => void;
	open: boolean;
	provider: APIKeyProvider;
}> = ({
	apiKey,
	isClearing,
	isLoadingModelGroups,
	isSaving,
	modelGroups,
	onAPIKeyChange,
	onClear,
	onConfigure,
	onOpenChange,
	onRegister,
	onSave,
	open,
	provider,
}) => (
	<>
		<section
			className={cn(
				settingsInsetRowClassName,
				"grid gap-4 border-primary/30 bg-ide-toolbar p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center",
			)}
		>
			<div className="min-w-0">
				<div className="mb-2 flex flex-wrap items-center gap-2">
					<span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
						MediaGo
					</span>
					<span className="rounded-full bg-success-surface px-2 py-0.5 text-xs font-medium text-success-foreground">
						推荐
					</span>
					<span className="rounded-full bg-ide-list-hover px-2 py-0.5 text-xs font-medium text-muted-foreground">
						{provider.configured ? "已配置" : "未填写"}
					</span>
				</div>
				<h3 className="text-base font-semibold text-foreground">MediaGo 一键配置</h3>
				<p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
					使用一个 MediaGo API Key 接入文本、图片、视频、音频生成和 Agent 默认模型。
				</p>
			</div>
			<Button type="button" onClick={onConfigure} className="h-9 rounded-md px-4 text-xs shadow-sm">
				<Sparkles />
				<span>MediaGo 一键配置</span>
			</Button>
			<div className="overflow-hidden rounded-md border border-border bg-background/80 lg:col-span-2">
				{modelGroups.length > 0 ? (
					modelGroups.map((group, index) => (
						<div
							key={group.label}
							className={cn(
								"grid gap-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center",
								index > 0 ? "border-t border-border" : null,
							)}
						>
							<div className="text-sm font-semibold text-foreground">{group.label}</div>
							<div className="flex min-w-0 flex-wrap gap-1.5">
								{group.models.map((model) => (
									<span
										key={model}
										className="rounded-sm bg-ide-toolbar px-2 py-0.5 text-xs font-medium text-muted-foreground"
									>
										{model}
									</span>
								))}
							</div>
						</div>
					))
				) : (
					<div className="flex min-h-16 items-center px-4 py-3 text-sm text-muted-foreground">
						{isLoadingModelGroups ? (
							<>
								<Loader2 className="mr-2 size-4 animate-spin" />
								<span>正在读取 MediaGo 模型清单</span>
							</>
						) : (
							<span>暂无可展示的 MediaGo 模型清单。</span>
						)}
					</div>
				)}
			</div>
		</section>
		<MediaGoQuickSetupDialog
			apiKey={apiKey}
			isClearing={isClearing}
			isSaving={isSaving}
			onAPIKeyChange={onAPIKeyChange}
			onClear={onClear}
			onOpenChange={onOpenChange}
			onRegister={onRegister}
			onSave={onSave}
			open={open}
			provider={provider}
		/>
	</>
);

const MediaGoQuickSetupDialog: React.FC<{
	apiKey: string;
	isClearing: boolean;
	isSaving: boolean;
	onAPIKeyChange: (value: string) => void;
	onClear: () => void;
	onOpenChange: (open: boolean) => void;
	onRegister: () => void;
	onSave: () => void;
	open: boolean;
	provider: APIKeyProvider;
}> = ({
	apiKey,
	isClearing,
	isSaving,
	onAPIKeyChange,
	onClear,
	onOpenChange,
	onRegister,
	onSave,
	open,
	provider,
}) => {
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6">
			<div
				aria-labelledby="mediago-quick-setup-title"
				aria-modal="true"
				className="w-full max-w-xl rounded-md border border-border bg-background p-6 shadow-xl"
				role="dialog"
			>
				<div className="flex items-start justify-between gap-4">
					<div>
						<div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							MediaGo Preset
						</div>
						<h3
							id="mediago-quick-setup-title"
							className="mt-2 text-lg font-semibold text-foreground"
						>
							MediaGo 一键配置
						</h3>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">
							保存统一 API Key 后，生成与 Agent 会优先使用 MediaGo 聚合平台。
						</p>
					</div>
					<span className="rounded-full bg-success-surface px-2 py-1 text-xs font-medium text-success-foreground">
						推荐
					</span>
				</div>

				<div className="mt-5">
					<Label htmlFor="mediago-quick-api-key" className="text-sm font-medium text-foreground">
						MediaGo API Key
					</Label>
					<MaskedAPIKeyInput
						id="mediago-quick-api-key"
						aria-label="MediaGo API Key"
						className="mt-2 h-10 rounded-md font-mono text-sm text-foreground"
						onChange={onAPIKeyChange}
						placeholder="输入API Key"
						provider={provider}
						value={apiKey}
					/>
					{provider.configured ? null : (
						<div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
							<span>还没有账号？</span>
							<button
								type="button"
								onClick={onRegister}
								className="inline-flex items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80"
							>
								<span>立即注册</span>
								<ArrowRight className="size-3.5" />
							</button>
						</div>
					)}
				</div>

				<div className="mt-6 flex flex-wrap justify-between gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={!provider.configured || isClearing}
						onClick={onClear}
						className="w-24 rounded-md"
					>
						{isClearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
						<span>清除</span>
					</Button>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							className="w-24 rounded-md"
						>
							取消
						</Button>
						<Button
							type="button"
							disabled={!apiKey.trim() || isSaving}
							onClick={onSave}
							className="w-32 rounded-md"
						>
							{isSaving ? <Loader2 className="animate-spin" /> : <Sparkles />}
							<span>保存并启用</span>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};

type ManualProviderVariant = "custom" | "official";

const ManualAPIKeyProviderRow: React.FC<{
	apiKey: string;
	isClearing: boolean;
	isSaving: boolean;
	onAPIKeyChange: (value: string) => void;
	onClear: () => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
	open: boolean;
	provider: APIKeyProvider;
	variant: ManualProviderVariant;
}> = ({
	apiKey,
	isClearing,
	isSaving,
	onAPIKeyChange,
	onClear,
	onOpenChange,
	onSave,
	open,
	provider,
	variant,
}) => {
	const variantLabel = manualProviderVariantLabel(variant);
	const savedCredential = provider.configured ? providerSavedCredentialLabel(provider) : "";

	return (
		<>
			<section
				className={cn(
					settingsInsetRowClassName,
					"grid min-h-[4.5rem] gap-4 lg:grid-cols-[minmax(var(--settings-provider-column-min),var(--settings-provider-column-max))_minmax(0,1fr)_16rem] lg:items-center",
				)}
			>
				<div className="min-w-0">
					<div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="font-mono text-sm font-semibold lowercase text-foreground">
							{provider.id}
						</span>
						<span className="min-w-0 truncate text-sm text-muted-foreground">{provider.label}</span>
					</div>
				</div>

				<div className="min-w-0">
					{savedCredential ? (
						<div className="flex h-8 items-center rounded-md border border-border bg-background px-3">
							<span className="truncate font-mono text-sm text-muted-foreground">
								{savedCredential}
							</span>
						</div>
					) : null}
				</div>

				<div className={manualProviderActionColumnClassName}>
					<span
						className={cn(
							"inline-flex h-7 min-w-[4rem] items-center justify-center rounded-full px-2 text-xs font-medium",
							provider.configured
								? "bg-success-surface text-success-foreground"
								: "bg-error-surface text-error-foreground",
						)}
					>
						{provider.configured ? "已保存" : "无密钥"}
					</span>
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(true)}
						className={manualProviderActionButtonClassName}
						title={`编辑 ${provider.label} 配置`}
					>
						<Pencil />
						<span>编辑</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={!provider.configured || isClearing}
						onClick={onClear}
						className={manualProviderActionButtonClassName}
						title={`清除 ${provider.label} API Key`}
					>
						{isClearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
						<span>清除</span>
					</Button>
				</div>
			</section>
			<ManualProviderConfigDialog
				apiKey={apiKey}
				isSaving={isSaving}
				onAPIKeyChange={onAPIKeyChange}
				onOpenChange={onOpenChange}
				onSave={onSave}
				open={open}
				provider={provider}
				variant={variant}
				variantLabel={variantLabel}
			/>
		</>
	);
};

const ManualProviderConfigDialog: React.FC<{
	apiKey: string;
	isSaving: boolean;
	onAPIKeyChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
	open: boolean;
	provider: APIKeyProvider;
	variant: ManualProviderVariant;
	variantLabel: string;
}> = ({
	apiKey,
	isSaving,
	onAPIKeyChange,
	onOpenChange,
	onSave,
	open,
	provider,
	variant,
	variantLabel,
}) => {
	if (!open) return null;

	const inputID = `manual-api-key-${provider.id}`;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6">
			<div
				aria-labelledby={`manual-provider-config-title-${provider.id}`}
				aria-modal="true"
				className="max-h-[calc(100vh-3rem)] w-full max-w-xl overflow-auto rounded-md border border-border bg-background p-6 shadow-xl"
				role="dialog"
			>
				<div className="flex items-start justify-between gap-4">
					<div>
						<div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							{variant === "custom" ? "Custom Config" : "Manual Config"}
						</div>
						<h3
							id={`manual-provider-config-title-${provider.id}`}
							className="mt-2 text-lg font-semibold text-foreground"
						>
							配置 {provider.label}
						</h3>
						<p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
							{variant === "custom"
								? "只需要填写聚合平台 API Key。模型和端点按自定义聚合路由自动使用。"
								: "只需要填写官方 API Key。模型和端点按系统内置路由自动使用。"}
						</p>
					</div>
					<span className="rounded-full bg-ide-list-hover px-2 py-1 text-xs font-medium text-muted-foreground">
						{variantLabel}
					</span>
				</div>

				<div className="mt-6 grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor={inputID} className="text-sm font-medium text-foreground">
							{provider.credentialLabel || "API Key"}
						</Label>
						<MaskedAPIKeyInput
							id={inputID}
							aria-label={`${provider.label} API Key`}
							className="h-10 rounded-md font-mono text-sm text-foreground"
							onChange={onAPIKeyChange}
							placeholder={apiKeyInputPlaceholder(provider, "输入API Key")}
							provider={provider}
							value={apiKey}
						/>
					</div>
				</div>

				<div className="mt-6 flex justify-end gap-2">
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							className="w-24 rounded-md"
						>
							取消
						</Button>
						<Button
							type="button"
							disabled={!apiKey.trim() || isSaving}
							onClick={onSave}
							className="w-24 rounded-md"
						>
							{isSaving ? <Loader2 className="animate-spin" /> : <Save />}
							<span>保存</span>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};

const MaskedAPIKeyInput: React.FC<{
	"aria-label": string;
	className?: string;
	id: string;
	onChange: (value: string) => void;
	placeholder: string;
	provider: APIKeyProvider;
	value: string;
}> = ({ "aria-label": ariaLabel, className, id, onChange, placeholder, provider, value }) => {
	const [isEditing, setIsEditing] = useState(false);
	const savedCredential = provider.configured ? providerSavedCredentialLabel(provider) : "";
	const showsSavedCredential = Boolean(savedCredential) && !isEditing && value.trim() === "";

	return (
		<Input
			id={id}
			aria-label={ariaLabel}
			className={className}
			onBlur={() => {
				if (!value.trim()) setIsEditing(false);
			}}
			onChange={(event) => {
				if (!isEditing) setIsEditing(true);
				onChange(event.target.value);
			}}
			onFocus={() => {
				if (showsSavedCredential) {
					setIsEditing(true);
					onChange("");
				}
			}}
			placeholder={placeholder}
			type={showsSavedCredential ? "text" : "password"}
			value={showsSavedCredential ? savedCredential : value}
		/>
	);
};

const withoutRecordKey = <TValue,>(values: Record<string, TValue>, key: string) => {
	const next = { ...values };
	delete next[key];
	return next;
};

const isAgentRuntimeConfigKey = (key: unknown) =>
	typeof key === "string" && key.endsWith("/agent/runtime-config");

const openExternalURL = async (url: string) => {
	await openExternalUrl(url);
};

const openMediagoAPIKeyPage = async () => {
	await openExternalURL(mediagoAPIKeyURL);
};

const JianyingDraftPanel: React.FC = () => {
	const toast = useToast();
	const { data, mutate, isLoading } = useSWR(jianyingDraftSettingsKey, getJianyingDraftSettings);
	const [draftsRoot, setDraftsRoot] = useState("");
	const [isPicking, setIsPicking] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isOpening, setIsOpening] = useState(false);

	useEffect(() => {
		setDraftsRoot(data?.draftsRoot ?? "");
	}, [data?.draftsRoot]);

	const pickDirectory = async () => {
		if (isPicking) return;

		setIsPicking(true);
		try {
			const directory = isDesktopRuntime()
				? await pickDesktopDirectory("选择剪映草稿文件夹")
				: window.prompt("剪映草稿文件夹绝对路径", draftsRoot)?.trim();
			if (!directory) return;
			setDraftsRoot(directory);
		} catch (err) {
			const message = err instanceof Error ? err.message : "选择文件夹失败。";
			toast.error("选择失败", { description: message });
		} finally {
			setIsPicking(false);
		}
	};

	const save = async () => {
		if (isSaving) return;

		setIsSaving(true);
		try {
			const next = await saveJianyingDraftSettings(draftsRoot.trim());
			await mutate(next, false);
			toast.success(next.draftsRoot ? "剪映草稿目录已保存" : "剪映草稿目录已清除", {
				description: next.draftsRoot || undefined,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : "保存剪映草稿目录失败。";
			toast.error("保存失败", { description: message });
		} finally {
			setIsSaving(false);
		}
	};

	const openDirectory = async () => {
		const directory = draftsRoot.trim();
		if (!directory || isOpening) return;

		setIsOpening(true);
		try {
			await openProjectDirectory(directory);
		} catch (err) {
			const message = err instanceof Error ? err.message : "打开剪映草稿目录失败。";
			toast.error("打开失败", { description: message });
		} finally {
			setIsOpening(false);
		}
	};

	return (
		<SettingsPanelLayout
			title="剪映草稿"
			description="配置剪辑工作台导出剪映草稿时使用的本机目录。"
			icon={<Clapperboard className="size-4" />}
		>
			<div className="space-y-3">
				{isLoading && !data ? (
					<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>加载中</span>
					</div>
				) : null}
				<div
					className={cn(
						settingsInsetRowClassName,
						"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,1fr)] md:items-start",
					)}
				>
					<div className="min-w-0">
						<Label htmlFor="jianying-drafts-root" className="text-sm font-medium text-foreground">
							草稿文件夹
						</Label>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							{draftsRoot.trim() ? "剪映桌面端会在这里读取新草稿。" : "尚未设置草稿文件夹。"}
						</p>
					</div>
					<div className="min-w-0">
						<Input
							id="jianying-drafts-root"
							value={draftsRoot}
							onChange={(event) => setDraftsRoot(event.target.value)}
							placeholder="选择或输入剪映草稿文件夹"
							className="h-8 rounded-md font-mono text-xs text-foreground"
						/>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => void pickDirectory()}
								disabled={isPicking}
								className="rounded-md"
							>
								{isPicking ? <Loader2 className="animate-spin" /> : <FolderOpen />}
								<span>选择</span>
							</Button>
							<Button
								type="button"
								size="sm"
								onClick={() => void save()}
								disabled={isSaving || draftsRoot.trim() === (data?.draftsRoot ?? "")}
								className="rounded-md"
							>
								{isSaving ? <Loader2 className="animate-spin" /> : <Save />}
								<span>保存</span>
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void openDirectory()}
								disabled={!draftsRoot.trim() || isOpening || !isDesktopRuntime()}
								className="rounded-md"
								title={
									isDesktopRuntime() ? "打开剪映草稿文件夹" : "当前运行环境不支持打开本地文件夹"
								}
							>
								{isOpening ? <Loader2 className="animate-spin" /> : <FolderOpen />}
								<span>打开</span>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</SettingsPanelLayout>
	);
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
	const canOpenWorkspaceDir = Boolean(workspaceDir) && isDesktopRuntime();

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
	onRegister?: () => void;
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
	onRegister,
	onSave,
	provider,
}) => {
	const inputID = `api-key-${provider.id}`;
	const canClear = provider.configured || Boolean(apiKey);
	const isOAuthProvider = provider.credentialKind === "oauth";
	const isLoginPending = loginChallenge?.status === "pending";
	const canConfirmLogin = isLoginPending && Boolean(loginChallenge?.deviceCode);
	const isMediago = provider.id === mediagoProviderID;

	return (
		<section
			className={cn(
				settingsInsetRowClassName,
				"grid gap-3 lg:grid-cols-[minmax(var(--settings-provider-column-min),var(--settings-provider-column-max))_minmax(0,1fr)_14.5rem] lg:items-start",
			)}
		>
			<div className="min-w-0 lg:min-h-8 lg:content-center">
				<h3 className="truncate text-sm font-semibold text-foreground">{provider.label}</h3>
			</div>

			<div className="min-w-0">
				{isOAuthProvider ? (
					<div>
						<div
							aria-label={`${provider.label} 登录状态`}
							className="flex min-h-8 items-center rounded-md border border-border bg-ide-toolbar px-3 text-xs text-foreground"
						>
							<span>
								{isLoginPending
									? "等待即梦浏览器登录"
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
					<Input
						id={inputID}
						aria-label={`${provider.label} API Key`}
						type="password"
						value={apiKey}
						onChange={(event) => onAPIKeyChange(event.target.value)}
						placeholder={apiKeyInputPlaceholder(provider, "输入API Key")}
						className="h-8 rounded-md font-mono text-xs text-foreground"
					/>
				)}
				{isMediago && onRegister ? (
					<button
						type="button"
						onClick={onRegister}
						className="mt-1 inline-flex text-xs font-medium leading-4 text-primary transition-colors hover:text-primary/80"
					>
						还没有账号？立即注册
					</button>
				) : null}
			</div>

			<div className={apiKeyActionColumnClassName}>
				<Button
					type="button"
					variant="outline"
					disabled={isClearing || !canClear}
					onClick={onClear}
					className={apiKeyActionButtonClassName}
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
								className={apiKeyActionButtonClassName}
								title="打开即梦授权页"
							>
								<ExternalLink />
								<span>打开</span>
							</Button>
						) : null}
						{canConfirmLogin ? (
							<Button
								type="button"
								disabled={isCheckingLogin}
								onClick={onConfirmLogin}
								className={apiKeyActionButtonClassName}
								title="确认即梦登录"
							>
								{isCheckingLogin ? <Loader2 className="animate-spin" /> : <Check />}
								<span>确认</span>
							</Button>
						) : isLoginPending ? (
							<Button type="button" disabled className={apiKeyActionButtonClassName}>
								<Loader2 className="animate-spin" />
								<span>登录中</span>
							</Button>
						) : (
							<Button
								type="button"
								disabled={isLoggingIn}
								onClick={onLogin}
								className={apiKeyActionButtonClassName}
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
						className={apiKeyActionButtonClassName}
					>
						{isSaving ? <Loader2 className="animate-spin" /> : <Save />}
						<span>保存</span>
					</Button>
				)}
			</div>
		</section>
	);
};

function apiKeyInputPlaceholder(provider: APIKeyProvider, emptyText: string) {
	return provider.configured ? "输入新的 Key 以替换当前凭据" : emptyText;
}

function providerSavedCredentialLabel(provider: APIKeyProvider) {
	const credential = provider.masked?.trim();
	if (!credential) return "当前凭据";
	return maskCredentialValue(credential);
}

function maskCredentialValue(value: string) {
	if (value.includes("•") || value.includes("*")) return value;
	if (value.length <= 8) return "••••••••";
	return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

function manualProviderVariantLabel(variant: ManualProviderVariant) {
	return variant === "custom" ? "自定义" : "官方";
}
