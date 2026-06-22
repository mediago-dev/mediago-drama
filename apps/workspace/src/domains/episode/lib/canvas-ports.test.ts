import { describe, expect, it } from "vitest";
import {
	canConnectPorts,
	episodeCanvasMediaTypeTokens,
	getCanvasNodePorts,
	performanceAssetImageInputPort,
	referenceAssetImageOutputPort,
	referenceGenerationPromptInputPort,
	referencePromptOutputPort,
	storyboardImageAssetInputPort,
	storyboardImageScriptInputPort,
	textStoryboardScriptOutputPort,
	videoImageInputPort,
	videoOutputPort,
	videoPromptOutputPort,
	videoScriptInputPort,
} from "@/domains/episode/lib/canvas-ports";

describe("episode canvas ports", () => {
	it("declares typed inputs and outputs for each canvas node", () => {
		expect(getCanvasNodePorts("reference-prompt")).toMatchObject({
			inputs: [],
			outputs: [expect.objectContaining({ id: referencePromptOutputPort, label: "提示词" })],
		});
		expect(getCanvasNodePorts("reference-image")).toMatchObject({
			inputs: [
				expect.objectContaining({ id: referenceGenerationPromptInputPort, mediaType: "script" }),
				expect.objectContaining({ label: "参考图", mediaType: "image" }),
			],
			outputs: [expect.objectContaining({ id: referenceAssetImageOutputPort, label: "素材图" })],
		});
		expect(getCanvasNodePorts("performance").inputs[0]?.id).toBe(performanceAssetImageInputPort);
		expect(getCanvasNodePorts("text-storyboard").outputs[0]?.mediaType).toBe("script");
		expect(getCanvasNodePorts("storyboard-image").inputs.map((port) => port.id)).toEqual([
			storyboardImageScriptInputPort,
			storyboardImageAssetInputPort,
		]);
		expect(getCanvasNodePorts("video-prompt")).toMatchObject({
			inputs: [],
			outputs: [expect.objectContaining({ id: videoPromptOutputPort, label: "提示词" })],
		});
		expect(getCanvasNodePorts("video-output")).toMatchObject({
			inputs: [
				expect.objectContaining({ id: videoScriptInputPort, label: "提示词", mediaType: "script" }),
				expect.objectContaining({ id: videoImageInputPort, label: "参考图", mediaType: "image" }),
			],
			outputs: [expect.objectContaining({ id: videoOutputPort, mediaType: "video" })],
		});
	});

	it("maps media types to existing semantic design tokens", () => {
		expect(episodeCanvasMediaTypeTokens.image.foreground).toBe("var(--success-foreground)");
		expect(episodeCanvasMediaTypeTokens.script.foreground).toBe("var(--warning-foreground)");
		expect(episodeCanvasMediaTypeTokens.video.foreground).toBe("var(--info-foreground)");
	});

	it("only connects output ports to type-compatible input ports", () => {
		const referencePromptOutput = getCanvasNodePorts("reference-prompt").outputs[0];
		const referencePromptInput = getCanvasNodePorts("reference-image").inputs[0];
		const referenceOutput = getCanvasNodePorts("reference-image").outputs[0];
		const performanceInput = getCanvasNodePorts("performance").inputs[0];
		const storyboardScriptInput = getCanvasNodePorts("storyboard-image").inputs[0];
		const storyboardOutput = getCanvasNodePorts("text-storyboard").outputs[0];
		const videoPromptOutput = getCanvasNodePorts("video-prompt").outputs[0];
		const videoPromptInput = getCanvasNodePorts("video-output").inputs[0];
		const videoReferenceInput = getCanvasNodePorts("video-output").inputs[1];

		expect(canConnectPorts(referencePromptOutput, referencePromptInput)).toBe(true);
		expect(canConnectPorts(referenceOutput, performanceInput)).toBe(true);
		expect(canConnectPorts(referenceOutput, videoReferenceInput)).toBe(true);
		expect(canConnectPorts(videoPromptOutput, videoPromptInput)).toBe(true);
		expect(canConnectPorts(referenceOutput, storyboardScriptInput)).toBe(false);
		expect(canConnectPorts(storyboardOutput, storyboardScriptInput)).toBe(true);
		expect(canConnectPorts(referenceOutput, videoPromptInput)).toBe(false);
		expect(canConnectPorts(performanceInput, storyboardOutput)).toBe(false);
		expect(canConnectPorts(null, storyboardScriptInput)).toBe(false);
	});

	it("keeps output-to-input names aligned with the intended flow", () => {
		expect(textStoryboardScriptOutputPort).toBe("output-storyboard-script");
		expect(videoPromptOutputPort).toBe("output-video-prompt");
		expect(videoScriptInputPort).toBe("input-video-prompt");
		expect(videoImageInputPort).toBe("input-video-reference-image");
	});
});
