import {
	Check,
	Clapperboard,
	ExternalLink,
	Ellipsis,
	FolderOpen,
	KeyRound,
	Loader2,
	LogIn,
	LogOut,
	Pencil,
	Save,
	SlidersHorizontal,
	Sparkles,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	type APIKeyLoginChallenge,
	type APIKeyProvider,
	type CustomImageAPIProtocol,
	type ModelPlatform,
	type ModelPlatformModelGroup,
	apiKeysKey,
	customImageAPISettingsKey,
	beginProviderLogin,
	clearAPIKey,
	completeProviderLogin,
	getAPIKeys,
	getCustomImageAPISettings,
	getJianyingDraftSettings,
	jianyingDraftSettingsKey,
	saveAPIKey,
	saveCustomImageAPISettings,
	saveJianyingDraftSettings,
} from "@/domains/settings/api/settings";
import { isAgentRuntimeConfigKey } from "@/domains/agent/api/agent";
import { generationModelsKey } from "@/domains/generation/api/generation";
import { ShortcutKeysPanel } from "@/domains/settings/components/ShortcutKeysPanel";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { CodexAccessPanel } from "@/domains/settings/components/CodexAccessPanel";
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
const customProvidersEnabled = import.meta.env.VITE_ENABLE_CUSTOM_PROVIDERS !== "false";
const mediagoProviderID = "mediago";
const fallbackCLIProviderIDs = new Set(["jimeng", "libtv", "xiaoyunque"]);
const knownPlatformProviderIDs = new Set(["mediago", "openrouter", "dmx"]);
const primaryOfficialProviderIDs = ["openai", "google"];
const cliProviderHints: Record<string, string> = {
	jimeng: "已开通即梦高级会员？可直接登录即梦账号接入，无需 API Key。",
	libtv: "已开通 LibTV 会员？可直接登录 LibTV 账号接入本地 CLI。",
};
const providerRowClassName = settingsInsetRowClassName;

type SettingsTabValue =
	| "appearance"
	| "api-keys"
	| "billing"
	| "codex-access"
	| "codex-skills"
	| "jianying-draft"
	| "shortcuts"
	| DebugTabValue;

const isSettingsTabValue = (value: string): value is SettingsTabValue =>
	value === "appearance" ||
	value === "api-keys" ||
	value === "billing" ||
	value === "codex-access" ||
	value === "codex-skills" ||
	(jianyingDraftSettingsEnabled && value === "jianying-draft") ||
	value === "shortcuts" ||
	debugTabs.some((tab) => tab.value === value);

const normalizeSettingsTab = (value: string) =>
	value === "codex-relay"
		? "codex-access"
		: value === "agent-model-profiles"
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
	const visibleTab =
		isSettingsTabValue(normalizedTab) &&
		!new Set(["billing", "codex-skills", "jianying-draft"]).has(normalizedTab)
			? normalizedTab
			: "appearance";

	if (projectId && normalizedTab === projectSettingsGeneralTab) return <ProjectSettings />;

	return (
		<div className="h-full min-h-0 overflow-hidden bg-ide-editor text-ide-editor-foreground">
			{visibleTab === "appearance" ? (
				<AppearancePanel mode={themeMode} onSelectMode={setThemeMode} />
			) : null}

			{visibleTab === "api-keys" ? <APIKeysPanel /> : null}
			{visibleTab === "codex-access" ? <CodexAccessPanel /> : null}
			{visibleTab === "shortcuts" ? <ShortcutKeysPanel /> : null}

			{debugTabs.map((tab) =>
				visibleTab === tab.value ? <DebugTabPanel key={tab.value} value={tab.value} /> : null,
			)}
		</div>
	);
};

const APIKeysPanel: React.FC = () => {
	const toast = useToast();
	const setSettingsTab = useSettingsNavigationStore((state) => state.setActiveTab);
	const { mutate: mutateGlobal } = useSWRConfig();
	const { data, mutate, isLoading } = useSWR(apiKeysKey, getAPIKeys);
	const {
		data: customImageSettings,
		mutate: mutateCustomImageSettings,
		isLoading: isCustomImageSettingsLoading,
	} = useSWR(customImageAPISettingsKey, getCustomImageAPISettings);
	const providers = data?.providers ?? [];
	const [apiKeys, setAPIKeys] = useState<Record<string, string>>({});
	const [customImageDraft, setCustomImageDraft] = useState({
		baseURL: "https://cn.whereslow.online",
		apiKey: "",
		model: "nano-banana-2",
		protocol: "gemini_generate_content" as CustomImageAPIProtocol,
	});
	const [savingCustomImage, setSavingCustomImage] = useState(false);
	const [savingID, setSavingID] = useState<string>();
	const [clearingID, setClearingID] = useState<string>();
	const [loggingInID, setLoggingInID] = useState<string>();
	const [checkingLoginID, setCheckingLoginID] = useState<string>();
	const [manualProviderID, setManualProviderID] = useState<string>();
	void manualProviderID;
	const [loginChallenges, setLoginChallenges] = useState<Record<string, APIKeyLoginChallenge>>({});
	const hasPendingBrowserLogin = Object.values(loginChallenges).some(
		(challenge) => challenge.status === "pending" && Boolean(challenge.verificationUri),
	);
	const revalidateModelDependentCaches = useCallback(() => {
		void mutateGlobal(generationModelsKey, undefined, { revalidate: true });
		void mutateGlobal(isAgentRuntimeConfigKey, undefined, { revalidate: true });
	}, [mutateGlobal]);

	useEffect(() => {
		if (!customImageSettings) return;
		setCustomImageDraft((current) => ({
			baseURL: customImageSettings.baseURL,
			apiKey: current.apiKey,
			model: customImageSettings.model,
			protocol: customImageSettings.protocol,
		}));
	}, [customImageSettings]);

	const saveCustomImage = async () => {
		setSavingCustomImage(true);
		try {
			const next = await saveCustomImageAPISettings({
				baseURL: customImageDraft.baseURL.trim(),
				model: customImageDraft.model.trim(),
				protocol: customImageDraft.protocol,
				...(customImageDraft.apiKey.trim() ? { apiKey: customImageDraft.apiKey.trim() } : {}),
			});
			await mutateCustomImageSettings(next, false);
			setCustomImageDraft((current) => ({ ...current, apiKey: "" }));
			revalidateModelDependentCaches();
			toast.success("自定义图片 API 已保存", {
				description: `${next.model} · ${next.protocol === "gemini_generate_content" ? "Gemini generateContent" : "OpenAI Compatible"}`,
			});
		} catch (err) {
			toast.error("保存失败", {
				description: err instanceof Error ? err.message : "保存自定义图片 API 失败。",
			});
		} finally {
			setSavingCustomImage(false);
		}
	};

	useEffect(() => {
		if (!hasPendingBrowserLogin) return;
		const intervalID = window.setInterval(() => {
			void mutate();
		}, 3000);
		return () => window.clearInterval(intervalID);
	}, [hasPendingBrowserLogin, mutate]);

	useEffect(() => {
		if (!data?.providers) return;

		const completedProviderIDs = data.providers
			.filter(
				(provider) =>
					provider.configured &&
					loginChallenges[provider.id]?.status === "pending" &&
					loggingInID !== provider.id &&
					checkingLoginID !== provider.id,
			)
			.map((provider) => provider.id);
		if (completedProviderIDs.length === 0) return;

		setLoginChallenges((current) => {
			const next = { ...current };
			for (const providerID of completedProviderIDs) delete next[providerID];
			return next;
		});
		revalidateModelDependentCaches();
	}, [
		checkingLoginID,
		data?.providers,
		loggingInID,
		loginChallenges,
		revalidateModelDependentCaches,
	]);

	const updateAPIKey = (providerID: string, value: string) => {
		setAPIKeys((current) => ({ ...current, [providerID]: value }));
	};

	const save = async (provider: APIKeyProvider) => {
		const apiKey = apiKeys[provider.id]?.trim() ?? "";
		if (!apiKey) return false;

		setSavingID(provider.id);
		try {
			const nextData = await saveAPIKey(provider.id, apiKey);
			await mutate(nextData, false);
			revalidateModelDependentCaches();
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
		const wasLoginPending = loginChallenges[provider.id]?.status === "pending";
		setClearingID(provider.id);
		try {
			const nextData = await clearAPIKey(provider.id);
			await mutate(nextData, false);
			revalidateModelDependentCaches();
			setAPIKeys((current) => ({ ...current, [provider.id]: "" }));
			setLoginChallenges((current) => withoutRecordKey(current, provider.id));
			toast.success(
				provider.credentialKind === "oauth"
					? wasLoginPending
						? "登录已取消"
						: "已退出登录"
					: "API Key 已清除",
				{ description: provider.label },
			);
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : "清除 API Key 失败。";
			toast.error("清除失败", { description: message });
			return false;
		} finally {
			setClearingID(undefined);
		}
	};

	const confirmClear = (provider: APIKeyProvider) => {
		const isOAuthProvider = provider.credentialKind === "oauth";
		const isLoginPending = loginChallenges[provider.id]?.status === "pending";
		const actionLabel = isLoginPending ? "取消登录" : isOAuthProvider ? "退出登录" : "清除 API Key";
		const title = isLoginPending
			? `取消 ${provider.label} 登录？`
			: isOAuthProvider
				? `退出 ${provider.label} 登录？`
				: `清除 ${provider.label} API Key？`;
		const description = isLoginPending
			? "当前授权信息将被清除，之后可以重新发起登录。"
			: isOAuthProvider
				? "退出后将无法继续使用该账号，需要重新登录才能恢复。"
				: "清除后依赖此凭据的功能将不可用，需要重新配置才能恢复。";

		void confirmDialog({
			title,
			description,
			confirmLabel: actionLabel,
			confirmIcon: isOAuthProvider ? <LogOut /> : <Trash2 />,
			onConfirm: () => clear(provider),
		});
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
				toast.info(`${provider.label}登录页已打开`, {
					description: nextData.login.userCode
						? `验证码：${nextData.login.userCode}`
						: provider.label,
				});
				return;
			}
			setLoginChallenges((current) => withoutRecordKey(current, provider.id));
			revalidateModelDependentCaches();
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
			const message = err instanceof Error ? err.message : `打开${provider.label}授权页失败。`;
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
			revalidateModelDependentCaches();
			toast.success("登录已完成", { description: provider.label });
		} catch (err) {
			const message = err instanceof Error ? err.message : "登录确认失败。";
			toast.error("确认失败", { description: message });
		} finally {
			setCheckingLoginID(undefined);
		}
	};

	const saveManualConfig = async (provider: APIKeyProvider) => {
		const saved = await save(provider);
		if (saved) setManualProviderID(undefined);
	};
	void saveManualConfig;

	const renderProvider = (provider: APIKeyProvider, hint?: string) => {
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
				hint={hint}
				isSaving={isSaving}
				isClearing={isClearing}
				isLoggingIn={isLoggingIn}
				isCheckingLogin={isCheckingLogin}
				loginChallenge={loginChallenges[provider.id]}
				onAPIKeyChange={(value) => updateAPIKey(provider.id, value)}
				onClear={() => confirmClear(provider)}
				onConfirmLogin={() => void completeLogin(provider)}
				onLogin={() => void login(provider)}
				onOpenLogin={() => void openLoginChallenge(provider)}
				onSave={() => void save(provider)}
			/>
		);
	};
	void renderProvider;

	return (
		<SettingsPanelLayout
			title="图片生成 API"
			description="这里只管理图片生成。制作助理、分镜拆解与 Prompt 优化使用 Codex 订阅额度，不需要在这里填写文本 API Key。"
			icon={<KeyRound className="size-4" />}
		>
			<div className="mx-auto w-full max-w-3xl space-y-5">
				<section className="grid gap-3 sm:grid-cols-2" aria-label="制作调用分工">
					<div className="rounded-xl border border-primary/35 bg-primary/[0.05] p-4">
						<div className="flex items-center justify-between gap-3">
							<h3 className="text-sm font-semibold text-foreground">制作助理与推理</h3>
							<Badge variant="secondary">Codex 额度</Badge>
						</div>
						<p className="mt-2 text-xs leading-5 text-muted-foreground">
							对话、拆解和提示词优化走本机 Codex 登录，不使用图片 API Key。
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => setSettingsTab("codex-access")}
						>
							查看 Codex 推理
						</Button>
					</div>
					<div className="rounded-xl border border-border bg-card p-4">
						<div className="flex items-center justify-between gap-3">
							<h3 className="text-sm font-semibold text-foreground">静态图片生成</h3>
							<ProviderStatusLabel active={Boolean(customImageSettings?.apiKey.configured)} />
						</div>
						<p className="mt-2 text-xs leading-5 text-muted-foreground">
							使用 Nano Banana 2 图片接口；生成图会按资产与镜头关系归档。
						</p>
					</div>
				</section>

				{isLoading && providers.length === 0 ? (
					<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>加载中</span>
					</div>
				) : null}
				<section className="rounded-xl border border-border bg-card p-4">
					<div className="mb-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-sm font-semibold text-foreground">Nano Banana 2 图片接口</h3>
							<ProviderStatusLabel active={Boolean(customImageSettings?.apiKey.configured)} />
						</div>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							自定义图片中转独立调用，不会读取或修改 Codex Responses 配置。
						</p>
					</div>
					{isCustomImageSettingsLoading && !customImageSettings ? (
						<div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							加载中
						</div>
					) : (
						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="whereslow-image-base-url">API Base URL</Label>
								<Input
									id="whereslow-image-base-url"
									aria-label="API Base URL"
									value={customImageDraft.baseURL}
									onChange={(event) =>
										setCustomImageDraft((current) => ({ ...current, baseURL: event.target.value }))
									}
									placeholder="https://cn.whereslow.online"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="whereslow-image-api-key">API Key</Label>
								<Input
									id="whereslow-image-api-key"
									aria-label="自定义图片 API Key"
									type="password"
									value={customImageDraft.apiKey}
									onChange={(event) =>
										setCustomImageDraft((current) => ({ ...current, apiKey: event.target.value }))
									}
									placeholder={
										customImageSettings?.apiKey.configured
											? `已保存 ${customImageSettings.apiKey.masked ?? "••••"}；留空则保持不变`
											: "输入 API Key"
									}
								/>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="grid gap-2">
									<Label htmlFor="whereslow-image-model">Model</Label>
									<Input
										id="whereslow-image-model"
										aria-label="Model"
										value={customImageDraft.model}
										onChange={(event) =>
											setCustomImageDraft((current) => ({ ...current, model: event.target.value }))
										}
									placeholder="nano-banana-2"
									/>
								</div>
								<div className="grid gap-2">
									<Label>API Protocol</Label>
									<Select
										value={customImageDraft.protocol}
										onValueChange={(value) =>
											setCustomImageDraft((current) => ({
												...current,
												protocol: value as CustomImageAPIProtocol,
											}))
										}
									>
										<SelectTrigger aria-label="API Protocol">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="gemini_generate_content">
												Gemini generateContent
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<p className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
								{`${customImageDraft.baseURL.replace(/\/$/u, "")}/v1beta/models/${customImageDraft.model || "{model}"}:generateContent`}
							</p>
							<div className="flex justify-end">
								<Button
									type="button"
									onClick={() => void saveCustomImage()}
									disabled={
										savingCustomImage ||
										!customImageDraft.baseURL.trim() ||
										!customImageDraft.model.trim() ||
										(!customImageSettings?.apiKey.configured && !customImageDraft.apiKey.trim())
									}
								>
									{savingCustomImage ? <Loader2 className="animate-spin" /> : <Save />}
									保存自定义图片 API
								</Button>
							</div>
						</div>
					)}
				</section>
			</div>
		</SettingsPanelLayout>
	);
};

const ModelReadinessPanel: React.FC<{
	providers: APIKeyProvider[];
	platforms: ModelPlatform[];
}> = ({ providers, platforms }) => {
	const configuredProviderIDs = new Set(
		providers.filter((provider) => provider.configured).map((provider) => provider.id),
	);
	const modelNames = platforms.flatMap(
		(platform) => platform.modelGroups?.flatMap((group) => group.models) ?? [],
	);
	const hasModel = (pattern: RegExp) => modelNames.some((model) => pattern.test(model));
	const statuses = [
		{
			label: "文本推理",
			detail: hasModel(/gpt|reason|text|claude|gemini/i),
			provider: configuredProviderIDs.size > 0,
		},
		{
			label: "图片生成",
			detail: hasModel(/image|banana|gemini|imagen/i),
			provider: configuredProviderIDs.size > 0,
		},
		{
			label: "视频生成",
			detail: hasModel(/video|veo|kling|runway/i),
			provider: configuredProviderIDs.size > 0,
		},
	];

	return (
		<section
			className="mb-6 rounded-xl border border-border bg-background p-4"
			aria-label="模型配置状态"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="text-sm font-semibold text-foreground">本机模型配置状态</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						这里只显示是否可用，不显示任何 API Key。具体模型以当前接口返回的目录为准。
					</p>
				</div>
				<Badge variant={configuredProviderIDs.size > 0 ? "secondary" : "outline"}>
					{configuredProviderIDs.size > 0 ? "已有接口配置" : "尚未配置"}
				</Badge>
			</div>
			<div className="mt-3 grid gap-2 sm:grid-cols-3">
				{statuses.map((status) => (
					<div
						key={status.label}
						className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
					>
						<span className="text-xs text-foreground">{status.label}</span>
						<span
							className={cn(
								"text-xs",
								status.detail && status.provider
									? "text-success-foreground"
									: "text-muted-foreground",
							)}
						>
							{status.detail && status.provider ? "可调用" : "待配置 / 待确认"}
						</span>
					</div>
				))}
			</div>
		</section>
	);
};

const platformProvider = (
	platforms: ModelPlatform[],
	providersByID: Map<string, APIKeyProvider>,
	platformID: string,
) => {
	const platform = platforms.find((item) => item.id === platformID);
	if (!platform) return undefined;
	const provider = providersByID.get(platform.apiKeyProviderId);
	if (!provider) return undefined;
	return {
		...provider,
		label: platform.label || provider.label,
		description: platform.description || provider.description,
		credentialLabel: undefined,
		help: undefined,
		placeholder: undefined,
	};
};

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
					...(kind === "cli"
						? {}
						: {
								credentialLabel: undefined,
								help: undefined,
								placeholder: undefined,
							}),
				},
			];
		});

const cliProviderHint = (provider: APIKeyProvider) => {
	if (provider.id === "xiaoyunque") return undefined;
	return cliProviderHints[provider.id] ?? provider.help;
};

const officialAPIKeyProviders = (providers: APIKeyProvider[], platforms: ModelPlatform[]) => {
	if (platforms.length === 0) {
		return providers.filter(
			(provider) =>
				!knownPlatformProviderIDs.has(provider.id) && !fallbackCLIProviderIDs.has(provider.id),
		);
	}
	const platformProviderIDs = new Set(platforms.map((platform) => platform.apiKeyProviderId));
	return providers.filter(
		(provider) =>
			!knownPlatformProviderIDs.has(provider.id) && !platformProviderIDs.has(provider.id),
	);
};

const CredentialCategorySection: React.FC<{
	children: React.ReactNode;
	className?: string;
	description: string;
	title: string;
}> = ({ children, className, description, title }) => (
	<section className={className}>
		<div>
			<h3 className="text-sm font-semibold text-foreground">{title}</h3>
			<p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
		</div>
		<div className="mt-3 space-y-3">{children}</div>
	</section>
);

const MediagoCredentialPanel: React.FC<{
	children?: React.ReactNode;
	modelGroups?: ModelPlatformModelGroup[];
	onConfigure: () => void;
	provider: APIKeyProvider;
}> = ({ children, modelGroups, onConfigure, provider }) => {
	const savedCredential = provider.configured ? providerSavedCredentialLabel(provider) : "";

	return (
		<section className="py-8">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="text-sm font-semibold text-foreground">聚合接口（可选）</h3>
			</div>
			<p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
				保留对 MediaGo 聚合接口的兼容。已有 Key 可以继续使用，不影响上方官方模型配置。
			</p>

			<div className="mt-6 flex flex-wrap items-center gap-3">
				<Button
					type="button"
					onClick={onConfigure}
					className="h-10 rounded-md px-5 text-sm"
					title="配置 MediaGo API Key"
				>
					{provider.configured ? <Pencil /> : <Sparkles />}
					<span>{provider.configured ? "管理 API Key" : "配置 API Key"}</span>
				</Button>
				{provider.configured ? (
					<span className="inline-flex items-center gap-1.5 text-xs text-success-foreground">
						<Check className="size-3.5" />
						已连接
						{savedCredential ? (
							<span className="font-mono text-muted-foreground">{savedCredential}</span>
						) : null}
					</span>
				) : (
					<span className="text-xs text-muted-foreground">未配置，可按需填写已有 Key。</span>
				)}
			</div>

			<div className="mt-8">
				<MediagoModelChips modelGroups={modelGroups} />
			</div>
			{children}
		</section>
	);
};

const MediagoConfigDialog: React.FC<{
	apiKey: string;
	isClearing: boolean;
	isSaving: boolean;
	onAPIKeyChange: (value: string) => void;
	onClear: () => void;
	onOpenChange: (open: boolean) => void;
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
	onSave,
	open,
	provider,
}) => {
	if (!open) return null;

	const helperText = mediaGoKeyHelperText(provider, apiKey, isSaving);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6">
			<div
				aria-labelledby="mediago-config-dialog-title"
				aria-modal="true"
				className="max-h-[calc(100vh-3rem)] w-full max-w-xl overflow-auto rounded-md border border-border bg-background p-6 shadow-xl"
				role="dialog"
			>
				<div className="text-xs font-semibold text-muted-foreground">统一接口</div>
				<h3 id="mediago-config-dialog-title" className="mt-2 text-lg font-semibold text-foreground">
					配置 MediaGo API Key
				</h3>
				<p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
					粘贴已有的 API Key 完成接入。该接口为可选项，不影响官方模型使用。
				</p>

				<div className="mt-6 grid gap-2">
					<Label htmlFor="mediago-api-key" className="text-sm font-medium text-foreground">
						API Key
					</Label>
					<MaskedAPIKeyInput
						id="mediago-api-key"
						aria-label="MediaGo API Key"
						className="h-10 rounded-md bg-ide-editor font-mono text-sm text-foreground"
						onChange={onAPIKeyChange}
						placeholder="粘贴 MediaGo API Key"
						provider={provider}
						value={apiKey}
					/>
					<p className="text-xs leading-5 text-muted-foreground">{helperText}</p>
				</div>

				<div className="mt-6 flex flex-wrap items-center justify-between gap-2">
					{provider.configured ? (
						<Button
							type="button"
							variant="ghost"
							disabled={isClearing}
							onClick={onClear}
							className="rounded-md text-muted-foreground"
						>
							{isClearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
							<span>清除当前 Key</span>
						</Button>
					) : (
						<span />
					)}
					<div className="flex gap-2">
						<DialogDismissButton
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							className="w-24 rounded-md"
						>
							取消
						</DialogDismissButton>
						<Button
							type="button"
							disabled={!apiKey.trim() || isSaving}
							onClick={onSave}
							className="rounded-md px-4"
						>
							{isSaving ? <Loader2 className="animate-spin" /> : <Sparkles />}
							<span>一键配置</span>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};

const maxVisibleModelChips = 8;
const pinnedMediagoModelChips = [
	"Wan 2.7 Image",
	"Wan 2.7 Image Pro",
	"HappyHorse 1.1 Text to Video",
	"HappyHorse 1.1 Reference to Video",
];

const visibleMediagoModelChips = (models: string[]) => {
	const visibleModels = models.slice(0, maxVisibleModelChips);
	const visibleSet = new Set(visibleModels);

	for (const pinnedModel of pinnedMediagoModelChips) {
		if (models.includes(pinnedModel) && !visibleSet.has(pinnedModel)) {
			visibleModels.push(pinnedModel);
			visibleSet.add(pinnedModel);
		}
	}

	return visibleModels;
};

const MediagoModelChips: React.FC<{ modelGroups?: ModelPlatformModelGroup[] }> = ({
	modelGroups,
}) => {
	const models = (modelGroups ?? []).flatMap((group) => group.models);
	if (models.length === 0) return null;

	const visibleModels = visibleMediagoModelChips(models);
	const hiddenCount = models.length - visibleModels.length;

	return (
		<div className="flex flex-wrap items-center gap-1.5 pt-1">
			<span className="mr-1 text-xs text-muted-foreground">支持模型</span>
			{visibleModels.map((model) => (
				<span
					key={model}
					className="rounded-full bg-background px-2.5 py-0.5 text-xs text-muted-foreground"
				>
					{model}
				</span>
			))}
			{hiddenCount > 0 ? (
				<span className="text-xs text-muted-foreground">等 {models.length} 个模型</span>
			) : null}
		</div>
	);
};

const mediaGoKeyHelperText = (provider: APIKeyProvider, apiKey: string, isSaving: boolean) => {
	const trimmedKey = apiKey.trim();
	if (isSaving) {
		return "正在保存并刷新本地运行时配置。";
	}
	if (trimmedKey.length >= 12) {
		return "API Key 已输入，可以点击一键配置完成保存。";
	}
	if (trimmedKey.length > 0) {
		return "当前 API Key 长度偏短，请确认完整复制后再保存。";
	}
	if (provider.configured) {
		return `当前已保存 ${providerSavedCredentialLabel(provider)}，输入新的 Key 可替换。`;
	}
	return "输入后可一键配置并刷新生成与 Agent 配置。";
};

const ProviderStatusLabel: React.FC<{
	active: boolean;
	activeText?: string;
	inactiveText?: string;
}> = ({ active, activeText = "已保存", inactiveText = "未配置" }) => (
	<span
		className={cn(
			"inline-flex shrink-0 items-center gap-1.5 text-xs",
			active ? "text-success-foreground" : "text-muted-foreground",
		)}
	>
		<span
			className={cn(
				"size-1.5 rounded-full",
				active ? "bg-success-foreground" : "bg-muted-foreground/40",
			)}
		/>
		{active ? activeText : inactiveText}
	</span>
);

const CredentialMoreMenu: React.FC<{
	canClear?: boolean;
	isClearing: boolean;
	isLoginPending?: boolean;
	onClear: () => void;
	provider: APIKeyProvider;
}> = ({ canClear, isClearing, isLoginPending = false, onClear, provider }) => {
	const [open, setOpen] = useState(false);
	const isOAuthProvider = provider.credentialKind === "oauth";
	const actionLabel = isLoginPending ? "取消登录" : isOAuthProvider ? "退出登录" : "清除 API Key";
	const actionDisabled = isClearing || (!(canClear ?? provider.configured) && !isLoginPending);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={`${provider.label} 更多操作`}
					aria-haspopup="menu"
					aria-expanded={open}
					className="text-muted-foreground"
				>
					{isClearing ? <Loader2 className="animate-spin" /> : <Ellipsis />}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={4} className="w-44 p-1" role="menu">
				<button
					type="button"
					role="menuitem"
					disabled={actionDisabled}
					onClick={() => {
						setOpen(false);
						onClear();
					}}
					className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50"
				>
					{isOAuthProvider ? <LogOut className="size-4" /> : <Trash2 className="size-4" />}
					<span>{actionLabel}</span>
				</button>
			</PopoverContent>
		</Popover>
	);
};

type ManualProviderVariant = "cli" | "custom" | "official" | "image";

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
	hint?: string;
	variant: ManualProviderVariant;
}> = ({
	apiKey,
	hint,
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
			<section className={cn(providerRowClassName, "flex flex-wrap items-center gap-3")}>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2.5">
						<h3 className="truncate text-sm font-semibold text-foreground">{provider.label}</h3>
						<ProviderStatusLabel active={provider.configured} />
					</div>
					{hint ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
					{savedCredential ? (
						<p className="mt-1 truncate font-mono text-xs text-muted-foreground">
							{savedCredential}
						</p>
					) : null}
				</div>

				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => onOpenChange(true)}
						className="text-muted-foreground"
						title={`编辑 ${provider.label}`}
					>
						<Pencil />
					</Button>
					<CredentialMoreMenu isClearing={isClearing} onClear={onClear} provider={provider} />
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

void ManualAPIKeyProviderRow;

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
						<div className="text-xs font-semibold text-muted-foreground">高级配置</div>
						<h3
							id={`manual-provider-config-title-${provider.id}`}
							className="mt-2 text-lg font-semibold text-foreground"
						>
							配置 {provider.label}
						</h3>
						<p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
							{variant === "image"
								? "这里仅保存 Nano Banana 2 的图片生成 API Key。它不会用于 Codex 推理、制作助理或 Prompt 优化。"
								: variant === "custom"
									? "这里仅保存该接口的 API Key。供应商标识、端点和模型路由由系统预设，不需要在这里填写。"
									: variant === "cli"
										? "这里仅保存本地 CLI 使用的 Access Key。端点和模型能力由系统预设。"
										: "这里仅保存官方账号凭据。端点和模型能力由系统内置配置决定。"}
						</p>
					</div>
					<span className="rounded-full bg-ide-list-hover px-2 py-1 text-xs font-medium text-muted-foreground">
						{variantLabel}
					</span>
				</div>

				<div className="mt-6">
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
						<DialogDismissButton
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							className="w-24 rounded-md"
						>
							取消
						</DialogDismissButton>
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

const openExternalURL = async (url: string) => {
	await openExternalUrl(url);
};

const _JianyingDraftPanel: React.FC = () => {
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

void _JianyingDraftPanel;

// Keep the compatibility-only provider catalog available for existing local settings,
// while the active UI intentionally exposes only Codex and the image-generation key.
void customProvidersEnabled;
void mediagoProviderID;
void primaryOfficialProviderIDs;
void ModelReadinessPanel;
void platformProvider;
void platformProviders;
void cliProviderHint;
void officialAPIKeyProviders;
void CredentialCategorySection;
void MediagoCredentialPanel;
void MediagoConfigDialog;

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
			<div className="divide-y divide-border">
				<div className="flex flex-wrap items-center justify-between gap-3 pb-5">
					<div className="min-w-0 flex-1">
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
				<div className="flex flex-wrap items-center justify-between gap-3 pt-5">
					<div className="min-w-0 flex-1">
						<Label htmlFor="theme-mode" className="text-sm font-medium text-foreground">
							外观
						</Label>
						<p className="mt-1 text-xs text-muted-foreground">{selectedThemeOption.description}</p>
					</div>
					<div className="w-56 shrink-0">
						<Select value={mode} onValueChange={(value) => onSelectMode(value as ThemeMode)}>
							<SelectTrigger id="theme-mode" className="w-full rounded-md">
								<SelectValue />
							</SelectTrigger>
							<SelectContent align="end">
								{themeModeOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
	hint?: string;
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
	hint,
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
	const isOAuthProvider = provider.credentialKind === "oauth";
	const isLoginPending = loginChallenge?.status === "pending";
	const canConfirmLogin = isLoginPending && Boolean(loginChallenge?.deviceCode);

	return (
		<section
			className={cn(
				providerRowClassName,
				"grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center",
			)}
		>
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2.5">
					<h3 className="truncate text-sm font-semibold text-foreground">{provider.label}</h3>
					{isOAuthProvider ? (
						isLoginPending ? (
							<span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-warning-foreground">
								<span className="size-1.5 rounded-full bg-warning-foreground" />
								等待浏览器授权
							</span>
						) : (
							<ProviderStatusLabel
								active={provider.configured}
								activeText="已登录"
								inactiveText="未登录"
							/>
						)
					) : (
						<ProviderStatusLabel active={provider.configured} />
					)}
				</div>
				{hint ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
				{!isOAuthProvider ? (
					<div className="mt-2 max-w-md">
						<Input
							id={inputID}
							aria-label={`${provider.label} API Key`}
							type="password"
							value={apiKey}
							onChange={(event) => onAPIKeyChange(event.target.value)}
							placeholder={apiKeyInputPlaceholder(provider, "输入API Key")}
							className="h-8 rounded-md font-mono text-xs text-foreground"
						/>
					</div>
				) : null}
				{isOAuthProvider && isLoginPending ? (
					<div className="mt-2 grid gap-1 text-xs text-muted-foreground">
						{loginChallenge.userCode ? (
							<div className="flex items-center gap-2">
								<span>验证码</span>
								<span className="font-mono text-foreground">{loginChallenge.userCode}</span>
							</div>
						) : null}
						{loginChallenge.verificationUri ? (
							<div className="flex min-w-0 items-center gap-2">
								<span className="shrink-0">授权页</span>
								<span className="min-w-0 truncate font-mono text-foreground">
									{loginChallenge.verificationUri}
								</span>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="flex shrink-0 items-center justify-end gap-1.5">
				{isOAuthProvider ? (
					<>
						{isLoginPending && loginChallenge?.verificationUri ? (
							<Button
								type="button"
								variant="outline"
								onClick={onOpenLogin}
								className="rounded-md"
								title={`打开 ${provider.label} 授权页`}
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
								className="rounded-md"
								title={`确认 ${provider.label} 登录`}
							>
								{isCheckingLogin ? <Loader2 className="animate-spin" /> : <Check />}
								<span>确认</span>
							</Button>
						) : isLoginPending ? (
							<Button type="button" disabled className="rounded-md">
								<Loader2 className="animate-spin" />
								<span>登录中</span>
							</Button>
						) : (
							<Button
								type="button"
								disabled={isLoggingIn}
								onClick={onLogin}
								className="rounded-md"
								title={`打开 ${provider.label} 登录授权`}
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
				<CredentialMoreMenu
					canClear={provider.configured || Boolean(apiKey)}
					isClearing={isClearing}
					isLoginPending={isLoginPending}
					onClear={onClear}
					provider={provider}
				/>
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
	switch (variant) {
		case "cli":
			return "本地 CLI";
		case "custom":
			return "自定义";
		case "image":
			return "图片专用";
		default:
			return "官方";
	}
}
