import {
	IonBackButton,
	IonButton,
	IonButtons,
	IonContent,
	IonFooter,
	IonHeader,
	IonIcon,
	IonItem,
	IonLabel,
	IonList,
	IonModal,
	IonPage,
	IonPopover,
	IonTitle,
	IonToolbar,
} from "@ionic/react";
import { Redirect, useHistory, useParams } from "react-router-dom";
import {
	addOutline,
	chatbubbleEllipsesOutline,
	ellipsisVerticalOutline,
	sparklesOutline,
	timeOutline,
} from "ionicons/icons";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
	createGenerationConversation,
	defaultGenerationConversationScopeId,
	type GenerationAsset,
	type GenerationKind,
	generationConversationsQueryKey,
	generationModelsKey,
	generationTasksQueryKey,
	getGenerationConversations,
	getGenerationModels,
	getGenerationTasks,
	sendGenerationMessage,
} from "@/api/generation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";

const routeKind = (kind?: string): GenerationKind | null => {
	if (kind === "image" || kind === "video") return kind;
	return null;
};

const kindLabel = (kind: GenerationKind) => (kind === "image" ? "图片" : "视频");

const statusLabel = (status?: string) => {
	if (status === "completed") return "已完成";
	if (status === "failed") return "失败";
	if (status === "running") return "生成中";
	if (status === "queued") return "排队中";
	if (status === "submitted") return "已提交";
	return status || "等待中";
};

const assetSource = (asset: GenerationAsset) => {
	if (asset.url) return asset.url;
	if (!asset.base64) return "";
	return `data:${asset.mimeType || "application/octet-stream"};base64,${asset.base64}`;
};

const GenerationSession: React.FC = () => {
	const navigation = useHistory();
	const { kind: kindParam, conversationId } = useParams<{
		conversationId?: string;
		kind?: string;
	}>();
	const kind = routeKind(kindParam);
	const [selectedConversationId, setSelectedConversationId] = useState("");
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { data: models } = useSWR(generationModelsKey, getGenerationModels);
	const conversationsKey = kind ? generationConversationsQueryKey(kind) : null;
	const {
		data: conversationData,
		isLoading: isLoadingConversations,
		mutate: mutateConversations,
	} = useSWR(conversationsKey, () => (kind ? getGenerationConversations(kind) : undefined));
	const conversationList = conversationData?.conversations;
	const conversations = useMemo(() => conversationList ?? [], [conversationList]);
	const activeConversation = useMemo(() => {
		if (selectedConversationId) {
			return conversations.find((item) => item.id === selectedConversationId);
		}
		return conversations[0];
	}, [conversations, selectedConversationId]);
	const activeConversationId = selectedConversationId || activeConversation?.id || "";
	const tasksKey =
		kind && activeConversationId ? generationTasksQueryKey(activeConversationId, kind) : null;
	const {
		data: taskData,
		isLoading: isLoadingTasks,
		mutate: mutateTasks,
	} = useSWR(tasksKey, () =>
		kind && activeConversationId
			? getGenerationTasks(activeConversationId, kind)
			: undefined,
	);
	const tasks = taskData?.tasks ?? [];
	const selectedRoute = useMemo(
		() =>
			models?.routes.find(
				(route) =>
					route.kind === kind && route.configured && route.status === "available",
			),
		[kind, models?.routes],
	);

	useEffect(() => {
		setSelectedConversationId(conversationId ?? "");
		setPrompt("");
		setError(null);
		setIsHistoryOpen(false);
	}, [conversationId, kind]);

	const openConversation = useCallback(
		(id: string) => {
			if (!kind) return;
			setSelectedConversationId(id);
			setIsHistoryOpen(false);
			navigation.push(`/generate/${kind}/${encodeURIComponent(id)}`);
		},
		[kind, navigation],
	);

	const createConversation = useCallback(async () => {
		if (!kind || isCreating) return;
		setIsCreating(true);
		setError(null);
		try {
			const conversation = await createGenerationConversation({
				kind,
				scopeId: defaultGenerationConversationScopeId,
				title: `新${kindLabel(kind)}会话`,
			});
			setSelectedConversationId(conversation.id);
			setIsHistoryOpen(false);
			navigation.replace(`/generate/${kind}/${encodeURIComponent(conversation.id)}`);
			await mutateConversations();
		} catch (err) {
			setError(err instanceof Error ? err.message : "创建会话失败。");
		} finally {
			setIsCreating(false);
		}
	}, [isCreating, kind, mutateConversations, navigation]);

	const submit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!kind || !selectedRoute || !activeConversationId || !prompt.trim() || isSubmitting) {
				return;
			}

			setIsSubmitting(true);
			setError(null);
			try {
				await sendGenerationMessage({
					kind,
					conversationId: activeConversationId,
					scopeId: defaultGenerationConversationScopeId,
					routeId: selectedRoute.id,
					familyId: selectedRoute.familyId,
					versionId: selectedRoute.versionId,
					provider: selectedRoute.provider,
					modelId: selectedRoute.legacyModelId ?? "",
					model: selectedRoute.model,
					prompt: prompt.trim(),
					params: {},
					referenceUrls: [],
					referenceAssetIds: [],
				});
				setPrompt("");
				await mutateTasks();
				await mutateConversations();
			} catch (err) {
				setError(err instanceof Error ? err.message : "生成请求失败。");
			} finally {
				setIsSubmitting(false);
			}
		},
		[
			activeConversationId,
			isSubmitting,
			kind,
			mutateConversations,
			mutateTasks,
			prompt,
			selectedRoute,
		],
	);

	if (!kind) return <Redirect to="/generate" />;

	return (
		<IonPage>
			<IonHeader translucent>
				<IonToolbar>
					<IonButtons slot="start">
						<IonBackButton defaultHref="/generate" text="" />
					</IonButtons>
					<IonTitle>{kindLabel(kind)}</IonTitle>
					<IonButtons slot="end">
						<IonButton
							id="generation-session-menu"
							fill="clear"
							aria-label="会话菜单"
							disabled={isCreating}
						>
							<IonIcon aria-hidden="true" icon={ellipsisVerticalOutline} />
						</IonButton>
					</IonButtons>
				</IonToolbar>
			</IonHeader>

			<IonPopover
				trigger="generation-session-menu"
				side="bottom"
				alignment="end"
				dismissOnSelect
			>
				<IonList>
					<IonItem button detail={false} lines="none" onClick={createConversation}>
						<IonIcon aria-hidden="true" icon={addOutline} slot="start" />
						<IonLabel>新会话</IonLabel>
					</IonItem>
					<IonItem
						button
						detail={false}
						lines="none"
						onClick={() => setIsHistoryOpen(true)}
					>
						<IonIcon aria-hidden="true" icon={timeOutline} slot="start" />
						<IonLabel>历史会话</IonLabel>
					</IonItem>
				</IonList>
			</IonPopover>

			<IonContent fullscreen className="app-content">
				<div className="mx-auto grid w-full max-w-[34rem] content-start gap-4 px-4 py-4">
					{activeConversation ? (
						<div className="rounded-md border border-border bg-card px-3 py-2">
							<p className="text-xs text-muted-foreground">当前会话</p>
							<p className="mt-1 truncate text-sm font-medium text-foreground">
								{activeConversation.title}
							</p>
						</div>
					) : null}

					{isLoadingTasks ? (
						<p className="text-sm text-muted-foreground">加载消息...</p>
					) : null}
					{tasks.length === 0 && !isLoadingTasks ? (
						<div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-border bg-card text-center">
							<div className="max-w-64 px-4">
								<IonIcon
									aria-hidden="true"
									icon={chatbubbleEllipsesOutline}
									className="text-2xl text-muted-foreground"
								/>
								<p className="mt-2 text-sm font-medium text-foreground">还没有消息</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									输入 prompt 后，生成请求和结果会出现在这个会话里。
								</p>
							</div>
						</div>
					) : null}
					{tasks.map((task) => (
						<div key={task.id} className="grid gap-2">
							<div className="ml-auto max-w-[85%] rounded-md bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground">
								{task.prompt}
							</div>
							<div className="mr-auto max-w-[92%] rounded-md border border-border bg-card p-3">
								<div className="mb-2 flex items-center justify-between gap-3">
									<span className="text-sm font-medium text-foreground">
										{task.model || selectedRoute?.model || "生成结果"}
									</span>
									<Badge variant={task.status === "completed" ? "secondary" : "outline"}>
										{statusLabel(task.status)}
									</Badge>
								</div>
								{(task.assets ?? []).length > 0 ? (
									<div className="grid gap-2">
										{(task.assets ?? []).map((asset, index) => {
											const source = assetSource(asset);
											if (!source) return null;
											return asset.kind === "video" ? (
												<video
													key={`${task.id}-${index}`}
													src={source}
													controls
													className="aspect-video w-full rounded-md border border-border bg-muted"
												/>
											) : (
												<img
													key={`${task.id}-${index}`}
													src={source}
													alt=""
													className="max-h-80 w-full rounded-md border border-border bg-muted object-contain"
												/>
											);
										})}
									</div>
								) : (
									<p className="text-sm leading-6 text-muted-foreground">
										{task.error || task.message || statusLabel(task.status)}
									</p>
								)}
							</div>
						</div>
					))}
				</div>
			</IonContent>

			<IonFooter className="generation-session-footer">
				<form
					onSubmit={submit}
					className="mx-auto grid w-full max-w-[34rem] gap-3 bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
				>
					{error ? <p className="text-sm text-error-foreground">{error}</p> : null}
					{selectedRoute ? (
						<p className="text-xs text-muted-foreground">
							当前供应商：{selectedRoute.label || selectedRoute.model}
						</p>
					) : (
						<p className="text-sm text-warning-foreground">
							当前没有可用的{kindLabel(kind)}模型，请先配置 API Key。
						</p>
					)}
					<div className="grid gap-2">
						<Textarea
							value={prompt}
							placeholder={
								kind === "image"
									? "描述图像内容、风格、主体和光线"
									: "描述视频镜头、运动、机位和节奏"
							}
							className="max-h-40 min-h-24"
							onChange={(event) => setPrompt(event.target.value)}
						/>
						<Button
							type="submit"
							disabled={!prompt.trim() || !selectedRoute || !activeConversationId || isSubmitting}
						>
							<IonIcon aria-hidden="true" icon={sparklesOutline} />
							{isSubmitting ? "提交中" : kind === "image" ? "生成图片" : "生成视频"}
						</Button>
					</div>
				</form>
			</IonFooter>

			<IonModal
				isOpen={isHistoryOpen}
				onDidDismiss={() => setIsHistoryOpen(false)}
				initialBreakpoint={0.8}
				breakpoints={[0, 0.8, 1]}
			>
				<IonHeader translucent>
					<IonToolbar>
						<IonTitle>历史会话</IonTitle>
						<IonButtons slot="end">
							<IonButton onClick={() => setIsHistoryOpen(false)}>关闭</IonButton>
						</IonButtons>
					</IonToolbar>
				</IonHeader>
				<IonContent className="app-content">
					<div className="mx-auto grid w-full max-w-[34rem] gap-3 p-4">
						{isLoadingConversations ? (
							<p className="text-sm text-muted-foreground">加载会话...</p>
						) : null}
						{conversations.length === 0 && !isLoadingConversations ? (
							<p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
								暂无历史会话
							</p>
						) : null}
						{conversations.map((conversation) => (
							<button
								key={conversation.id}
								type="button"
								className="rounded-md border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50"
								onClick={() => openConversation(conversation.id)}
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-foreground">
											{conversation.title}
										</p>
										<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
											{conversation.latestPrompt || "暂无 prompt"}
										</p>
									</div>
									<Badge
										variant={
											conversation.id === activeConversationId ? "secondary" : "outline"
										}
									>
										{conversation.taskCount}
									</Badge>
								</div>
								<p className="mt-3 text-xs text-muted-foreground">
									{formatDate(conversation.updatedAt)}
								</p>
							</button>
						))}
					</div>
				</IonContent>
			</IonModal>
		</IonPage>
	);
};

export default GenerationSession;
