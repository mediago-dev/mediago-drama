import type { GenerationAsset, GenerationKind } from "@/domains/generation/api/generation";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	kind: GenerationKind;
	status?: string;
	assets?: GenerationAsset[];
	createdAt?: string;
	deletedAssetSlots?: number[];
	details?: ChatMessageDetail[];
	durationMs?: number;
	error?: string;
	errorCode?: string;
	errorType?: string;
	retryable?: boolean;
	updatedAt?: string;
}

export interface ChatMessageDetail {
	label: string;
	value: string;
}

export interface GenerationEntry {
	assistantMessage?: ChatMessage;
	content: string;
	createdAt?: string;
	deletedAssetSlots?: number[];
	durationMs?: number;
	id: string;
	kind: GenerationKind;
	prompt: string;
	requestAssets?: GenerationAsset[];
	requestDetails?: ChatMessageDetail[];
	resultDetails?: ChatMessageDetail[];
	status?: string;
	assets?: GenerationAsset[];
	error?: string;
	errorCode?: string;
	errorType?: string;
	retryable?: boolean;
	updatedAt?: string;
}
