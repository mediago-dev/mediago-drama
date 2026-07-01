import type React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { useGenerationNotificationStore } from "@/domains/generation/stores/generation-notifications";
import { useMediaGenerationStore } from "@/domains/generation/stores/media-generation";
import { MediaGenerationDialogHost } from "./MediaGenerationDialogHost";

const testState = vi.hoisted(() => ({
	audioDialogProps: null as null | DialogProps,
	imageDialogProps: null as null | DialogProps,
	mutateSelectedGenerationAssets: vi.fn(async () => undefined),
	selectedGenerationAssets: [] as Array<Record<string, unknown>>,
	updateSelectedGenerationAsset: vi.fn(async () => ({ success: true })),
	videoDialogProps: null as null | DialogProps,
}));

interface DialogProps {
	onCommitAssetSelection?: (asset: Record<string, unknown> | null) => void | Promise<void>;
	onGenerationComplete?: (pendingId: string, assets: unknown[], sourceTaskId: string) => void;
	onGenerationError?: (pendingId: string) => void;
	onGenerationStart?: (pendingId: string, prompt: string) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	onToggleAsset?: (asset: Record<string, unknown>, selected: boolean) => void | Promise<void>;
	open: boolean;
	projectId?: string;
	resolveLatestSection?: boolean;
	selectedAssetKeys?: string[];
	section: MarkdownSectionContext | null;
}

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();
	return {
		...actual,
		updateSelectedGenerationAsset: testState.updateSelectedGenerationAsset,
	};
});

vi.mock("@/domains/generation/hooks/useSelectedGenerationAssets", () => ({
	useSelectedGenerationAssets: () => ({
		assets: testState.selectedGenerationAssets,
		mutate: testState.mutateSelectedGenerationAssets,
	}),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
	}),
}));

vi.mock("@/shared/components/generation-dialogs/ImageGenerationDialog", () => ({
	ImageGenerationDialog: (props: DialogProps) => {
		testState.imageDialogProps = props;
		return <div data-open={props.open ? "true" : "false"} data-testid="image-dialog" />;
	},
}));

vi.mock("@/shared/components/generation-dialogs/VideoGenerationDialog", () => ({
	VideoGenerationDialog: (props: DialogProps) => {
		testState.videoDialogProps = props;
		return <div data-open={props.open ? "true" : "false"} data-testid="video-dialog" />;
	},
}));

vi.mock("@/shared/components/generation-dialogs/AudioGenerationDialog", () => ({
	AudioGenerationDialog: (props: DialogProps) => {
		testState.audioDialogProps = props;
		return <div data-open={props.open ? "true" : "false"} data-testid="audio-dialog" />;
	},
}));

const section: MarkdownSectionContext = {
	blockId: "section_visual",
	documentId: "story-doc",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "画面",
	markdown: "## 画面\n\n画面提示词。",
	plainText: "画面\n\n画面提示词。",
	prompt: "画面提示词。",
};

describe("MediaGenerationDialogHost", () => {
	afterEach(() => {
		cleanup();
		useGenerationNotificationStore.getState().clearNotifications();
		useMediaGenerationStore.setState({ activeRequest: null, optimisticStatuses: {} });
		testState.audioDialogProps = null;
		testState.imageDialogProps = null;
		testState.mutateSelectedGenerationAssets.mockClear();
		testState.selectedGenerationAssets = [];
		testState.updateSelectedGenerationAsset.mockClear();
		testState.videoDialogProps = null;
	});

	it("opens image notifications without changing the current route", async () => {
		const notification = addNotification();
		useGenerationNotificationStore.getState().requestOpenNotification(notification.id);

		renderHost("/toolbox/image?conversation=studio-1");

		await waitFor(() => expect(testState.imageDialogProps?.open).toBe(true));
		expect(testState.imageDialogProps).toMatchObject({
			projectId: "project-a",
			resolveLatestSection: false,
			section: { blockId: "section_visual", documentId: "story-doc" },
		});
		expect(useGenerationNotificationStore.getState().pendingOpenRequest).toBeNull();
		expect(screen.getByTestId("location").getAttribute("data-path")).toBe(
			"/toolbox/image?conversation=studio-1",
		);
	});

	it("opens video notifications through the global dialog host", async () => {
		const notification = addNotification({ kind: "video" });
		useGenerationNotificationStore.getState().requestOpenNotification(notification.id);

		renderHost("/projects?projectId=current-project");

		await waitFor(() => expect(testState.videoDialogProps?.open).toBe(true));
		expect(testState.videoDialogProps).toMatchObject({
			projectId: "project-a",
			resolveLatestSection: false,
			section: { blockId: "section_visual", documentId: "story-doc" },
		});
		expect(testState.imageDialogProps?.open).toBe(false);
	});

	it("opens audio notifications through the global dialog host", async () => {
		const notification = addNotification({ kind: "audio" });
		useGenerationNotificationStore.getState().requestOpenNotification(notification.id);

		renderHost("/settings");

		await waitFor(() => expect(testState.audioDialogProps?.open).toBe(true));
		expect(testState.audioDialogProps).toMatchObject({
			projectId: "project-a",
			resolveLatestSection: false,
			section: { blockId: "section_visual", documentId: "story-doc" },
		});
	});

	it("persists audio asset selections for the active document resource", async () => {
		testState.selectedGenerationAssets = [
			{
				assetIndex: 0,
				id: "selected-audio",
				kind: "audio",
				mimeType: "audio/mpeg",
				resourceId: "section_visual",
				resourceType: "character",
				sourceDocumentId: "story-doc",
				title: "画面音色",
				url: "/api/v1/media-assets/audio-1/content",
			},
		];
		useMediaGenerationStore.getState().open({
			kind: "audio",
			projectId: "project-a",
			section,
			selectedAssetResourceType: "character",
		});

		renderHost("/projects?projectId=project-a");

		await waitFor(() => expect(testState.audioDialogProps?.open).toBe(true));
		expect(testState.audioDialogProps?.selectedAssetKeys).toEqual([
			"audio:/api/v1/media-assets/audio-1/content",
		]);

		await act(async () => {
			await testState.audioDialogProps?.onCommitAssetSelection?.({
				kind: "audio",
				mimeType: "audio/mpeg",
				title: "新音色",
				url: "/api/v1/media-assets/audio-2/content",
			});
		});

		expect(testState.updateSelectedGenerationAsset).toHaveBeenCalledWith("project-a", {
			assetIndex: 0,
			base64: undefined,
			kind: "audio",
			mimeType: "audio/mpeg",
			resourceId: "section_visual",
			resourceTitle: "画面",
			resourceType: "character",
			selected: true,
			sourceAssetIndex: 0,
			sourceDocumentId: "story-doc",
			sourceKey: "/api/v1/media-assets/audio-2/content",
			title: "新音色",
			url: "/api/v1/media-assets/audio-2/content",
		});
		expect(testState.mutateSelectedGenerationAssets).toHaveBeenCalled();
	});

	it("marks built-in voice preview selections as imported audio assets", async () => {
		useMediaGenerationStore.getState().open({
			kind: "audio",
			projectId: "project-a",
			section,
			selectedAssetResourceType: "character",
		});

		renderHost("/projects?projectId=project-a");

		await waitFor(() => expect(testState.audioDialogProps?.open).toBe(true));
		await act(async () => {
			await testState.audioDialogProps?.onCommitAssetSelection?.({
				kind: "audio",
				mimeType: "audio/mpeg",
				sourceType: "imported",
				title: "中文 (普通话) · 温暖闺蜜",
				url: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
			});
		});

		expect(testState.updateSelectedGenerationAsset).toHaveBeenCalledWith("project-a", {
			assetIndex: 0,
			base64: undefined,
			kind: "audio",
			mimeType: "audio/mpeg",
			resourceId: "section_visual",
			resourceTitle: "画面",
			resourceType: "character",
			selected: true,
			sourceAssetIndex: 0,
			sourceDocumentId: "story-doc",
			sourceKey: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
			sourceType: "imported",
			title: "中文 (普通话) · 温暖闺蜜",
			url: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
		});
		expect(testState.mutateSelectedGenerationAssets).toHaveBeenCalled();
	});

	it("clears the current audio selection when confirming an empty draft", async () => {
		testState.selectedGenerationAssets = [
			{
				assetIndex: 0,
				id: "selected-audio",
				kind: "audio",
				mediaAssetId: "media-preview-voice",
				mimeType: "audio/mpeg",
				resourceId: "section_visual",
				resourceType: "character",
				sourceDocumentId: "story-doc",
				sourceKey: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
				sourceType: "imported",
				title: "中文 (普通话) · 温暖闺蜜",
				url: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
			},
		];
		useMediaGenerationStore.getState().open({
			kind: "audio",
			projectId: "project-a",
			section,
			selectedAssetResourceType: "character",
		});

		renderHost("/projects?projectId=project-a");

		await waitFor(() => expect(testState.audioDialogProps?.open).toBe(true));
		await act(async () => {
			await testState.audioDialogProps?.onCommitAssetSelection?.(null);
		});

		expect(testState.updateSelectedGenerationAsset).toHaveBeenCalledWith("project-a", {
			assetIndex: 0,
			base64: undefined,
			kind: "audio",
			mediaAssetId: "media-preview-voice",
			mimeType: "audio/mpeg",
			resourceId: "section_visual",
			resourceTitle: "画面",
			resourceType: "character",
			selected: false,
			sourceAssetIndex: 0,
			sourceDocumentId: "story-doc",
			sourceKey: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
			sourceTaskId: undefined,
			sourceType: "imported",
			title: "中文 (普通话) · 温暖闺蜜",
			url: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
		});
		expect(testState.mutateSelectedGenerationAssets).toHaveBeenCalled();
	});

	it("marks the status resource generating on start and clears it on complete", () => {
		useMediaGenerationStore
			.getState()
			.open({ kind: "image", projectId: "project-a", section, statusResourceKey: "res-x" });

		renderHost("/projects?projectId=project-a");

		act(() => testState.imageDialogProps?.onGenerationStart?.("pending-1", "prompt"));
		expect(useMediaGenerationStore.getState().optimisticStatuses["res-x"]?.kind).toBe("pending");

		act(() => testState.imageDialogProps?.onGenerationComplete?.("pending-1", [], "task-1"));
		expect(useMediaGenerationStore.getState().optimisticStatuses["res-x"]).toBeUndefined();
	});

	it("marks the status resource failed on generation error", () => {
		useMediaGenerationStore
			.getState()
			.open({ kind: "video", projectId: "project-a", section, statusResourceKey: "res-y" });

		renderHost("/projects?projectId=project-a");

		act(() => testState.videoDialogProps?.onGenerationError?.("pending-1"));
		expect(useMediaGenerationStore.getState().optimisticStatuses["res-y"]?.kind).toBe("failed");
	});
});

const renderHost = (initialRoute: string) =>
	render(
		<MemoryRouter initialEntries={[initialRoute]}>
			<LocationProbe />
			<MediaGenerationDialogHost />
		</MemoryRouter>,
	);

const LocationProbe: React.FC = () => {
	const location = useLocation();
	return <div data-path={`${location.pathname}${location.search}`} data-testid="location" />;
};

const addNotification = (
	overrides: {
		kind?: "audio" | "image" | "video";
	} = {},
) =>
	useGenerationNotificationStore.getState().addNotification({
		assetCount: 1,
		kind: overrides.kind,
		sourceTaskId: `task-${overrides.kind ?? "image"}`,
		target: {
			kind: "document-section",
			documentId: "story-doc",
			documentTitle: "第一集",
			projectId: "project-a",
			section,
		},
	});
