import openAIIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
	ExternalLink,
	Loader2,
	LogIn,
	LogOut,
	Network,
	Pencil,
	Plus,
	Route,
	Trash2,
	Wifi,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { isAgentRuntimeConfigKey } from "@/domains/agent/api/agent";
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
import { DialogClose } from "@/shared/components/ui/dialog-dismiss";
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

type OfficialChannelStatus = "error" | "loading" | "loggedIn" | "loggedOut" | "pending";

export interface CodexOfficialChannel {
	busy: boolean;
	detail?: string;
	email?: string;
	onCancel: () => void;
	onLogin: () => void;
	onLogout: () => void;
	onReopen: () => void;
	status: OfficialChannelStatus;
}

interface CodexRelayPanelProps {
	description?: React.ReactNode;
	officialChannel?: CodexOfficialChannel;
	title?: React.ReactNode;
}

export const CodexRelayPanel: React.FC<CodexRelayPanelProps> = ({
	description = "配置 Codex ACP 请求使用的本地中转代理。",
	officialChannel,
	title = "Codex 中转",
}) => {
	const toast = useToast();
	const { mutate: mutateGlobal } = useSWRConfig();
	const { data, mutate, isLoading } = useSWR(codexRelaySettingsKey, getCodexRelaySettings);
	const [enabled, setEnabled] = useState(false);
	const [activeProfileID, setActiveProfileID] = useState("");
	const [profiles, setProfiles] = useState<CodexRelayProfileDraft[]>([]);
	const [profileDraft, setProfileDraft] = useState<CodexRelayProfileDraft>();
	const [profileAPIKey, setProfileAPIKey] = useState("");
	const [profileDialogOpen, setProfileDialogOpen] = useState(false);
	const [busy, setBusy] = useState("");

	useEffect(() => {
		if (!data) return;
		const nextProfiles = data.profiles.map(draftFromProfile);
		setEnabled(data.enabled);
		setProfiles(nextProfiles);
		setActiveProfileID(data.activeProfileId || nextProfiles[0]?.id || "");
	}, [data]);

	const revalidateAgentRuntimeConfig = () => {
		void mutateGlobal(isAgentRuntimeConfigKey, undefined, { revalidate: true });
	};

	const settingsMutation = (
		nextEnabled = enabled,
		nextActiveProfileID = activeProfileID || profiles[0]?.id || "",
		nextProfiles = profiles,
	) => ({
		enabled: nextEnabled,
		activeProfileId: nextActiveProfileID,
		profiles: nextProfiles.map(mutationFromDraft),
	});

	const saveEnabled = async (nextEnabled: boolean) => {
		if (busy) return;
		const nextActiveProfileID = activeProfileID || profiles[0]?.id || "";
		if (nextEnabled && !nextActiveProfileID) {
			toast.error("无法开启路由", { description: "请先新增并配置一个中转渠道。" });
			return;
		}

		const previousEnabled = enabled;
		setEnabled(nextEnabled);
		setBusy("enabled");
		let settingsSaved = false;
		try {
			const nextData = await saveCodexRelaySettings(
				settingsMutation(nextEnabled, nextActiveProfileID),
			);
			settingsSaved = true;
			await mutate(nextData, false);
			if (nextEnabled) await checkCodexRelaySettings({ profileId: nextActiveProfileID });
			toast.success(nextEnabled ? "Codex 路由已开启" : "已切换到 ChatGPT 官方订阅");
		} catch (err) {
			setEnabled(previousEnabled);
			if (settingsSaved) {
				try {
					const rollbackData = await saveCodexRelaySettings(
						settingsMutation(previousEnabled, activeProfileID),
					);
					await mutate(rollbackData, false);
				} catch {
					// A later SWR refresh reconciles an unsuccessful rollback.
				}
			}
			toast.error(nextEnabled ? "启用失败" : "保存失败", {
				description: errorMessage(err, "保存 Codex 中转失败。"),
			});
		} finally {
			if (settingsSaved) revalidateAgentRuntimeConfig();
			setBusy("");
		}
	};

	const activateOfficialChannel = () => {
		if (!officialChannel || busy || officialChannel.busy) return;
		if (officialChannel.status === "loggedIn") {
			if (enabled) void saveEnabled(false);
			return;
		}
		if (officialChannel.status === "loggedOut") officialChannel.onLogin();
		if (officialChannel.status === "pending") officialChannel.onReopen();
	};

	const activateRelayProfile = async (profile: CodexRelayProfileDraft) => {
		if (busy || (enabled && activeProfileID === profile.id)) return;
		const previousEnabled = enabled;
		const previousActiveID = activeProfileID;
		setEnabled(true);
		setActiveProfileID(profile.id);
		setBusy(`active:${profile.id}`);
		let settingsSaved = false;
		try {
			const nextData = await saveCodexRelaySettings(settingsMutation(true, profile.id));
			settingsSaved = true;
			await mutate(nextData, false);
			await checkCodexRelaySettings({ profileId: profile.id });
			toast.success("已切换 Codex 渠道", { description: profile.name });
		} catch (err) {
			setEnabled(previousEnabled);
			setActiveProfileID(previousActiveID);
			if (settingsSaved) {
				try {
					const rollbackData = await saveCodexRelaySettings(
						settingsMutation(previousEnabled, previousActiveID),
					);
					await mutate(rollbackData, false);
				} catch {
					// A later SWR refresh reconciles an unsuccessful rollback.
				}
			}
			toast.error("切换失败", {
				description: errorMessage(err, "Codex 中转配置不可用。"),
			});
		} finally {
			if (settingsSaved) revalidateAgentRuntimeConfig();
			setBusy("");
		}
	};

	const openNewProfile = () => {
		setProfileDraft(nextDefaultDraft(profiles));
		setProfileAPIKey("");
		setProfileDialogOpen(true);
	};

	const openProfileEditor = (profile: CodexRelayProfileDraft) => {
		setProfileDraft({ ...profile });
		setProfileAPIKey("");
		setProfileDialogOpen(true);
	};

	const saveProfile = async () => {
		if (!profileDraft || busy) return;
		const isExisting = profiles.some((profile) => profile.id === profileDraft.id);
		const nextProfiles = isExisting
			? profiles.map((profile) => (profile.id === profileDraft.id ? profileDraft : profile))
			: [...profiles, profileDraft];
		const nextActiveID = activeProfileID || profileDraft.id;
		const nextAPIKey = profileAPIKey.trim();
		setBusy(`profile:${profileDraft.id}`);
		let runtimeConfigChanged = false;
		try {
			let nextData = await saveCodexRelaySettings(
				settingsMutation(enabled, nextActiveID, nextProfiles),
			);
			runtimeConfigChanged = true;
			await mutate(nextData, false);
			if (nextAPIKey) {
				nextData = await saveCodexRelayProfileAPIKey(profileDraft.id, nextAPIKey);
				await mutate(nextData, false);
				if (nextData.enabled && nextData.activeProfileId === profileDraft.id) {
					await checkCodexRelaySettings({ profileId: profileDraft.id });
				}
			}
			setProfiles(nextData.profiles.map(draftFromProfile));
			setEnabled(nextData.enabled);
			setActiveProfileID(nextData.activeProfileId || nextActiveID);
			setProfileDialogOpen(false);
			setProfileDraft(undefined);
			setProfileAPIKey("");
			toast.success(isExisting ? "中转配置已保存" : "中转渠道已新增", {
				description: profileDraft.name,
			});
		} catch (err) {
			toast.error("保存失败", { description: errorMessage(err, "保存中转配置失败。") });
		} finally {
			if (runtimeConfigChanged) revalidateAgentRuntimeConfig();
			setBusy("");
		}
	};
	const testConnectivity = async (profile: CodexRelayProfileDraft) => {
		if (busy) return;
		setBusy(`check:${profile.id}`);
		let settingsSaved = false;
		try {
			const nextData = await saveCodexRelaySettings(settingsMutation());
			settingsSaved = true;
			await mutate(nextData, false);
			const result = await checkCodexRelaySettings({ profileId: profile.id });
			toast.success("连通性测试通过", { description: result.baseURL || profile.name });
		} catch (err) {
			toast.error("连通性测试失败", {
				description: errorMessage(err, "Codex 中转连通性测试失败。"),
			});
		} finally {
			if (settingsSaved) revalidateAgentRuntimeConfig();
			setBusy("");
		}
	};

	const removeProfile = async (profile: CodexRelayProfileDraft) => {
		if (busy) return false;
		setBusy(`delete:${profile.id}`);
		try {
			const nextProfiles = profiles.filter((item) => item.id !== profile.id);
			const nextActiveID =
				activeProfileID === profile.id ? nextProfiles[0]?.id || "" : activeProfileID;
			const nextEnabled = enabled && Boolean(nextActiveID);
			const nextData = await saveCodexRelaySettings(
				settingsMutation(nextEnabled, nextActiveID, nextProfiles),
			);
			await mutate(nextData, false);
			setProfiles(nextProfiles);
			setEnabled(nextEnabled);
			setActiveProfileID(nextActiveID);
			revalidateAgentRuntimeConfig();
			toast.success("中转配置已删除", { description: profile.name });
			return true;
		} catch (err) {
			toast.error("删除失败", { description: errorMessage(err, "删除中转配置失败。") });
			return false;
		} finally {
			setBusy("");
		}
	};

	const confirmRemoveProfile = (profile: CodexRelayProfileDraft) => {
		if (busy) return;
		void confirmDialog({
			title: "删除中转配置？",
			description: `确定要删除“${profile.name}”吗？保存的 Key 不会继续用于 Codex。`,
			confirmLabel: "删除",
			confirmIcon: <Trash2 />,
			onConfirm: () => removeProfile(profile),
		});
	};

	const clearAPIKey = async () => {
		if (!profileDraft || busy) return false;
		setBusy(`clear-key:${profileDraft.id}`);
		try {
			const nextData = await clearCodexRelayProfileAPIKey(profileDraft.id);
			await mutate(nextData, false);
			revalidateAgentRuntimeConfig();
			setProfiles(nextData.profiles.map(draftFromProfile));
			setProfileDraft((current) =>
				current ? { ...current, apiKey: { configured: false, source: "none" } } : current,
			);
			setProfileAPIKey("");
			toast.success("API Key 已清除", { description: profileDraft.name });
			return true;
		} catch (err) {
			toast.error("清除失败", { description: errorMessage(err, "清除 API Key 失败。") });
			return false;
		} finally {
			setBusy("");
		}
	};

	const confirmClearAPIKey = () => {
		if (!profileDraft || busy) return;
		void confirmDialog({
			title: "清除 API Key？",
			description: `确定要清除“${profileDraft.name}”的 API Key 吗？`,
			confirmLabel: "清除",
			confirmIcon: <Trash2 />,
			onConfirm: clearAPIKey,
		});
	};

	return (
		<SettingsPanelLayout
			title={title}
			description={description}
			icon={<Network className="size-4" />}
			actions={
				<>
					<HeaderEnableSwitch
						busy={busy === "enabled"}
						checked={enabled}
						disabled={busy !== "" || isLoading}
						onCheckedChange={(nextChecked) => void saveEnabled(nextChecked)}
					/>
					<Button
						type="button"
						variant="outline"
						className="rounded-md"
						disabled={busy !== ""}
						onClick={openNewProfile}
					>
						<Plus />
						<span>新增中转</span>
					</Button>
				</>
			}
		>
			<div className="mx-auto w-full max-w-5xl space-y-3">
				{officialChannel ? (
					<OfficialChannelCard
						active={!enabled}
						channel={officialChannel}
						disabled={busy !== ""}
						onActivate={activateOfficialChannel}
					/>
				) : null}

				{isLoading && profiles.length === 0 ? (
					<div className="flex items-center justify-center gap-2 rounded-md border border-border py-10 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>正在读取中转渠道</span>
					</div>
				) : null}

				{profiles.map((profile) => (
					<RelayChannelCard
						key={profile.id}
						active={enabled && activeProfileID === profile.id}
						busy={busy}
						profile={profile}
						onActivate={() => void activateRelayProfile(profile)}
						onDelete={() => confirmRemoveProfile(profile)}
						onEdit={() => openProfileEditor(profile)}
						onTest={() => void testConnectivity(profile)}
					/>
				))}

				{!isLoading && profiles.length === 0 ? (
					<button
						type="button"
						className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
						onClick={openNewProfile}
					>
						<Plus className="size-4" />
						新增第一个中转渠道
					</button>
				) : null}
			</div>

			<RelayProfileEditDialog
				apiKey={profileAPIKey}
				busy={busy}
				draft={profileDraft}
				onAPIKeyChange={setProfileAPIKey}
				onClearAPIKey={confirmClearAPIKey}
				onDraftChange={setProfileDraft}
				onOpenChange={(open) => {
					setProfileDialogOpen(open);
					if (!open) {
						setProfileDraft(undefined);
						setProfileAPIKey("");
					}
				}}
				onSave={() => void saveProfile()}
				open={profileDialogOpen}
				isExisting={Boolean(
					profileDraft && profiles.some((profile) => profile.id === profileDraft.id),
				)}
			/>
		</SettingsPanelLayout>
	);
};

const OfficialChannelCard: React.FC<{
	active: boolean;
	channel: CodexOfficialChannel;
	disabled: boolean;
	onActivate: () => void;
}> = ({ active, channel, disabled, onActivate }) => {
	const statusCopy = officialStatusCopy(channel);
	return (
		<div className={channelCardClass(active)} data-testid="official-channel-card">
			<button
				type="button"
				aria-label="使用 ChatGPT 官方订阅"
				className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
				disabled={disabled || channel.status === "error" || channel.status === "loading"}
				onClick={onActivate}
			>
				<span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-card">
					<img src={openAIIcon} alt="" aria-hidden="true" className="size-6 dark:invert" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-center gap-2">
						<span className="truncate text-sm font-semibold text-foreground">ChatGPT 官方订阅</span>
						<ChannelTypeBadge>Codex 登录</ChannelTypeBadge>
						{active ? <CurrentChannelBadge /> : null}
					</span>
					<span className="mt-1 block truncate text-xs text-muted-foreground">{statusCopy}</span>
				</span>
			</button>
			<div className="flex shrink-0 items-center gap-2 px-4">
				{channel.status === "pending" ? (
					<>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={channel.busy}
							onClick={channel.onReopen}
						>
							<ExternalLink />
							重新打开浏览器
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={channel.busy}
							onClick={channel.onCancel}
						>
							取消
						</Button>
					</>
				) : channel.status === "loggedIn" ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={channel.busy}
						onClick={channel.onLogout}
					>
						<LogOut />
						退出全局账号
					</Button>
				) : channel.status === "loggedOut" ? (
					<Button type="button" size="sm" disabled={channel.busy} onClick={channel.onLogin}>
						<LogIn />
						使用 ChatGPT 登录
					</Button>
				) : null}
			</div>
		</div>
	);
};

const RelayChannelCard: React.FC<{
	active: boolean;
	busy: string;
	onActivate: () => void;
	onDelete: () => void;
	onEdit: () => void;
	onTest: () => void;
	profile: CodexRelayProfileDraft;
}> = ({ active, busy, onActivate, onDelete, onEdit, onTest, profile }) => (
	<div
		className={cn(channelCardClass(active), "group")}
		data-testid={`relay-channel-${profile.id}`}
	>
		<button
			type="button"
			aria-label={`使用中转渠道 ${profile.name || "未命名中转"}`}
			className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			disabled={busy !== ""}
			onClick={onActivate}
		>
			<span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
				<Route className="size-5" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-2">
					<span className="truncate text-sm font-semibold text-foreground">
						{profile.name || "未命名中转"}
					</span>
					<ChannelTypeBadge>需要路由</ChannelTypeBadge>
					{active ? <CurrentChannelBadge /> : null}
				</span>
				<span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
					{profile.baseURL || "未配置 Base URL"}
				</span>
			</span>
		</button>
		<div
			className={cn(
				"flex shrink-0 items-center gap-1 px-3 transition-opacity",
				active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
			)}
		>
			<ChannelActionButton
				label="测试连通性"
				disabled={busy !== ""}
				onClick={onTest}
				loading={busy === `check:${profile.id}`}
				icon={<Wifi />}
			/>
			<ChannelActionButton
				label={`编辑 ${profile.name}`}
				disabled={busy !== ""}
				onClick={onEdit}
				icon={<Pencil />}
			/>
			<ChannelActionButton
				label={`删除 ${profile.name}`}
				disabled={busy !== ""}
				onClick={onDelete}
				loading={busy === `delete:${profile.id}`}
				icon={<Trash2 />}
			/>
		</div>
	</div>
);

const ChannelActionButton: React.FC<{
	disabled: boolean;
	icon: React.ReactNode;
	label: string;
	loading?: boolean;
	onClick: () => void;
}> = ({ disabled, icon, label, loading, onClick }) => (
	<Button
		type="button"
		variant="ghost"
		size="icon"
		className="size-8 rounded-md"
		aria-label={label}
		title={label}
		disabled={disabled}
		onClick={onClick}
	>
		{loading ? <Loader2 className="animate-spin" /> : icon}
	</Button>
);

const ChannelTypeBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<span className="shrink-0 rounded-control bg-info-surface px-2 py-0.5 text-[11px] font-medium text-info-foreground">
		{children}
	</span>
);

const CurrentChannelBadge = () => (
	<span className="shrink-0 rounded-control border border-success-border bg-success-surface px-2 py-0.5 text-[11px] font-medium text-success-foreground">
		当前渠道
	</span>
);

const channelCardClass = (active: boolean) =>
	cn(
		"flex min-h-20 w-full overflow-hidden rounded-md border bg-card transition-colors",
		active
			? "border-primary/70 bg-primary/5 shadow-sm"
			: "border-border hover:border-primary/30 hover:bg-ide-list-hover",
	);

const officialStatusCopy = (channel: CodexOfficialChannel) => {
	switch (channel.status) {
		case "loading":
			return "正在读取全局 Codex 账号";
		case "error":
			return "内置 Codex 账号服务不可用";
		case "pending":
			return "正在等待浏览器完成 ChatGPT 授权";
		case "loggedIn":
			return [channel.email || "已登录", channel.detail].filter(Boolean).join(" · ");
		case "loggedOut":
			return "尚未登录，点击后使用 ChatGPT 官方订阅";
	}
};

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
		<span className={checked ? "text-foreground" : undefined}>
			{checked ? "路由已开启" : "路由未开启"}
		</span>
	</div>
);

const RelayProfileEditDialog: React.FC<{
	apiKey: string;
	busy: string;
	draft?: CodexRelayProfileDraft;
	isExisting: boolean;
	onAPIKeyChange: (value: string) => void;
	onClearAPIKey: () => void;
	onDraftChange: (draft: CodexRelayProfileDraft) => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
	open: boolean;
}> = ({
	apiKey,
	busy,
	draft,
	isExisting,
	onAPIKeyChange,
	onClearAPIKey,
	onDraftChange,
	onOpenChange,
	onSave,
	open,
}) => (
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
					<div>
						<DialogPrimitive.Title className="text-sm font-semibold text-foreground">
							{isExisting ? "编辑中转渠道" : "新增中转渠道"}
						</DialogPrimitive.Title>
						<p className="mt-1 text-xs text-muted-foreground">
							配置 Codex Responses 兼容服务的名称、地址和凭据。
						</p>
					</div>
					<DialogClose asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭">
							<X className="size-4" />
						</Button>
					</DialogClose>
				</div>

				{draft ? (
					<div className="mt-5 grid gap-4">
						<label>
							<span className="mb-2 block text-xs text-muted-foreground">名称</span>
							<Input
								value={draft.name}
								onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
								className="rounded-md"
							/>
						</label>
						<label>
							<span className="mb-2 block text-xs text-muted-foreground">Base URL</span>
							<Input
								value={draft.baseURL}
								onChange={(event) => onDraftChange({ ...draft, baseURL: event.target.value })}
								placeholder="https://relay.example.com/v1"
								className="rounded-md font-mono"
							/>
						</label>
						<div className="grid gap-2">
							<div className="flex items-center justify-between gap-3">
								<Label
									htmlFor={`codex-relay-key-${draft.id}`}
									className="text-xs text-muted-foreground"
								>
									API Key
								</Label>
								{draft.apiKey?.configured ? (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 rounded-md text-xs text-destructive"
										disabled={busy !== ""}
										onClick={onClearAPIKey}
									>
										{busy === `clear-key:${draft.id}` ? <Loader2 className="animate-spin" /> : null}
										清除已保存 Key
									</Button>
								) : null}
							</div>
							<Input
								id={`codex-relay-key-${draft.id}`}
								type="password"
								value={apiKey}
								onChange={(event) => onAPIKeyChange(event.target.value)}
								placeholder={
									draft.apiKey?.configured ? "留空则继续使用已保存的 Key" : "输入 API Key（可选）"
								}
								className="rounded-md font-mono"
							/>
						</div>
					</div>
				) : null}

				<div className="mt-5 flex justify-end gap-2">
					<DialogClose asChild>
						<Button type="button" variant="outline" className="rounded-md" disabled={busy !== ""}>
							取消
						</Button>
					</DialogClose>
					<Button
						type="button"
						className="rounded-md"
						disabled={busy !== "" || !draft?.name.trim() || !draft.baseURL.trim()}
						onClick={onSave}
					>
						{busy === `profile:${draft?.id}` ? <Loader2 className="animate-spin" /> : null}
						保存配置
					</Button>
				</div>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);
const draftFromProfile = (profile: CodexRelayProfile): CodexRelayProfileDraft => ({
	id: profile.id,
	name: profile.name,
	baseURL: profile.baseURL,
	model: profile.model || "gpt-5.5",
	protocol: profile.protocol,
	apiKey: profile.apiKey,
});

const nextDefaultDraft = (profiles: CodexRelayProfileDraft[]): CodexRelayProfileDraft => {
	let index = profiles.length + 1;
	let id = index <= 1 ? "default" : `relay-${index}`;
	while (profiles.some((profile) => profile.id === id)) {
		index += 1;
		id = `relay-${index}`;
	}
	return {
		id,
		name: index <= 1 ? "默认中转" : `中转 ${index}`,
		baseURL: "",
		model: "gpt-5.5",
		protocol: "responses",
		apiKey: { configured: false, source: "none" },
	};
};

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
