import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	GenerationAsset,
	GenerationModelsResponse,
} from "@/domains/generation/api/generation";
import type { MediaAsset, MediaAssetsResponse } from "@/domains/workspace/api/media";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { AudioGenerationDialog } from "@/shared/components/generation-dialogs/AudioGenerationDialog";

const mocks = vi.hoisted(() => ({
	getGenerationModels: vi.fn(),
	getMediaAssets: vi.fn(),
	previewGenerationVoice: vi.fn(),
	uploadMediaAsset: vi.fn(),
}));

vi.mock("@/domains/generation/api/generation", () => ({
	generationModelsKey: "/generation/models",
	getGenerationModels: mocks.getGenerationModels,
	previewGenerationVoice: mocks.previewGenerationVoice,
	projectGenerationConversation: vi.fn(() => null),
}));

vi.mock("@/domains/workspace/api/media", () => ({
	getMediaAssets: mocks.getMediaAssets,
	uploadMediaAsset: mocks.uploadMediaAsset,
}));

const section: MarkdownSectionContext = {
	blockId: "section-audio",
	documentId: "doc-1",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "旁白",
	markdown: "## 旁白\n\n台词。",
	plainText: "旁白\n\n台词。",
	prompt: "台词。",
};

const catalog: GenerationModelsResponse = {
	families: [{ id: "minimax-speech", kind: "audio", label: "MiniMax 国内 Speech" }],
	models: [],
	providers: [],
	routes: [
		{
			adapter: "official.minimax.speech",
			async: false,
			configured: true,
			docUrl: "https://example.test/docs",
			familyId: "minimax-speech",
			id: "official.minimax-speech",
			kind: "audio",
			label: "Minimax Speech",
			model: "speech-2.8-hd",
			params: [
				{
					default: "warm-bestie",
					group: "voice",
					label: "音色",
					name: "voiceId",
					options: [
						{ label: "中文 (普通话) · 温暖闺蜜", value: "warm-bestie" },
						{ label: "中文 (普通话) · 新闻主播", value: "news-anchor" },
						{ label: "英文 · Friendly Narrator", value: "friendly-narrator" },
					],
					type: "select",
				},
			],
			provider: "minimax",
			status: "available",
			supportsReferenceUrls: false,
			versionId: "speech-2.8-hd",
		},
	],
	versions: [
		{
			canonicalModel: "speech-2.8-hd",
			capabilities: { async: false, supportsReferenceUrls: false },
			familyId: "minimax-speech",
			id: "speech-2.8-hd",
			kind: "audio",
			label: "Speech 2.8 HD",
		},
	],
	voicePreviews: [
		{
			mimeType: "audio/mpeg",
			routeId: "official.minimax-speech",
			url: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
			voiceId: "warm-bestie",
		},
		{
			mimeType: "audio/mpeg",
			routeId: "official.minimax-speech",
			url: "/api/v1/generation/voice-previews/official.minimax-speech/news-anchor",
			voiceId: "news-anchor",
		},
		{
			mimeType: "audio/mpeg",
			routeId: "official.minimax-speech",
			url: "/api/v1/generation/voice-previews/official.minimax-speech/friendly-narrator",
			voiceId: "friendly-narrator",
		},
	],
};

const mediaAssets: MediaAssetsResponse = {
	assets: [
		{
			createdAt: "2026-01-01T00:00:00.000Z",
			filename: "用户旁白.mp3",
			id: "audio-1",
			kind: "audio",
			mimeType: "audio/mpeg",
			sizeBytes: 2048,
			updatedAt: "2026-01-01T00:00:00.000Z",
			url: "/api/v1/media-assets/audio-1/content",
		},
	],
};

describe("AudioGenerationDialog", () => {
	beforeEach(() => {
		ensurePointerCaptureMocks();
		mocks.getGenerationModels.mockResolvedValue(catalog);
		mocks.getMediaAssets.mockResolvedValue(mediaAssets);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.unstubAllGlobals();
		window.localStorage.clear();
	});

	it("shows selectable built-in voices instead of the speech generation composer", async () => {
		const onToggleAsset = vi.fn();
		renderAudioDialog({ onToggleAsset });

		expect(await screen.findByRole("dialog", { name: "选择音频素材 · 旁白" })).toBeTruthy();
		expect(
			await screen.findByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }),
		).toBeTruthy();
		await waitFor(() => {
			expect(screen.getByRole("combobox", { name: "语言" }).textContent).toContain("中文 (普通话)");
		});
		expect(screen.queryByRole("button", { name: "选择 英文 · Friendly Narrator" })).toBeNull();
		expect(screen.queryByRole("button", { name: "生成语音" })).toBeNull();
		expect(screen.queryByText("Minimax Speech")).toBeNull();
		expect(screen.getByRole("button", { name: "全部音色" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "我的音色" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /全部音色\s+\d+/u })).toBeNull();
		expect(screen.queryByRole("button", { name: /我的音色\s+\d+/u })).toBeNull();
		const voiceCard = screen.getByRole("button", {
			name: "选择 中文 (普通话) · 温暖闺蜜",
		}).parentElement;
		expect(voiceCard?.className).toContain("min-h-[4.5rem]");
		expect(voiceCard?.className).not.toContain("min-h-24");

		fireEvent.click(screen.getByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }));
		expect(onToggleAsset).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "取消选择 中文 (普通话) · 温暖闺蜜" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "确定" }));

		expect(onToggleAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "audio",
				title: "中文 (普通话) · 温暖闺蜜",
				url: "/api/v1/generation/voice-previews/official.minimax-speech/warm-bestie",
			}),
			true,
		);
	});

	it("does not persist a draft voice selection when cancelling", async () => {
		const onOpenChange = vi.fn();
		const onToggleAsset = vi.fn();
		renderAudioDialog({ onOpenChange, onToggleAsset });

		expect(
			await screen.findByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }));
		fireEvent.click(screen.getByRole("button", { name: "取消" }));

		expect(onToggleAsset).not.toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("isolates cancel and confirm pointerdown from lower dialogs", async () => {
		renderAudioDialog();
		await screen.findByRole("dialog", { name: "选择音频素材 · 旁白" });
		const documentPointerDown = vi.fn();
		document.addEventListener("pointerdown", documentPointerDown);

		fireEvent.pointerDown(screen.getByRole("button", { name: "取消" }), { button: 0 });
		fireEvent.pointerDown(screen.getByRole("button", { name: "确定" }), { button: 0 });
		document.removeEventListener("pointerdown", documentPointerDown);

		expect(documentPointerDown).not.toHaveBeenCalled();
	});

	it("switches to user audio assets from the material library button", async () => {
		const onToggleAsset = vi.fn();
		renderAudioDialog({ onToggleAsset });

		fireEvent.click(screen.getByRole("button", { name: "从素材库中选择" }));
		expect(await screen.findByRole("dialog", { name: "从素材库中选择" })).toBeTruthy();
		const userAudioCheckbox = await screen.findByRole("checkbox", { name: /用户旁白\.mp3/ });
		expect(userAudioCheckbox).toBeTruthy();

		fireEvent.click(userAudioCheckbox);
		fireEvent.click(screen.getByRole("button", { name: "选择音频" }));
		expect(onToggleAsset).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "确定" }));

		expect(onToggleAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "audio",
				title: "用户旁白",
				url: "/api/v1/media-assets/audio-1/content",
			}),
			true,
		);
	});

	it("uploads an audio material from the material library dialog", async () => {
		const uploadedAsset: MediaAsset = {
			createdAt: "2026-01-02T00:00:00.000Z",
			filename: "上传旁白.mp3",
			id: "uploaded-audio",
			kind: "audio",
			mimeType: "audio/mpeg",
			sizeBytes: 4096,
			updatedAt: "2026-01-02T00:00:00.000Z",
			url: "/api/v1/media-assets/uploaded-audio/content",
		};
		const onToggleAsset = vi.fn();
		mocks.uploadMediaAsset.mockResolvedValue(uploadedAsset);
		renderAudioDialog({ onToggleAsset });

		fireEvent.click(screen.getByRole("button", { name: "从素材库中选择" }));
		expect(await screen.findByRole("dialog", { name: "从素材库中选择" })).toBeTruthy();
		const file = new File(["audio"], "上传旁白.mp3", { type: "audio/mpeg" });
		fireEvent.change(screen.getByLabelText("上传音频素材"), {
			target: { files: [file] },
		});

		await waitFor(() => {
			expect(mocks.uploadMediaAsset).toHaveBeenCalledWith(file, "project-a");
		});
		expect(await screen.findByText("上传旁白.mp3")).toBeTruthy();
		expect(
			screen.getByRole("checkbox", { name: /上传旁白\.mp3/ }).getAttribute("aria-checked"),
		).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "选择音频" }));
		expect(onToggleAsset).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "确定" }));

		expect(onToggleAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "audio",
				title: "上传旁白",
				url: "/api/v1/media-assets/uploaded-audio/content",
			}),
			true,
		);
	});

	it("stops the current audio preview when switching tabs", async () => {
		const play = vi.fn().mockResolvedValue(undefined);
		const pause = vi.fn();
		const AudioMock = vi.fn(function MockAudio() {
			return { onended: null, pause, play };
		});
		vi.stubGlobal("Audio", AudioMock);
		Object.defineProperty(window, "Audio", {
			configurable: true,
			value: AudioMock,
		});
		renderAudioDialog();

		fireEvent.click(screen.getByRole("button", { name: /我的音色/u }));
		fireEvent.click(await screen.findByRole("button", { name: "播放 用户旁白" }));
		await waitFor(() => {
			expect(play).toHaveBeenCalled();
		});

		fireEvent.click(screen.getByRole("button", { name: /全部音色/u }));

		expect(pause).toHaveBeenCalled();
	});

	it("does not render a large empty state when user audio assets are empty", async () => {
		mocks.getMediaAssets.mockResolvedValue({ assets: [] });
		renderAudioDialog();

		fireEvent.click(screen.getByRole("button", { name: "从素材库中选择" }));

		await waitFor(() => {
			expect(mocks.getMediaAssets).toHaveBeenCalled();
		});
		expect(screen.queryByText("素材库里暂无音频素材")).toBeNull();
		expect(screen.queryByRole("button", { name: "选择 用户旁白" })).toBeNull();
	});

	it("keeps built-in voice favorites available in the selection panel", async () => {
		renderAudioDialog();

		expect(
			await screen.findByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "收藏 温暖闺蜜" }));
		fireEvent.click(screen.getByRole("button", { name: "收藏" }));

		expect(screen.getByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "选择 中文 (普通话) · 新闻主播" })).toBeNull();
	});

	it("reveals an unfavorited voice star only from its own card hover group", async () => {
		renderAudioDialog();

		expect(
			await screen.findByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }),
		).toBeTruthy();
		const favoriteButton = screen.getByRole("button", { name: "收藏 温暖闺蜜" });

		expect(favoriteButton.className).toContain("opacity-0");
		expect(favoriteButton.className).toContain("group-hover/voice-card:opacity-100");
		expect(favoriteButton.className).not.toContain(" group-hover:opacity-100");
		expect(favoriteButton.closest('[class*="group/voice-card"]')).toBeTruthy();

		fireEvent.click(favoriteButton);

		expect(screen.getByRole("button", { name: "取消收藏 温暖闺蜜" }).className).toContain(
			"opacity-100",
		);
	});

	it("does not render a large empty state when favorite voices are empty", async () => {
		renderAudioDialog();

		expect(
			await screen.findByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "收藏" }));

		expect(screen.queryByText("暂无收藏音色")).toBeNull();
		expect(screen.queryByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" })).toBeNull();
	});

	it("keeps built-in voice type filters available in the selection panel", async () => {
		renderAudioDialog();

		expect(
			await screen.findByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" }),
		).toBeTruthy();
		fireEvent.pointerDown(screen.getByRole("combobox", { name: "类型" }), {
			button: 0,
			ctrlKey: false,
			pageX: 0,
			pageY: 0,
			pointerId: 1,
			pointerType: "mouse",
		});
		fireEvent.click(await screen.findByRole("option", { name: "播报" }));

		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "选择 中文 (普通话) · 温暖闺蜜" })).toBeNull();
		});
		expect(screen.getByRole("button", { name: "选择 中文 (普通话) · 新闻主播" })).toBeTruthy();
	});
});

const renderAudioDialog = ({
	onOpenChange = vi.fn(),
	onToggleAsset = vi.fn(),
}: {
	onOpenChange?: (open: boolean) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
} = {}) =>
	render(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<AudioGenerationDialog
				open
				projectId="project-a"
				section={section}
				onOpenChange={onOpenChange}
				onToggleAsset={onToggleAsset}
			/>
		</SWRConfig>,
	);

const ensurePointerCaptureMocks = () => {
	const pointerCaptureMethods = {
		hasPointerCapture: () => false,
		releasePointerCapture: () => undefined,
		setPointerCapture: () => undefined,
		scrollIntoView: () => undefined,
	};

	for (const [methodName, implementation] of Object.entries(pointerCaptureMethods)) {
		if (methodName in HTMLElement.prototype) continue;
		Object.defineProperty(HTMLElement.prototype, methodName, {
			configurable: true,
			value: implementation,
		});
	}
};
