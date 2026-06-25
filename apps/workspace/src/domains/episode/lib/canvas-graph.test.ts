import { describe, expect, it } from "vitest";
import {
	buildEpisodeCanvasGraph,
	focusEpisodeCanvasGraph,
} from "@/domains/episode/lib/canvas-graph";
import {
	referenceAssetImageOutputPort,
	referenceGenerationPromptInputPort,
	referencePromptOutputPort,
	videoImageInputPort,
	videoPromptOutputPort,
	videoScriptInputPort,
} from "@/domains/episode/lib/canvas-ports";
import { layoutEpisodeCanvasGraph } from "@/domains/episode/lib/canvas-layout";
import { createEpisodeFromMarkdownDocument } from "@/domains/episode/lib/from-markdown";
import { parseStoryboardShots } from "@/domains/episode/lib/storyboard-shots";
import type { MarkdownDocument } from "@/domains/documents/stores";

const makeDocument = (
	content: string,
	overrides: Partial<MarkdownDocument> = {},
): MarkdownDocument => ({
	category: "storyboard",
	comments: [],
	content,
	id: "storyboard-1",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	title: "测试分镜",
	updatedAt: "2026-06-21T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...overrides,
});

describe("parseStoryboardShots", () => {
	it("extracts shot metadata used by text storyboard nodes", () => {
		const shots = parseStoryboardShots(
			[
				"### 分镜 01",
				"",
				"**景别**：中景",
				"**视角**：低机位",
				"**运镜**：推近",
				"**时间**：0.00-3.50秒",
				"**动作**：林致尧转身看向门口。",
			].join("\n"),
		);

		expect(shots).toEqual([
			expect.objectContaining({
				cameraMove: "推近",
				durationLabel: "0.00-3.50秒",
				durationSeconds: 3.5,
				perspective: "低机位",
				prompt: [
					"景别：中景",
					"视角：低机位",
					"运镜：推近",
					"时间：0.00-3.50秒",
					"动作：林致尧转身看向门口。",
				].join("\n"),
				shotSize: "中景",
				text: "林致尧转身看向门口。",
				title: "分镜 01",
			}),
		]);
	});
});

describe("buildEpisodeCanvasGraph", () => {
	it("projects storyboard mentions, shots, and video clips into lanes", () => {
		const storyboard = [
			"# 第一集分镜",
			"",
			"## 第 01 组 总时长：00:07",
			"",
			"### 分镜 01",
			"",
			"**景别**：中景",
			"**运镜**：推近",
			"**动作**：@[审讯室](mention://scene-1?kind=document&category=scene) 中，@[林致尧](mention://char-1?kind=document&category=character) 看向窗外。",
			"**台词**：林致尧：“我知道是谁。”",
		].join("\n");
		const episode = createEpisodeFromMarkdownDocument(makeDocument(storyboard));
		const graph = buildEpisodeCanvasGraph({
			documents: [
				makeDocument("![审讯室](/media/scene.png)\n冷色调审讯室。", {
					category: "scene",
					id: "scene-1",
					title: "审讯室",
				}),
				makeDocument("男主，沉默克制。", {
					category: "character",
					id: "char-1",
					title: "林致尧",
				}),
			],
			episode,
			storyboardMarkdown: storyboard,
		});

		expect(graph.lanes).toHaveLength(1);
		expect(graph.lanes[0]?.references.map((reference) => reference.title)).toEqual([
			"审讯室",
			"林致尧",
		]);
		expect(graph.nodes.filter((node) => node.type === "reference-prompt")).toHaveLength(2);
		expect(graph.nodes.filter((node) => node.type === "reference-image")).toHaveLength(2);
		const scenePromptNode = graph.nodes.find(
			(node) => node.type === "reference-prompt" && node.data.reference?.category === "scene",
		);
		const sceneImageNode = graph.nodes.find(
			(node) => node.type === "reference-image" && node.data.reference?.category === "scene",
		);
		const characterPromptNode = graph.nodes.find(
			(node) => node.type === "reference-prompt" && node.data.reference?.category === "character",
		);
		const characterImageNode = graph.nodes.find(
			(node) => node.type === "reference-image" && node.data.reference?.category === "character",
		);
		expect(sceneImageNode?.data.canGenerateReferenceImage).toBe(true);
		expect(characterImageNode?.data.canGenerateReferenceImage).toBe(true);
		expect(graph.nodes.some((node) => node.type === "text-storyboard")).toBe(false);
		expect(graph.nodes.some((node) => node.type === "storyboard-image")).toBe(false);
		expect(graph.nodes.find((node) => node.type === "video-prompt")?.data.shots).toEqual([
			expect.objectContaining({
				cameraMove: "推近",
				shotSize: "中景",
				title: "分镜 01",
			}),
		]);
		const promptNode = graph.nodes.find((node) => node.type === "video-prompt");
		const videoNode = graph.nodes.find((node) => node.type === "video-output");
		expect(graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						laneId: graph.lanes[0]?.id,
						mediaType: "script",
						relation: "flow",
					}),
					source: promptNode?.id,
					sourceHandle: videoPromptOutputPort,
					target: videoNode?.id,
					targetHandle: videoScriptInputPort,
				}),
			]),
		);
		expect(graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						laneId: graph.lanes[0]?.id,
						mediaType: "script",
						relation: "flow",
					}),
					source: scenePromptNode?.id,
					sourceHandle: referencePromptOutputPort,
					target: sceneImageNode?.id,
					targetHandle: referenceGenerationPromptInputPort,
				}),
			]),
		);
		expect(graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						laneId: graph.lanes[0]?.id,
						mediaType: "image",
						relation: "reference",
					}),
					source: sceneImageNode?.id,
					sourceHandle: referenceAssetImageOutputPort,
					target: videoNode?.id,
					targetHandle: videoImageInputPort,
				}),
			]),
		);

		const layout = layoutEpisodeCanvasGraph(graph);
		const scenePromptLayoutNode = layout.nodes.find((node) => node.id === scenePromptNode?.id);
		const sceneImageLayoutNode = layout.nodes.find((node) => node.id === sceneImageNode?.id);
		const characterPromptLayoutNode = layout.nodes.find(
			(node) => node.id === characterPromptNode?.id,
		);
		const videoPromptLayoutNode = layout.nodes.find((node) => node.id === promptNode?.id);
		const videoOutputLayoutNode = layout.nodes.find((node) => node.id === videoNode?.id);

		expect(
			(sceneImageLayoutNode?.position.x ?? 0) - (scenePromptLayoutNode?.position.x ?? 0),
		).toBeGreaterThanOrEqual(460);
		expect(
			(characterPromptLayoutNode?.position.y ?? 0) - (scenePromptLayoutNode?.position.y ?? 0),
		).toBeGreaterThanOrEqual(220);
		expect(videoPromptLayoutNode?.position.y).toBeLessThan(sceneImageLayoutNode?.position.y ?? 0);
		expect(videoPromptLayoutNode?.position.y).toBeLessThan(videoOutputLayoutNode?.position.y ?? 0);
	});

	it("keeps reference prompt text complete and spaces long nodes", () => {
		const storyboard = [
			"# 第一集分镜",
			"",
			"## 第 01 组 总时长：00:07",
			"",
			"### 分镜 01",
			"",
			"**动作**：@[陈远](mention://char-1?kind=document&category=character) 遇见 @[林书彤](mention://char-2?kind=document&category=character)。",
		].join("\n");
		const episode = createEpisodeFromMarkdownDocument(makeDocument(storyboard));
		const graph = buildEpisodeCanvasGraph({
			documents: [
				makeDocument(
					[
						"# 陈远",
						"",
						"形象定位：21岁男大学生，身高179cm，63kg。",
						"面部特征：清秀五官，眼神明亮。",
						"身材气质：前期瘦弱微驼。",
						"着装造型：旧T恤拖鞋。",
						"性格状态：前期自卑敏感。",
						"成长变化：后期逐渐自信。",
						"标志性细节：右耳银色耳钉。",
					].join("\n"),
					{ category: "character", id: "char-1", title: "陈远" },
				),
				makeDocument("林书彤，21岁女大学生。", {
					category: "character",
					id: "char-2",
					title: "林书彤",
				}),
			],
			episode,
			storyboardMarkdown: storyboard,
		});
		const layout = layoutEpisodeCanvasGraph(graph);
		const chenPromptNode = layout.nodes.find(
			(node) => node.type === "reference-prompt" && node.data.reference?.title === "陈远",
		);
		const linPromptNode = layout.nodes.find(
			(node) => node.type === "reference-prompt" && node.data.reference?.title === "林书彤",
		);

		expect(chenPromptNode?.data.body).toContain("标志性细节：右耳银色耳钉。");
		expect(chenPromptNode?.data.body).not.toContain("...");
		expect((linPromptNode?.position.y ?? 0) - (chenPromptNode?.position.y ?? 0)).toBeGreaterThan(
			260,
		);
	});

	it("passes generated video URLs to output nodes for cover previews", () => {
		const episode = createEpisodeFromMarkdownDocument(
			makeDocument("## 第 01 组\n\n### 分镜 01\n\n陈远站在校门口。"),
		);
		const videoClip = episode.tracks.find((track) => track.type === "video")?.clips[0];
		if (!videoClip) throw new Error("expected a video clip");
		videoClip.status = "ready";
		videoClip.videoUrl = "/api/v1/media-assets/generated-video/content";

		const graph = buildEpisodeCanvasGraph({ episode });
		const videoNode = graph.nodes.find((node) => node.type === "video-output");

		expect(videoNode?.data.status).toBe("ready");
		expect(videoNode?.data.subtitle).toBe("视频已生成");
		expect(videoNode?.data.videoUrl).toBe("/api/v1/media-assets/generated-video/content");
		expect(videoNode?.data.imageUrl).toBeUndefined();
	});

	it("does not create placeholder reference nodes when no material mentions are parsed", () => {
		const episode = createEpisodeFromMarkdownDocument(
			makeDocument("## 第 01 组\n\n### 分镜 01\n\n陈远站在校门口。"),
		);
		const graph = buildEpisodeCanvasGraph({ episode });
		const promptNode = graph.nodes.find((node) => node.type === "video-prompt");
		const videoNode = graph.nodes.find((node) => node.type === "video-output");

		expect(graph.lanes[0]?.references).toEqual([]);
		expect(graph.nodes.filter((node) => node.type === "reference-prompt")).toHaveLength(0);
		expect(graph.nodes.filter((node) => node.type === "reference-image")).toHaveLength(0);
		expect(graph.nodes).toHaveLength(2);
		expect(graph.edges).toEqual([
			expect.objectContaining({
				data: expect.objectContaining({
					laneId: graph.lanes[0]?.id,
					mediaType: "script",
					relation: "flow",
				}),
				source: promptNode?.id,
				sourceHandle: videoPromptOutputPort,
				target: videoNode?.id,
				targetHandle: videoScriptInputPort,
			}),
		]);
	});

	it("keeps video prompt text complete and spaces expanded nodes", () => {
		const longAction =
			"手持跟拍，轻微自然抖动；陈远急切地抓住林书彤的手腕，林书彤一脸嫌弃用力甩开，周围学生围观议论，陈远垂头站在人群中央。";
		const storyboard = [
			"# 第一集分镜",
			"",
			"## 第 01 组 总时长：00:07",
			"",
			"### 分镜 01",
			"",
			"**时间**：0.00-4.00秒",
			`**动作**：${longAction}`,
			"**光影**：伦勃朗光浅侧光，人物轮廓清晰。",
			"",
			"### 分镜 02",
			"",
			"**时间**：4.00-7.00秒",
			`**动作**：${longAction}`,
			"**机位**：侧面肩扛跟拍，从两人侧面45度取景。",
			"",
			"## 第 02 组 总时长：00:03",
			"",
			"### 分镜 03",
			"",
			"**动作**：林书彤转身离开。",
		].join("\n");
		const episode = createEpisodeFromMarkdownDocument(makeDocument(storyboard));
		const graph = buildEpisodeCanvasGraph({ episode, storyboardMarkdown: storyboard });
		const layout = layoutEpisodeCanvasGraph(graph);
		const firstVideoPrompt = layout.nodes.find(
			(node) => node.data.laneId === graph.lanes[0]?.id && node.type === "video-prompt",
		);
		const secondVideoPrompt = layout.nodes.find(
			(node) => node.data.laneId === graph.lanes[1]?.id && node.type === "video-prompt",
		);

		expect(firstVideoPrompt?.data.shots?.[0]?.prompt).toContain("光影：伦勃朗光浅侧光");
		expect(firstVideoPrompt?.data.shots?.[1]?.prompt).toContain("机位：侧面肩扛跟拍");
		expect(
			(secondVideoPrompt?.position.y ?? 0) - (firstVideoPrompt?.position.y ?? 0),
		).toBeGreaterThan(280);
	});

	it("lays out each lane deterministically from left to right", () => {
		const episode = createEpisodeFromMarkdownDocument(
			makeDocument("## 第 01 组\n\n### 分镜 01\n\n动作一\n\n## 第 02 组\n\n### 分镜 01\n\n动作二"),
		);
		const graph = buildEpisodeCanvasGraph({ episode });
		const layout = layoutEpisodeCanvasGraph(graph);
		const firstLane = layout.lanes[0];
		const secondLane = layout.lanes[1];
		const firstVideo = layout.nodes.find(
			(node) => node.data.laneId === firstLane?.id && node.type === "video-output",
		);
		const firstVideoPrompt = layout.nodes.find(
			(node) => node.data.laneId === firstLane?.id && node.type === "video-prompt",
		);
		const secondVideoPrompt = layout.nodes.find(
			(node) => node.data.laneId === secondLane?.id && node.type === "video-prompt",
		);

		expect(firstVideoPrompt?.position.x).toBeLessThan(firstVideo?.position.x ?? 0);
		expect(secondVideoPrompt?.position.y).toBeGreaterThan(firstVideoPrompt?.position.y ?? 0);
		expect(layout.metrics.width).toBeGreaterThan(firstVideo?.position.x ?? 0);
	});

	it("focuses the canvas on the selected timeline group", () => {
		const episode = createEpisodeFromMarkdownDocument(
			makeDocument("## 第 01 组\n\n### 分镜 01\n\n动作一\n\n## 第 02 组\n\n### 分镜 01\n\n动作二"),
		);
		const graph = buildEpisodeCanvasGraph({ episode });
		const selectedLane = graph.lanes[1];
		const focused = focusEpisodeCanvasGraph(graph, episode, selectedLane?.clipId);

		expect(focused.lanes).toEqual([selectedLane]);
		expect(focused.nodes.every((node) => node.data.laneId === selectedLane?.id)).toBe(true);
		expect(focused.edges.every((edge) => edge.data.laneId === selectedLane?.id)).toBe(true);
		expect(focused.nodes.find((node) => node.type === "video-output")?.data.title).toBe(
			selectedLane?.title,
		);
	});
});
