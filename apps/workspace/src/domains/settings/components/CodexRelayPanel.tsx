import { CheckCircle2, KeyRound, Loader2, Network, Plus, Save, Star, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type CodexRelayProfile,
	type CodexRelayProfileMutation,
	type CodexRelayProtocol,
	codexRelaySettingsKey,
	clearCodexRelayProfileAPIKey,
	getCodexRelaySettings,
	saveCodexRelayProfileAPIKey,
	saveCodexRelaySettings,
} from "@/domains/settings/api/settings";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

interface CodexRelayProfileDraft {
	id: string;
	name: string;
	baseURL: string;
	model: string;
	protocol: CodexRelayProtocol;
	enabled: boolean;
	apiKey?: CodexRelayProfile["apiKey"];
}

export const CodexRelayPanel: React.FC = () => {
	const toast = useToast();
	const { data, mutate, isLoading } = useSWR(codexRelaySettingsKey, getCodexRelaySettings);
	const [enabled, setEnabled] = useState(false);
	const [activeProfileID, setActiveProfileID] = useState("");
	const [profiles, setProfiles] = useState<CodexRelayProfileDraft[]>([]);
	const [selectedID, setSelectedID] = useState("");
	const [apiKeys, setAPIKeys] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState("");

	useEffect(() => {
		if (!data) return;
		const nextProfiles =
			data.profiles.length > 0 ? data.profiles.map(draftFromProfile) : [defaultDraft()];
		setEnabled(data.enabled);
		setProfiles(nextProfiles);
		setActiveProfileID(data.activeProfileId || nextProfiles[0]?.id || "");
		setSelectedID((current) =>
			current && nextProfiles.some((profile) => profile.id === current)
				? current
				: data.activeProfileId || nextProfiles[0]?.id || "",
		);
	}, [data]);

	const selectedProfile = useMemo(
		() => profiles.find((profile) => profile.id === selectedID) ?? profiles[0],
		[profiles, selectedID],
	);

	const updateProfile = <K extends keyof CodexRelayProfileDraft>(
		profileID: string,
		key: K,
		value: CodexRelayProfileDraft[K],
	) => {
		setProfiles((current) =>
			current.map((profile) => (profile.id === profileID ? { ...profile, [key]: value } : profile)),
		);
	};

	const addProfile = () => {
		const draft = defaultDraft(profiles.length + 1);
		setProfiles((current) => [...current, draft]);
		setSelectedID(draft.id);
		if (!activeProfileID) setActiveProfileID(draft.id);
	};

	const removeSelectedProfile = async () => {
		if (!selectedProfile || busy) return false;
		setBusy(`delete:${selectedProfile.id}`);
		try {
			const nextProfiles = profiles.filter((profile) => profile.id !== selectedProfile.id);
			const nextActiveID =
				activeProfileID === selectedProfile.id ? nextProfiles[0]?.id || "" : activeProfileID;
			const nextData = await saveCodexRelaySettings({
				enabled: enabled && nextProfiles.length > 0,
				activeProfileId: nextActiveID,
				profiles: nextProfiles.map(mutationFromDraft),
			});
			await mutate(nextData, false);
			setSelectedID(nextActiveID || nextProfiles[0]?.id || "");
			toast.success("中转配置已删除", { description: selectedProfile.name });
			return true;
		} catch (err) {
			toast.error("删除失败", { description: errorMessage(err, "删除中转配置失败。") });
			return false;
		} finally {
			setBusy("");
		}
	};

	const confirmRemoveSelectedProfile = () => {
		if (!selectedProfile || busy) return;
		void confirmDialog({
			title: "删除中转配置？",
			description: `确定要删除“${selectedProfile.name}”吗？保存的 Key 不会继续用于 Codex。`,
			confirmLabel: "删除",
			confirmIcon: <Trash2 />,
			onConfirm: removeSelectedProfile,
		});
	};

	const saveSettings = async () => {
		if (busy) return;
		setBusy("save");
		try {
			const nextData = await saveCodexRelaySettings(settingsMutation());
			await mutate(nextData, false);
			toast.success("Codex 中转已保存");
		} catch (err) {
			toast.error("保存失败", { description: errorMessage(err, "保存 Codex 中转失败。") });
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
			await mutate(await saveCodexRelaySettings(settingsMutation()), false);
			const nextData = await saveCodexRelayProfileAPIKey(selectedProfile.id, apiKey);
			await mutate(nextData, false);
			setAPIKeys((current) => ({ ...current, [selectedProfile.id]: "" }));
			toast.success("API Key 已保存", { description: selectedProfile.name });
		} catch (err) {
			toast.error("保存失败", { description: errorMessage(err, "保存 API Key 失败。") });
		} finally {
			setBusy("");
		}
	};

	const settingsMutation = () => ({
		enabled,
		activeProfileId: activeProfileID || selectedProfile?.id || "",
		profiles: profiles.map(mutationFromDraft),
	});

	const clearAPIKey = async () => {
		if (!selectedProfile || busy) return false;
		setBusy(`clear-key:${selectedProfile.id}`);
		try {
			const nextData = await clearCodexRelayProfileAPIKey(selectedProfile.id);
			await mutate(nextData, false);
			setAPIKeys((current) => ({ ...current, [selectedProfile.id]: "" }));
			toast.success("API Key 已清除", { description: selectedProfile.name });
			return true;
		} catch (err) {
			toast.error("清除失败", { description: errorMessage(err, "清除 API Key 失败。") });
			return false;
		} finally {
			setBusy("");
		}
	};

	const confirmClearAPIKey = () => {
		if (!selectedProfile || busy) return;
		void confirmDialog({
			title: "清除 API Key？",
			description: `确定要清除“${selectedProfile.name}”的 API Key 吗？`,
			confirmLabel: "清除",
			confirmIcon: <Trash2 />,
			onConfirm: clearAPIKey,
		});
	};

	return (
		<SettingsPanelLayout
			title="Codex 中转"
			description="配置 Codex ACP 请求使用的本地中转代理。"
			icon={<Network className="size-4" />}
			actions={
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant={enabled ? "default" : "outline"}
						size="sm"
						className="rounded-md"
						onClick={() => setEnabled((current) => !current)}
					>
						<CheckCircle2 />
						<span>{enabled ? "已启用" : "未启用"}</span>
					</Button>
					<Button
						type="button"
						size="sm"
						className="rounded-md"
						disabled={busy !== ""}
						onClick={() => void saveSettings()}
					>
						{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
						<span>保存</span>
					</Button>
				</div>
			}
		>
			<div className="grid gap-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
				<div className="min-w-0 space-y-2">
					<div className="mb-3 flex items-center justify-between gap-2">
						<span className="text-xs font-medium text-muted-foreground">中转平台</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 rounded-md px-2"
							onClick={addProfile}
						>
							<Plus className="size-3.5" />
							<span>新增</span>
						</Button>
					</div>
					{isLoading && profiles.length === 0 ? (
						<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							<span>加载中</span>
						</div>
					) : null}
					{profiles.map((profile) => (
						<RelayProfileButton
							key={profile.id}
							active={profile.id === selectedProfile?.id}
							current={profile.id === activeProfileID}
							profile={profile}
							onClick={() => setSelectedID(profile.id)}
						/>
					))}
				</div>

				{selectedProfile ? (
					<div className="min-w-0 space-y-5">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
							<div className="min-w-0">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<h3 className="truncate text-sm font-semibold text-foreground">
										{selectedProfile.name}
									</h3>
									<Badge
										variant={selectedProfile.enabled ? "secondary" : "outline"}
										className="rounded-md"
									>
										{selectedProfile.enabled ? "启用" : "停用"}
									</Badge>
									<Badge
										variant={selectedProfile.apiKey?.configured ? "secondary" : "outline"}
										className="rounded-md"
									>
										{selectedProfile.apiKey?.configured ? "Key 已保存" : "未填写 Key"}
									</Badge>
								</div>
								<p className="mt-1 truncate text-xs text-muted-foreground">
									{selectedProfile.protocol} / {selectedProfile.model || "未设置模型"}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-md"
									disabled={busy !== "" || activeProfileID === selectedProfile.id}
									onClick={() => setActiveProfileID(selectedProfile.id)}
								>
									<Star />
									<span>设为当前</span>
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-md"
									disabled={busy !== ""}
									onClick={confirmRemoveSelectedProfile}
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
								value={selectedProfile.name}
								onChange={(value) => updateProfile(selectedProfile.id, "name", value)}
							/>
							<TextField
								label="模型"
								value={selectedProfile.model}
								onChange={(value) => updateProfile(selectedProfile.id, "model", value)}
							/>
							<label className="min-w-0 md:col-span-2">
								<span className="mb-2 block text-xs text-muted-foreground">Base URL</span>
								<Input
									value={selectedProfile.baseURL}
									onChange={(event) =>
										updateProfile(selectedProfile.id, "baseURL", event.target.value)
									}
									placeholder="https://relay.example.com/v1"
									className="rounded-md font-mono"
								/>
							</label>
						</div>

						<div className="grid gap-3 md:grid-cols-2">
							<ToggleField
								label="启用此平台"
								checked={selectedProfile.enabled}
								onChange={(value) => updateProfile(selectedProfile.id, "enabled", value)}
							/>
							<div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
								<span className="font-medium text-foreground">Responses</span>
								<span className="ml-2">当前协议</span>
							</div>
						</div>

						<div className="border-t border-border pt-4">
							<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
								<div className="min-w-0">
									<Label
										htmlFor={`codex-relay-key-${selectedProfile.id}`}
										className="mb-2 block text-xs text-muted-foreground"
									>
										API Key
									</Label>
									<Input
										id={`codex-relay-key-${selectedProfile.id}`}
										type="password"
										value={apiKeys[selectedProfile.id] ?? ""}
										onChange={(event) =>
											setAPIKeys((current) => ({
												...current,
												[selectedProfile.id]: event.target.value,
											}))
										}
										placeholder={
											selectedProfile.apiKey?.configured
												? "输入新的 Key 以替换当前凭据"
												: "输入 API Key"
										}
										className="rounded-md font-mono"
									/>
									{selectedProfile.apiKey?.masked ? (
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
											(!selectedProfile.apiKey?.configured && !apiKeys[selectedProfile.id]?.trim())
										}
										onClick={confirmClearAPIKey}
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
				) : null}
			</div>
		</SettingsPanelLayout>
	);
};

const RelayProfileButton: React.FC<{
	active: boolean;
	current: boolean;
	onClick: () => void;
	profile: CodexRelayProfileDraft;
}> = ({ active, current, onClick, profile }) => (
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
			<span className="truncate text-sm font-medium">{profile.name || "未命名平台"}</span>
			{current ? <Star className="size-3.5 shrink-0 text-primary" /> : null}
		</div>
		<p className="mt-1 truncate text-xs">{profile.baseURL || "未设置 Base URL"}</p>
	</button>
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

const draftFromProfile = (profile: CodexRelayProfile): CodexRelayProfileDraft => ({
	id: profile.id,
	name: profile.name,
	baseURL: profile.baseURL,
	model: profile.model,
	protocol: profile.protocol,
	enabled: profile.enabled,
	apiKey: profile.apiKey,
});

const defaultDraft = (index = 1): CodexRelayProfileDraft => ({
	id: index <= 1 ? "default" : `relay-${index}`,
	name: index <= 1 ? "默认中转" : `中转 ${index}`,
	baseURL: "",
	model: "gpt-5.5",
	protocol: "responses",
	enabled: true,
	apiKey: { configured: false, source: "none" },
});

const mutationFromDraft = (draft: CodexRelayProfileDraft): CodexRelayProfileMutation => ({
	id: draft.id,
	name: draft.name.trim(),
	baseURL: draft.baseURL.trim(),
	model: draft.model.trim(),
	protocol: draft.protocol,
	enabled: draft.enabled,
});

const errorMessage = (err: unknown, fallback: string) =>
	err instanceof Error ? err.message : fallback;
