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
	videoDialogProps: null as null | DialogProps,
}));

interface DialogProps {
	onGenerationComplete?: (pendingId: string, assets: unknown[], sourceTaskId: string) => void;
	onGenerationError?: (pendingId: string) => void;
	onGenerationStart?: (pendingId: string, prompt: string) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	open: boolean;
	projectId?: string;
	resolveLatestSection?: boolean;
	section: MarkdownSectionContext | null;
}

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
