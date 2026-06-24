import type React from "react";
import { useCallback, useState } from "react";
import type { KeyedMutator } from "swr";
import { mutate as mutateSWR } from "swr";
import type { MediaAsset, MediaAssetsResponse } from "@/domains/workspace/api/media";
import type {
	GenerationFamily,
	GenerationKind,
	GenerationMessageRequest,
	GenerationMessageResponse,
	GenerationNotificationOpenTarget,
	GenerationRoute,
	GenerationTasksResponse,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import {
	createGenerationConversation,
	generationConversationsQueryKey,
	sendGenerationMessage,
	streamGenerationText,
} from "@/domains/generation/api/generation";
import type { GenerationTaskType } from "@/domains/generation/lib/prompt-categories";
import {
	generationParamsWithRequestDetails,
	generatedAssetsIncludeMediaAssets,
	messageFromResponse,
	notifySubmitCallback,
	promptWithExtraContext,
	referenceAssetsFromInputs,
	resolveGenerationExtraValue,
	userMessageID,
	userRequestDetails,
	assistantGenerationDetails,
	type ChatMessage,
	type ChatMessageDetail,
	type GenerationExtraValue,
} from "./useGenerationWorkspace.helpers";

export interface GenerationSubmitStartEvent {
	kind: GenerationKind;
	localMessageId: string;
	prompt: string;
}

export interface GenerationSubmitResponseEvent {
	kind: GenerationKind;
	localMessageId: string;
	response: GenerationMessageResponse;
}

export interface GenerationSubmitFailureEvent {
	kind: GenerationKind;
	localMessageId: string;
	message: string;
}

export interface GenerationSubmitOverrides {
	assetTitle?: string | null;
	documentContext?: GenerationMessageRequest["documentContext"] | null;
	extraPrompt?: string;
	notificationTarget?: GenerationNotificationOpenTarget | null;
	prompt?: string;
	requestDetails?: ChatMessageDetail[];
	referenceAssetIds?: string[];
	referenceUrls?: string[];
	resetPrompt?: boolean;
	sectionId?: string | null;
	taskType?: GenerationTaskType;
}

export const generationRequestPrompt = ({
	extraPrompt,
	prompt,
	useRawPrompt = false,
}: {
	extraPrompt: string;
	prompt: string;
	useRawPrompt?: boolean;
}) => {
	if (useRawPrompt) return prompt;
	return promptWithExtraContext(prompt, extraPrompt);
};

interface UseGenerationSubmitOptions {
	assetTitle?: string | null;
	conversationId?: string | null;
	effectiveReferenceAssetIds: string[];
	effectiveReferenceUrls: string[];
	documentContext?: GenerationMessageRequest["documentContext"] | null;
	documentContextInitialPrompt?: string;
	extraPrompt: GenerationExtraValue<string>;
	mediaAssetProjectId: string;
	mediaAssets: MediaAsset[];
	mutateMediaAssets: KeyedMutator<MediaAssetsResponse>;
	mutateProjectGenerationTasks: (kind: GenerationKind) => void;
	mutateTasks: KeyedMutator<GenerationTasksResponse>;
	notificationTarget?: GenerationNotificationOpenTarget | null;
	conversationTitle?: string | null;
	onSubmitError?: (message: string) => void;
	onSubmitFailure?: (event: GenerationSubmitFailureEvent) => void;
	onSubmitResponse?: (event: GenerationSubmitResponseEvent) => void;
	onSubmitStart?: (event: GenerationSubmitStartEvent) => void;
	onSubmitSuccess?: (kind: GenerationKind) => void;
	rememberSelectedModel?: () => void;
	prompt: string;
	promptRef?: React.MutableRefObject<string>;
	requireConversation?: boolean;
	resolvedConversationScopeId?: string;
	sectionId?: string;
	taskType?: GenerationTaskType;
	selectedFamily: GenerationFamily;
	selectedParams: Record<string, unknown>;
	selectedRoute: GenerationRoute;
	selectedVersion: GenerationVersion;
	setActiveEntryId: (next: React.SetStateAction<string | null>) => void;
	setError: (message: string | null) => void;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setPrompt: React.Dispatch<React.SetStateAction<string>>;
	useRawPrompt?: boolean;
}

export const useGenerationSubmit = ({
	conversationId,
	conversationTitle,
	documentContext,
	documentContextInitialPrompt,
	effectiveReferenceAssetIds,
	effectiveReferenceUrls,
	extraPrompt,
	mediaAssetProjectId,
	mediaAssets,
	mutateMediaAssets,
	mutateProjectGenerationTasks,
	mutateTasks,
	notificationTarget,
	onSubmitError,
	onSubmitFailure,
	onSubmitResponse,
	onSubmitStart,
	onSubmitSuccess,
	rememberSelectedModel,
	prompt,
	promptRef,
	requireConversation = false,
	resolvedConversationScopeId,
	sectionId,
	taskType = "studio",
	selectedFamily,
	selectedParams,
	selectedRoute,
	selectedVersion,
	setActiveEntryId,
	setError,
	setMessages,
	setPrompt,
	useRawPrompt = false,
	assetTitle,
}: UseGenerationSubmitOptions) => {
	const [activeSubmitCount, setActiveSubmitCount] = useState(0);
	const isSubmitting = activeSubmitCount > 0;

	const submitGeneration = useCallback(
		async (overrides: GenerationSubmitOverrides = {}) => {
			const promptInput = overrides.prompt ?? promptRef?.current ?? prompt;
			const nextPrompt = promptInput.trim();
			const requestReferenceAssetIds = overrides.referenceAssetIds ?? effectiveReferenceAssetIds;
			const requestReferenceUrls = overrides.referenceUrls ?? effectiveReferenceUrls;
			const requestNotificationTarget = overrides.notificationTarget ?? notificationTarget;
			const requestSectionId = overrides.sectionId ?? sectionId;
			const requestTaskType = overrides.taskType ?? taskType;
			const requestDocumentContext = overrides.documentContext ?? documentContext;
			const requestAssetTitle = (overrides.assetTitle ?? assetTitle)?.trim() ?? "";
			const requestDocumentId = requestDocumentContext?.documentId?.trim() ?? "";
			const shouldResolvePromptFromDocumentContext =
				Boolean(requestDocumentContext) &&
				useRawPrompt &&
				overrides.prompt === undefined &&
				(documentContextInitialPrompt ?? "").trim() !== "" &&
				nextPrompt === (documentContextInitialPrompt ?? "").trim();
			if (requireConversation && !conversationId?.trim()) {
				const message = "请先从左侧新建或选择一个 session。";
				setError(message);
				notifySubmitCallback(onSubmitError, message);
				return;
			}
			if (
				(!nextPrompt && !requestDocumentContext) ||
				selectedRoute.status !== "available" ||
				!selectedRoute.configured
			) {
				return;
			}

			setError(null);
			setActiveSubmitCount((count) => count + 1);
			const requestKind = selectedRoute.kind;
			if (requestKind === "image" || requestKind === "video" || requestKind === "audio") {
				try {
					rememberSelectedModel?.();
				} catch {
					// Remembering a preference must not block the generation request.
				}
			}
			const requestExtraPrompt = useRawPrompt
				? ""
				: (overrides.extraPrompt ?? resolveGenerationExtraValue(extraPrompt, nextPrompt));
			const displayPrompt = generationRequestPrompt({
				extraPrompt: requestExtraPrompt,
				prompt: useRawPrompt ? promptInput : nextPrompt,
				useRawPrompt,
			});
			const requestPrompt = shouldResolvePromptFromDocumentContext ? "" : displayPrompt;
			const localID = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const submittedAt = new Date();
			const submittedAtValue = submittedAt.toISOString();
			const requestReferences = selectedRoute.supportsReferenceUrls
				? referenceAssetsFromInputs(requestReferenceUrls, requestReferenceAssetIds, mediaAssets)
				: [];
			const requestDetails = [
				...(overrides.requestDetails ?? []),
				...userRequestDetails(selectedRoute, selectedParams),
			];
			const requestParams = generationParamsWithRequestDetails(
				selectedParams,
				overrides.requestDetails,
			);
			const userMessage: ChatMessage = {
				id: `${localID}:prompt`,
				role: "user",
				kind: requestKind,
				content: displayPrompt,
				assets: requestReferences,
				createdAt: submittedAtValue,
				details: requestDetails,
				updatedAt: submittedAtValue,
			};
			const loadingMessage: ChatMessage = {
				id: `${localID}:assistant`,
				role: "assistant",
				kind: requestKind,
				status: requestKind === "text" ? "streaming" : "loading",
				content:
					requestKind === "image"
						? "正在生成图像..."
						: requestKind === "text"
							? ""
							: requestKind === "audio"
								? "正在生成音频..."
								: "正在提交视频任务...",
				createdAt: submittedAtValue,
				updatedAt: submittedAtValue,
			};
			setMessages((current) => [...current, userMessage, loadingMessage]);
			setActiveEntryId(loadingMessage.id);
			notifySubmitCallback(onSubmitStart, {
				kind: requestKind,
				localMessageId: loadingMessage.id,
				prompt: displayPrompt,
			});
			if (overrides.resetPrompt ?? true) setPrompt("");
			let activeAssistantMessageId = loadingMessage.id;

			try {
				await ensureGenerationConversation({
					conversationId,
					kind: requestKind,
					scopeId: resolvedConversationScopeId,
					title: conversationTitle,
				});
				if (requestKind === "text") {
					const response = await streamGenerationText(
						{
							kind: requestKind,
							conversationId: conversationId ?? undefined,
							scopeId: resolvedConversationScopeId,
							projectId: mediaAssetProjectId || undefined,
							documentId: requestDocumentId || undefined,
							sectionId: requestSectionId || undefined,
							documentContext: requestDocumentContext ?? undefined,
							capabilityId: requestTaskType,
							notificationTarget: requestNotificationTarget ?? undefined,
							routeId: selectedRoute.id,
							familyId: selectedFamily.id,
							versionId: selectedVersion.id,
							provider: selectedRoute.provider,
							modelId: selectedRoute.legacyModelId ?? "",
							model: selectedRoute.model,
							prompt: requestPrompt,
							assetTitle: requestAssetTitle || undefined,
							params: requestParams,
							referenceUrls: [],
							referenceAssetIds: [],
						},
						{
							onStart: (event) => {
								const taskId = event.taskId || activeAssistantMessageId;
								activeAssistantMessageId = taskId;
								setActiveEntryId(taskId);
								setMessages((current) =>
									current.map((message) => {
										if (message.id === userMessage.id) {
											return { ...message, id: userMessageID(taskId) };
										}
										if (message.id === loadingMessage.id) {
											return {
												...message,
												id: taskId,
												status: event.status || "streaming",
												content: event.message?.text ?? "",
											};
										}
										return message;
									}),
								);
							},
							onDelta: (delta) => {
								setMessages((current) =>
									current.map((message) =>
										message.id === activeAssistantMessageId || message.id === loadingMessage.id
											? {
													...message,
													id: activeAssistantMessageId,
													status: "streaming",
													content: `${message.content}${delta}`,
												}
											: message,
									),
								);
							},
							onDone: (message) => {
								setActiveEntryId(message.id);
								setMessages((current) =>
									current.map((currentMessage) =>
										currentMessage.id === activeAssistantMessageId ||
										currentMessage.id === loadingMessage.id
											? messageFromResponse(message, "text")
											: currentMessage.id === userMessage.id
												? { ...currentMessage, id: userMessageID(message.id) }
												: currentMessage,
									),
								);
							},
							onError: (message) => {
								setError(message);
							},
						},
					);
					notifySubmitCallback(onSubmitResponse, {
						kind: requestKind,
						localMessageId: loadingMessage.id,
						response,
					});
					void mutateTasks();
					mutateProjectGenerationTasks(requestKind);
					void mutateSWR(generationConversationsQueryKey(requestKind, resolvedConversationScopeId));
					void mutateSWR(generationConversationsQueryKey(requestKind, "", { allScopes: true }));
					notifySubmitCallback(onSubmitSuccess, requestKind);
					return;
				}

				const response = await sendGenerationMessage({
					kind: requestKind,
					conversationId: conversationId ?? undefined,
					scopeId: resolvedConversationScopeId,
					projectId: mediaAssetProjectId || undefined,
					documentId: requestDocumentId || undefined,
					sectionId: requestSectionId || undefined,
					documentContext: requestDocumentContext ?? undefined,
					capabilityId: requestTaskType,
					notificationTarget: requestNotificationTarget ?? undefined,
					routeId: selectedRoute.id,
					familyId: selectedFamily.id,
					versionId: selectedVersion.id,
					provider: selectedRoute.provider,
					modelId: selectedRoute.legacyModelId ?? "",
					model: selectedRoute.model,
					prompt: requestPrompt,
					assetTitle: requestAssetTitle || undefined,
					params: requestParams,
					referenceUrls: selectedRoute.supportsReferenceUrls ? requestReferenceUrls : [],
					referenceAssetIds: selectedRoute.supportsReferenceUrls ? requestReferenceAssetIds : [],
				});
				const persistedUserMessage: ChatMessage = {
					...userMessage,
					id: userMessageID(response.id),
				};
				const finishedAtValue = new Date().toISOString();
				const durationMs = Math.max(0, Date.parse(finishedAtValue) - submittedAt.getTime());
				const assistantMessage = {
					...messageFromResponse(response, requestKind),
					createdAt: submittedAtValue,
					details: assistantGenerationDetails({
						createdAt: submittedAtValue,
						durationMs,
						status: response.status,
					}),
					durationMs,
					updatedAt: finishedAtValue,
				};
				setActiveEntryId(response.id);
				notifySubmitCallback(onSubmitResponse, {
					kind: requestKind,
					localMessageId: loadingMessage.id,
					response,
				});
				setMessages((current) =>
					current.map((message) => {
						if (message.id === userMessage.id) return persistedUserMessage;
						if (message.id === loadingMessage.id) return assistantMessage;
						return message;
					}),
				);
				void mutateTasks();
				mutateProjectGenerationTasks(requestKind);
				void mutateSWR(generationConversationsQueryKey(requestKind, resolvedConversationScopeId));
				void mutateSWR(generationConversationsQueryKey(requestKind, "", { allScopes: true }));
				if (generatedAssetsIncludeMediaAssets(response.assets)) {
					void mutateMediaAssets();
				}
				notifySubmitCallback(onSubmitSuccess, requestKind);
			} catch (err) {
				const message = err instanceof Error ? err.message : "生成请求失败。";
				const errorMessageId = `${localID}:error`;
				const hasPersistedAssistantMessage = activeAssistantMessageId !== loadingMessage.id;
				const failedAssistantMessageId = hasPersistedAssistantMessage
					? activeAssistantMessageId
					: errorMessageId;
				const failedAtValue = new Date().toISOString();
				const durationMs = Math.max(0, Date.parse(failedAtValue) - submittedAt.getTime());
				setError(message);
				notifySubmitCallback(onSubmitError, message);
				notifySubmitCallback(onSubmitFailure, {
					kind: requestKind,
					localMessageId: loadingMessage.id,
					message,
				});
				void mutateTasks();
				mutateProjectGenerationTasks(requestKind);
				setActiveEntryId(failedAssistantMessageId);
				setMessages((current) =>
					current.map((currentMessage) =>
						currentMessage.id === loadingMessage.id ||
						currentMessage.id === activeAssistantMessageId
							? {
									id: failedAssistantMessageId,
									role: "assistant",
									kind: requestKind,
									status: "error",
									content: message,
									createdAt: submittedAtValue,
									details: assistantGenerationDetails({
										createdAt: submittedAtValue,
										durationMs,
										status: "error",
									}),
									durationMs,
									updatedAt: failedAtValue,
								}
							: currentMessage,
					),
				);
			} finally {
				setActiveSubmitCount((count) => Math.max(0, count - 1));
			}
		},
		[
			assetTitle,
			conversationId,
			conversationTitle,
			documentContext,
			documentContextInitialPrompt,
			effectiveReferenceAssetIds,
			effectiveReferenceUrls,
			extraPrompt,
			mediaAssetProjectId,
			mediaAssets,
			mutateMediaAssets,
			mutateProjectGenerationTasks,
			mutateTasks,
			notificationTarget,
			onSubmitError,
			onSubmitFailure,
			onSubmitResponse,
			onSubmitStart,
			onSubmitSuccess,
			rememberSelectedModel,
			prompt,
			promptRef,
			requireConversation,
			resolvedConversationScopeId,
			sectionId,
			taskType,
			selectedFamily.id,
			selectedParams,
			selectedRoute,
			selectedVersion.id,
			setActiveEntryId,
			setError,
			setMessages,
			setPrompt,
			useRawPrompt,
		],
	);

	const submit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			await submitGeneration();
		},
		[submitGeneration],
	);

	return {
		isSubmitting,
		submit,
		submitGeneration,
	};
};

const ensureGenerationConversation = async ({
	conversationId,
	kind,
	scopeId,
	title,
}: {
	conversationId?: string | null;
	kind: GenerationKind;
	scopeId?: string | null;
	title?: string | null;
}) => {
	const id = conversationId?.trim();
	const conversationTitle = title?.trim();
	if (!id || !scopeId?.trim() || !conversationTitle) return;

	await createGenerationConversation({
		id,
		kind,
		scopeId: scopeId.trim(),
		title: conversationTitle,
	});
};
