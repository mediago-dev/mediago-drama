import { Bot, CheckCircle2, KeyRound, Loader2, Plus, Save, Star, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type AgentModelProfile,
	type AgentModelProfileMutation,
	agentModelProfilesKey,
	clearAgentModelProfileAPIKey,
	createAgentModelProfile,
	deleteAgentModelProfile,
	getAgentModelProfiles,
	saveAgentModelProfileAPIKey,
	setDefaultAgentModelProfile,
	updateAgentModelProfile,
} from "@/domains/settings/api/settings";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { useToast } from "@/hooks/useToast";
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
import { cn } from "@/shared/lib/utils";

interface ProfileDraft {
	name: string;
	providerId: string;
	providerLabel: string;
	baseURL: string;
	model: string;
	modelDisplayName: string;
	enabled: boolean;
	isDefault: boolean;
	supportsImages: boolean;
	supportsTools: boolean;
	contextWindow: string;
	maxOutputTokens: string;
	temperature: string;
}

export const AgentModelProfilesPanel: React.FC = () => {
	const toast = useToast();
	const { data, mutate, isLoading } = useSWR(agentModelProfilesKey, getAgentModelProfiles);
	const profiles = data?.profiles ?? [];
	const templates = data?.templates ?? [];
	const [selectedID, setSelectedID] = useState<string>("");
	const [selectedTemplateID, setSelectedTemplateID] = useState<string>("");
	const [draft, setDraft] = useState<ProfileDraft | null>(null);
	const [apiKeys, setAPIKeys] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState<string>("");

	const selectedProfile = useMemo(
		() => profiles.find((profile) => profile.id === selectedID) ?? profiles[0],
		[profiles, selectedID],
	);

	useEffect(() => {
		if (!templates.length || selectedTemplateID) return;
		setSelectedTemplateID(templates[0].id);
	}, [selectedTemplateID, templates]);

	useEffect(() => {
		if (profiles.length === 0) {
			setSelectedID("");
			return;
		}
		if (selectedID && profiles.some((profile) => profile.id === selectedID)) return;
		setSelectedID(data?.defaultProfileId || profiles[0].id);
	}, [data?.defaultProfileId, profiles, selectedID]);

	useEffect(() => {
		setDraft(selectedProfile ? profileDraftFromProfile(selectedProfile) : null);
	}, [selectedProfile]);

	const selectedTemplate = templates.find((template) => template.id === selectedTemplateID);
	const templateExists = Boolean(
		selectedTemplate &&
		profiles.some((profile) => profile.providerId === selectedTemplate.providerId),
	);

	const updateDraft = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
		setDraft((current) => (current ? { ...current, [key]: value } : current));
	};

	const createProfile = async () => {
		if (!selectedTemplateID || busy) return;
		setBusy("create");
		const previousIDs = new Set(profiles.map((profile) => profile.id));
		try {
			const nextData = await createAgentModelProfile({ templateId: selectedTemplateID });
			await mutate(nextData, false);
			const created =
				nextData.profiles.find((profile) => !previousIDs.has(profile.id)) ??
				nextData.profiles.find((profile) => profile.id === nextData.defaultProfileId) ??
				nextData.profiles[0];
			if (created) setSelectedID(created.id);
			toast.success("模型配置已创建", { description: created?.name ?? selectedTemplate?.name });
		} catch (err) {
			toast.error("创建失败", { description: errorMessage(err, "创建模型配置失败。") });
		} finally {
			setBusy("");
		}
	};

	const saveProfile = async () => {
		if (!selectedProfile || !draft || busy) return;
		setBusy(`save:${selectedProfile.id}`);
		try {
			const nextData = await updateAgentModelProfile(selectedProfile.id, mutationFromDraft(draft));
			await mutate(nextData, false);
			toast.success("模型配置已保存", { description: draft.name });
		} catch (err) {
			toast.error("保存失败", { description: errorMessage(err, "保存模型配置失败。") });
		} finally {
			setBusy("");
		}
	};

	const removeProfile = async () => {
		if (!selectedProfile || busy) return;
		setBusy(`delete:${selectedProfile.id}`);
		try {
			const nextData = await deleteAgentModelProfile(selectedProfile.id);
			await mutate(nextData, false);
			toast.success("模型配置已删除", { description: selectedProfile.name });
		} catch (err) {
			toast.error("删除失败", { description: errorMessage(err, "删除模型配置失败。") });
		} finally {
			setBusy("");
		}
	};

	const makeDefault = async () => {
		if (!selectedProfile || busy) return;
		setBusy(`default:${selectedProfile.id}`);
		try {
			const nextData = await setDefaultAgentModelProfile(selectedProfile.id);
			await mutate(nextData, false);
			toast.success("默认模型已更新", { description: selectedProfile.name });
		} catch (err) {
			toast.error("设置失败", { description: errorMessage(err, "设置默认模型失败。") });
		} finally {
			setBusy("");
		}
	};

	const saveAPIKey = async () => {
		if (!selectedProfile || busy) return;
		const apiKey = apiKeys[selectedProfile.id]?.trim() ?? "";
		if (!apiKey) return;
		setBusy(`key:${selectedProfile.id}`);
		try {
			const nextData = await saveAgentModelProfileAPIKey(selectedProfile.id, apiKey);
			await mutate(nextData, false);
			setAPIKeys((current) => ({ ...current, [selectedProfile.id]: "" }));
			toast.success("API Key 已保存", { description: selectedProfile.name });
		} catch (err) {
			toast.error("保存失败", { description: errorMessage(err, "保存 API Key 失败。") });
		} finally {
			setBusy("");
		}
	};

	const clearAPIKey = async () => {
		if (!selectedProfile || busy) return;
		setBusy(`clear-key:${selectedProfile.id}`);
		try {
			const nextData = await clearAgentModelProfileAPIKey(selectedProfile.id);
			await mutate(nextData, false);
			setAPIKeys((current) => ({ ...current, [selectedProfile.id]: "" }));
			toast.success("API Key 已清除", { description: selectedProfile.name });
		} catch (err) {
			toast.error("清除失败", { description: errorMessage(err, "清除 API Key 失败。") });
		} finally {
			setBusy("");
		}
	};

	return (
		<SettingsPanelLayout
			title="模型接入"
			description="配置 opencode ACP 使用的 OpenAI-compatible 模型。"
			icon={<Bot className="size-4" />}
			actions={
				<div className="flex items-center gap-2">
					<Select value={selectedTemplateID} onValueChange={setSelectedTemplateID}>
						<SelectTrigger className="w-44 rounded-md">
							<SelectValue placeholder="选择模板" />
						</SelectTrigger>
						<SelectContent>
							{templates.map((template) => (
								<SelectItem key={template.id} value={template.id}>
									{template.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						type="button"
						size="sm"
						className="rounded-md"
						disabled={!selectedTemplateID || templateExists || busy === "create"}
						onClick={() => void createProfile()}
					>
						{busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
						<span>新增</span>
					</Button>
				</div>
			}
		>
			<div className="grid gap-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
				<div className="min-w-0 space-y-2">
					{isLoading && profiles.length === 0 ? (
						<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							<span>加载中</span>
						</div>
					) : null}
					{!isLoading && profiles.length === 0 ? (
						<p className="py-2 text-sm text-muted-foreground">暂无模型配置。</p>
					) : null}
					{profiles.map((profile) => (
						<ProfileListButton
							key={profile.id}
							active={profile.id === selectedProfile?.id}
							profile={profile}
							onClick={() => setSelectedID(profile.id)}
						/>
					))}
				</div>

				{selectedProfile && draft ? (
					<div className="min-w-0 space-y-5">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
							<div className="min-w-0">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<h3 className="truncate text-sm font-semibold text-foreground">
										{selectedProfile.name}
									</h3>
									<ProfileBadges profile={selectedProfile} />
								</div>
								<p className="mt-1 truncate text-xs text-muted-foreground">
									{selectedProfile.providerId}/{selectedProfile.model}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-md"
									disabled={selectedProfile.isDefault || !draft.enabled || busy !== ""}
									onClick={() => void makeDefault()}
								>
									{busy === `default:${selectedProfile.id}` ? (
										<Loader2 className="animate-spin" />
									) : (
										<Star />
									)}
									<span>默认</span>
								</Button>
								<Button
									type="button"
									size="sm"
									className="rounded-md"
									disabled={busy !== ""}
									onClick={() => void saveProfile()}
								>
									{busy === `save:${selectedProfile.id}` ? (
										<Loader2 className="animate-spin" />
									) : (
										<Save />
									)}
									<span>保存</span>
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-md"
									disabled={busy !== ""}
									onClick={() => void removeProfile()}
								>
									{busy === `delete:${selectedProfile.id}` ? (
										<Loader2 className="animate-spin" />
									) : (
										<Trash2 />
									)}
									<span>删除</span>
								</Button>
							</div>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<TextField
								label="名称"
								value={draft.name}
								onChange={(value) => updateDraft("name", value)}
							/>
							<TextField
								label="Provider ID"
								value={draft.providerId}
								onChange={(value) => updateDraft("providerId", value)}
							/>
							<TextField
								label="Provider 名称"
								value={draft.providerLabel}
								onChange={(value) => updateDraft("providerLabel", value)}
							/>
							<TextField
								label="Base URL"
								value={draft.baseURL}
								onChange={(value) => updateDraft("baseURL", value)}
							/>
							<TextField
								label="Model"
								value={draft.model}
								onChange={(value) => updateDraft("model", value)}
							/>
							<TextField
								label="Model 名称"
								value={draft.modelDisplayName}
								onChange={(value) => updateDraft("modelDisplayName", value)}
							/>
						</div>

						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
							<ToggleField
								label="启用"
								checked={draft.enabled}
								onChange={(value) => updateDraft("enabled", value)}
							/>
							<ToggleField
								label="图片输入"
								checked={draft.supportsImages}
								onChange={(value) => updateDraft("supportsImages", value)}
							/>
							<ToggleField
								label="工具调用"
								checked={draft.supportsTools}
								onChange={(value) => updateDraft("supportsTools", value)}
							/>
							<ToggleField
								label="默认"
								checked={draft.isDefault}
								onChange={(value) => updateDraft("isDefault", value)}
							/>
						</div>

						<div className="grid gap-4 md:grid-cols-3">
							<NumberField
								label="Context Window"
								value={draft.contextWindow}
								onChange={(value) => updateDraft("contextWindow", value)}
							/>
							<NumberField
								label="Max Output Tokens"
								value={draft.maxOutputTokens}
								onChange={(value) => updateDraft("maxOutputTokens", value)}
							/>
							<NumberField
								label="Temperature"
								step="0.1"
								value={draft.temperature}
								onChange={(value) => updateDraft("temperature", value)}
							/>
						</div>

						<div className="border-t border-border pt-4">
							<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
								<div className="min-w-0">
									<Label
										htmlFor={`agent-model-key-${selectedProfile.id}`}
										className="mb-2 block text-xs text-muted-foreground"
									>
										API Key
									</Label>
									<Input
										id={`agent-model-key-${selectedProfile.id}`}
										type="password"
										value={apiKeys[selectedProfile.id] ?? ""}
										onChange={(event) =>
											setAPIKeys((current) => ({
												...current,
												[selectedProfile.id]: event.target.value,
											}))
										}
										placeholder={
											selectedProfile.apiKey.configured
												? "输入新的 Key 以替换当前凭据"
												: "输入 API Key"
										}
										className="rounded-md font-mono"
									/>
									{selectedProfile.apiKey.masked ? (
										<p className="mt-2 truncate font-mono text-xs text-muted-foreground">
											{selectedProfile.apiKey.masked}
										</p>
									) : null}
								</div>
								<div className="flex items-center gap-2">
									<Button
										type="button"
										variant="outline"
										className="rounded-md"
										disabled={
											busy !== "" ||
											(!selectedProfile.apiKey.configured && !apiKeys[selectedProfile.id]?.trim())
										}
										onClick={() => void clearAPIKey()}
									>
										{busy === `clear-key:${selectedProfile.id}` ? (
											<Loader2 className="animate-spin" />
										) : (
											<Trash2 />
										)}
										<span>清除</span>
									</Button>
									<Button
										type="button"
										className="rounded-md"
										disabled={busy !== "" || !apiKeys[selectedProfile.id]?.trim()}
										onClick={() => void saveAPIKey()}
									>
										{busy === `key:${selectedProfile.id}` ? (
											<Loader2 className="animate-spin" />
										) : (
											<KeyRound />
										)}
										<span>保存 Key</span>
									</Button>
								</div>
							</div>
						</div>
					</div>
				) : (
					<div className="flex min-h-64 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
						选择模板后新增模型配置
					</div>
				)}
			</div>
		</SettingsPanelLayout>
	);
};

const ProfileListButton: React.FC<{
	active: boolean;
	onClick: () => void;
	profile: AgentModelProfile;
}> = ({ active, onClick, profile }) => (
	<button
		type="button"
		onClick={onClick}
		className={cn(
			"w-full rounded-md border px-3 py-2 text-left transition-colors",
			active
				? "border-ring bg-ide-list-hover text-foreground"
				: "border-border bg-transparent text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
		)}
	>
		<div className="flex min-w-0 items-center justify-between gap-2">
			<span className="truncate text-sm font-medium">{profile.name}</span>
			{profile.isDefault ? <Star className="size-3.5 shrink-0 text-primary" /> : null}
		</div>
		<p className="mt-1 truncate text-xs">{profile.providerId}</p>
	</button>
);

const ProfileBadges: React.FC<{ profile: AgentModelProfile }> = ({ profile }) => (
	<>
		{profile.isDefault ? (
			<Badge variant="secondary" className="rounded-md">
				默认
			</Badge>
		) : null}
		<Badge variant={profile.enabled ? "secondary" : "outline"} className="rounded-md">
			{profile.enabled ? "启用" : "停用"}
		</Badge>
		<Badge variant={profile.apiKey.configured ? "secondary" : "outline"} className="rounded-md">
			{profile.apiKey.configured ? "Key 已保存" : "未填写 Key"}
		</Badge>
	</>
);

const TextField: React.FC<{
	label: string;
	onChange: (value: string) => void;
	value: string;
}> = ({ label, onChange, value }) => (
	<label className="min-w-0">
		<span className="mb-2 block text-xs text-muted-foreground">{label}</span>
		<Input
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className="rounded-md"
		/>
	</label>
);

const NumberField: React.FC<{
	label: string;
	onChange: (value: string) => void;
	step?: string;
	value: string;
}> = ({ label, onChange, step = "1", value }) => (
	<label className="min-w-0">
		<span className="mb-2 block text-xs text-muted-foreground">{label}</span>
		<Input
			type="number"
			min="0"
			step={step}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className="rounded-md"
		/>
	</label>
);

const ToggleField: React.FC<{
	checked: boolean;
	label: string;
	onChange: (checked: boolean) => void;
}> = ({ checked, label, onChange }) => (
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		onClick={() => onChange(!checked)}
		className={cn(
			"flex h-9 items-center justify-between gap-3 rounded-md border px-3 text-xs transition-colors",
			checked
				? "border-primary/50 bg-primary/10 text-foreground"
				: "border-border bg-ide-editor text-muted-foreground hover:bg-ide-list-hover",
		)}
	>
		<span className="truncate">{label}</span>
		<CheckCircle2 className={cn("size-4 shrink-0", checked ? "opacity-100" : "opacity-30")} />
	</button>
);

const profileDraftFromProfile = (profile: AgentModelProfile): ProfileDraft => ({
	name: profile.name,
	providerId: profile.providerId,
	providerLabel: profile.providerLabel,
	baseURL: profile.baseURL,
	model: profile.model,
	modelDisplayName: profile.modelDisplayName,
	enabled: profile.enabled,
	isDefault: profile.isDefault,
	supportsImages: profile.supportsImages,
	supportsTools: profile.supportsTools,
	contextWindow: numberDraft(profile.contextWindow),
	maxOutputTokens: numberDraft(profile.maxOutputTokens),
	temperature: numberDraft(profile.temperature),
});

const mutationFromDraft = (draft: ProfileDraft): AgentModelProfileMutation => ({
	name: draft.name.trim(),
	providerId: draft.providerId.trim(),
	providerLabel: draft.providerLabel.trim(),
	baseURL: draft.baseURL.trim(),
	model: draft.model.trim(),
	modelDisplayName: draft.modelDisplayName.trim(),
	enabled: draft.enabled,
	isDefault: draft.isDefault,
	supportsImages: draft.supportsImages,
	supportsTools: draft.supportsTools,
	contextWindow: numberValue(draft.contextWindow),
	maxOutputTokens: numberValue(draft.maxOutputTokens),
	temperature: numberValue(draft.temperature),
});

const numberDraft = (value?: number) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? String(value) : "";

const numberValue = (value: string) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const errorMessage = (err: unknown, fallback: string) =>
	err instanceof Error ? err.message : fallback;
