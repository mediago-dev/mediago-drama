import { useCallback, useRef, useState } from "react";
import { streamGenerationText } from "@/domains/generation/api/generation";
import { useCodexTextAvailability } from "@/domains/generation/hooks/useCodexTextAvailability";
import { buildStoryboardPlanningRequest } from "@/domains/production/lib/stage-one-deliverables";

const storyboardDirectorInstruction = [
	"你是商业影视分镜导演，只完成文本分镜设计，不调用工具、Skill、文件搜索或图片生成。",
	"必须理解完整剧本的戏剧结构，再为每一格设计独立且可执行的画面，禁止按原文换行机械切段。",
	"标题、章节名、制作备注、审核要求、Markdown链接和诸如‘高潮点’的标签不能单独成为镜头。",
	"每格都必须明确填写剧情功能、出场主体、表演动作、景别机位镜头、构图空间、场景道具、灯光色彩材质、连续性和负面约束。",
	"镜头时长根据动作和节奏分配，总时长必须为60秒；景别和机位服务叙事，禁止固定循环套模板。",
	"只输出最终可直接送入生图模型的中文提示词，不输出解释、思考过程、Markdown代码块或剧本全文。",
].join("\n");

export const useStoryboardPromptGeneration = (projectId: string) => {
	const codexAvailable = useCodexTextAvailability();
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const generate = useCallback(
		async (
			script: string,
			visualDirection = "",
			onProgress?: (content: string, panelCount: number) => void,
		) => {
			if (!codexAvailable) {
				setError("Codex 推理模型未连接，无法进行专业分镜拆解。");
				return null;
			}
			if (!script.trim()) {
				setError("没有读取到已锁定剧本。");
				return null;
			}
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setIsGenerating(true);
			setError(null);
			let accumulated = "";
			let finalText = "";
			try {
				await streamGenerationText(
					{
						kind: "text",
						textExecutor: "codex",
						projectId,
						routeId: "",
						modelId: "",
						model: "",
						prompt: buildStoryboardPlanningRequest(script, visualDirection, 20),
						params: { system_instruction: storyboardDirectorInstruction },
						referenceUrls: [],
						referenceAssetIds: [],
					},
					{
						signal: controller.signal,
						onDelta: (delta) => {
							accumulated += delta;
							const panelIds = accumulated.match(/P(?:0[1-9]|1\d|20)\b/g) ?? [];
							onProgress?.(accumulated, new Set(panelIds).size);
						},
						onDone: (message) => {
							finalText = message.text?.trim() || message.message?.trim() || "";
						},
						onError: (message) => setError(message || "分镜提示词生成失败。"),
					},
				);
				const result = (finalText || accumulated).trim();
				if (!result) throw new Error("推理模型没有返回分镜提示词。");
				const panelIds = result.match(/P(?:0[1-9]|1\d|20)\b/g) ?? [];
				if (new Set(panelIds).size !== 20) {
					throw new Error("分镜拆解未完整覆盖 P01—P20，已阻止低质量结果进入生图。");
				}
				return result;
			} catch (caught) {
				if (controller.signal.aborted) return null;
				setError(caught instanceof Error ? caught.message : "分镜提示词生成失败。");
				return null;
			} finally {
				if (abortRef.current === controller) abortRef.current = null;
				setIsGenerating(false);
			}
		},
		[codexAvailable, projectId],
	);

	return { canGenerate: codexAvailable, error, generate, isGenerating };
};
