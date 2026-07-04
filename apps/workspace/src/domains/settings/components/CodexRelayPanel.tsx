import * as DialogPrimitive from "@radix-ui/react-dialog";
import { KeyRound, Loader2, Network, Plus, Star, Trash2, Wifi, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	type CodexRelayProfile,
	type CodexRelayProfileMutation,
	type CodexRelayProtocol,
	checkCodexRelaySettings,
	codexRelaySettingsKey,
	clearCodexRelayProfileAPIKey,
	getCodexRelaySettings,
	saveCodexRelayProfileAPIKey,
	saveCodexRelaySettings,
} from "@/domains/settings/api/settings";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Button } from "@/shared/components/ui/button";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

interface CodexRelayProfileDraft {
	id: string;
	name: string;
	baseURL: string;
	model: string;
	protocol: CodexRelayProtocol;
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
	const [apiKeyDialogOpen, setAPIKeyDialogOpen] = useState(false);
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

	const saveEnabled = async (nextEnabled: boolean) => {
		if (busy) return;
		const previousEnabled = enabled;
		setEnabled(nextEnabled);
		setBusy("enabled");
		let settingsSaved = false;
		try {
			const nextData = await saveCodexRelaySettings(settingsMutation(nextEnabled));
			settingsSaved = true;
			await mutate(nextData, false);
			if (nextEnabled) {
				await checkCodexRelaySettings();
			}
			toast.success(nextEnabled ? "Codex 中转已启用" : "Codex 中转已停用");
		} catch (err) {
			setEnabled(previousEnabled);
			if (settingsSaved) {
				try {
					const rollbackData = await saveCodexRelaySettings(settingsMutation(previousEnabled));
					await mutate(rollbackData, false);
				} catch {
					// Keep the visible switch consistent; a later refresh will reconcile persisted state.
				}
			}
			toast.error(nextEnabled ? "启用失败" : "保存失败", {
				description: errorMessage(err, "保存 Codex 中转失败。"),
			});
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
			if (nextData.enabled && nextData.activeProfileId === selectedProfile.id) {
				await checkCodexRelaySettings();
			}
			setAPIKeys((current) => ({ ...current, [selectedProfile.id]: "" }));
			setAPIKeyDialogOpen(false);
			toast.success("API Key 已保存", { description: selectedProfile.name });
		} catch (err) {
			toast.error("保存失败", { description: errorMessage(err, "保存 API Key 失败。") });
		} finally {
			setBusy("");
		}
	};

	const saveActiveProfile = async () => {
		if (!selectedProfile || busy || activeProfileID === selectedProfile.id) return;
		const previousActiveID = activeProfileID;
		const nextActiveID = selectedProfile.id;
		setActiveProfileID(nextActiveID);
		setBusy(`active:${nextActiveID}`);
		let settingsSaved = false;
		try {
			const nextData = await saveCodexRelaySettings(settingsMutation(enabled, nextActiveID));
			settingsSaved = true;
			await mutate(nextData, false);
			if (enabled) {
				await checkCodexRelaySettings();
			}
			toast.success("已使用当前配置", { description: selectedProfile.name });
		} catch (err) {
			setActiveProfileID(previousActiveID);
			if (settingsSaved) {
				try {
					const rollbackData = await saveCodexRelaySettings(
						settingsMutation(enabled, previousActiveID),
					);
					await mutate(rollbackData, false);
				} catch {
					// Keep the visible active marker consistent; a later refresh will reconcile persisted state.
				}
			}
			toast.error("生效失败", { description: errorMessage(err, "保存 Codex 中转失败。") });
		} finally {
			setBusy("");
		}
	};

	const testConnectivity = async () => {
		if (!selectedProfile || busy) return;
		const profileID = selectedProfile.id;
		const profileName = selectedProfile.name;
		setBusy("check");
		try {
			const nextData = await saveCodexRelaySettings(settingsMutation());
			await mutate(nextData, false);
			const result = await checkCodexRelaySettings({ profileId: profileID });
			toast.success("连通性测试通过", {
				description: result.baseURL || profileName,
			});
		} catch (err) {
			toast.error("连通性测试失败", {
				description: errorMessage(err, "Codex 中转连通性测试失败。"),
			});
		} finally {
			setBusy("");
		}
	};

	const settingsMutation = (
		nextEnabled = enabled,
		nextActiveProfileID = activeProfileID || selectedProfile?.id || "",
	) => ({
		enabled: nextEnabled,
		activeProfileId: nextActiveProfileID,
		profiles: profiles.map(mutationFromDraft),
	});

	const clearAPIKey = async () => {
		if (!selectedProfile || busy) return false;
		setBusy(`clear-key:${selectedProfile.id}`);
		try {
			const nextData = await clearCodexRelayProfileAPIKey(selectedProfile.id);
			await mutate(nextData, false);
			setAPIKeys((current) => ({ ...current, [selectedProfile.id]: "" }));
			setAPIKeyDialogOpen(false);
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
				<HeaderEnableSwitch
					busy={busy === "enabled"}
					checked={enabled}
					disabled={busy !== "" || (isLoading && profiles.length === 0)}
					onCheckedChange={(nextChecked) => void saveEnabled(nextChecked)}
				/>
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
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="rounded-md"
									disabled={busy !== ""}
									onClick={() => void testConnectivity()}
								>
									{busy === "check" ? <Loader2 className="animate-spin" /> : <Wifi />}
									<span>测试连通性</span>
								</Button>
								{activeProfileID === selectedProfile.id ? null : (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="rounded-md"
										disabled={busy !== ""}
										onClick={() => void saveActiveProfile()}
									>
										<Star />
										<span>使用当前配置</span>
									</Button>
								)}
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

						<div className="grid gap-4">
							<TextField
								label="名称"
								value={selectedProfile.name}
								onChange={(value) => updateProfile(selectedProfile.id, "name", value)}
							/>
							<label className="min-w-0">
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

						<div>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="min-w-0">
									<div className="text-xs font-medium text-muted-foreground">API Key</div>
									<p className="mt-1 truncate font-mono text-xs text-muted-foreground">
										{selectedProfile.apiKey?.masked ||
											(selectedProfile.apiKey?.configured ? "Key 已保存" : "未配置")}
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									className="rounded-md"
									disabled={busy !== ""}
									onClick={() => setAPIKeyDialogOpen(true)}
								>
									<KeyRound />
									<span>{selectedProfile.apiKey?.configured ? "编辑 Key" : "添加 Key"}</span>
								</Button>
							</div>
							<APIKeyEditDialog
								apiKey={apiKeys[selectedProfile.id] ?? ""}
								busy={busy}
								onAPIKeyChange={(value) =>
									setAPIKeys((current) => ({
										...current,
										[selectedProfile.id]: value,
									}))
								}
								onClear={confirmClearAPIKey}
								onOpenChange={setAPIKeyDialogOpen}
								onSave={() => void saveAPIKey()}
								open={apiKeyDialogOpen}
								profile={selectedProfile}
							/>
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
			{current ? (
				<span className="shrink-0 rounded-control border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary">
					已生效
				</span>
			) : null}
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

const HeaderEnableSwitch: React.FC<{
	busy: boolean;
	checked: boolean;
	disabled: boolean;
	onCheckedChange: (checked: boolean) => void;
}> = ({ busy, checked, disabled, onCheckedChange }) => (
	<div
		className={cn(
			"inline-flex h-9 items-center gap-2 rounded-md border border-border bg-ide-editor px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-ide-list-hover",
			disabled && "opacity-60",
		)}
	>
		<Switch
			aria-label="Codex 中转启用状态"
			checked={checked}
			disabled={disabled}
			onCheckedChange={onCheckedChange}
		/>
		{busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
		<span className={checked ? "text-foreground" : undefined}>{checked ? "已启用" : "未启用"}</span>
	</div>
);

const APIKeyEditDialog: React.FC<{
	apiKey: string;
	busy: string;
	onAPIKeyChange: (value: string) => void;
	onClear: () => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
	open: boolean;
	profile: CodexRelayProfileDraft;
}> = ({ apiKey, busy, onAPIKeyChange, onClear, onOpenChange, onSave, open, profile }) => {
	const inputID = `codex-relay-key-dialog-${profile.id}`;
	const isSaving = busy === `key:${profile.id}`;
	const isClearing = busy === `clear-key:${profile.id}`;
	const hasSavedKey = profile.apiKey?.configured;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className={cn(
						"fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-sm border border-border bg-ide-panel p-4 text-ide-panel-foreground shadow-xl outline-none",
						dialogContentMotion,
					)}
				>
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">
								编辑 API Key
							</DialogPrimitive.Title>
							<p className="mt-1 truncate text-xs text-muted-foreground">{profile.name}</p>
						</div>
						<DialogPrimitive.Close asChild>
							<Button type="button" variant="ghost" size="icon" aria-label="关闭">
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					<div className="mt-4 grid gap-2">
						<Label htmlFor={inputID} className="text-xs text-muted-foreground">
							API Key
						</Label>
						<Input
							id={inputID}
							type="password"
							value={apiKey}
							onChange={(event) => onAPIKeyChange(event.target.value)}
							placeholder={hasSavedKey ? "输入新的 Key 以替换当前凭据" : "输入 API Key"}
							className="rounded-md font-mono"
						/>
					</div>

					<div className="mt-5 flex flex-wrap items-center justify-between gap-2">
						<Button
							type="button"
							variant="outline"
							className="rounded-md"
							disabled={busy !== "" || !hasSavedKey}
							onClick={onClear}
						>
							{isClearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
							<span>清除</span>
						</Button>
						<div className="flex items-center gap-2">
							<DialogPrimitive.Close asChild>
								<Button
									type="button"
									variant="outline"
									className="rounded-md"
									disabled={busy !== ""}
								>
									取消
								</Button>
							</DialogPrimitive.Close>
							<Button
								type="button"
								className="rounded-md"
								disabled={busy !== "" || !apiKey.trim()}
								onClick={onSave}
							>
								{isSaving ? <Loader2 className="animate-spin" /> : <KeyRound />}
								<span>保存 Key</span>
							</Button>
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};

const draftFromProfile = (profile: CodexRelayProfile): CodexRelayProfileDraft => ({
	id: profile.id,
	name: profile.name,
	baseURL: profile.baseURL,
	model: profile.model || "gpt-5.5",
	protocol: profile.protocol,
	apiKey: profile.apiKey,
});

const defaultDraft = (index = 1): CodexRelayProfileDraft => ({
	id: index <= 1 ? "default" : `relay-${index}`,
	name: index <= 1 ? "默认中转" : `中转 ${index}`,
	baseURL: "",
	model: "gpt-5.5",
	protocol: "responses",
	apiKey: { configured: false, source: "none" },
});

const mutationFromDraft = (draft: CodexRelayProfileDraft): CodexRelayProfileMutation => ({
	id: draft.id,
	name: draft.name.trim(),
	baseURL: draft.baseURL.trim(),
	model: draft.model.trim() || "gpt-5.5",
	protocol: draft.protocol,
	enabled: true,
});

const errorMessage = (err: unknown, fallback: string) => {
	if (err instanceof Error && err.message) return err.message;
	if (
		err &&
		typeof err === "object" &&
		"message" in err &&
		typeof err.message === "string" &&
		err.message.trim()
	) {
		return err.message;
	}
	return fallback;
};
