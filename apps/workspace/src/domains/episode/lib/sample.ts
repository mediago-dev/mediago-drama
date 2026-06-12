export type TimelineTrackType = "video" | "voiceover" | "caption" | "music" | "asset";

export type TimelineClipStatus = "draft" | "generating" | "ready" | "error";

export interface TimelineClip {
	id: string;
	title: string;
	start: number;
	end: number;
	content: string;
	status: TimelineClipStatus;
	prompt?: string;
	source?: string;
	videoUrl?: string;
	posterUrl?: string;
	thumbnailUrl?: string;
}

export interface TimelineTrack {
	id: string;
	type: TimelineTrackType;
	label: string;
	clips: TimelineClip[];
}

export interface EpisodeSection {
	id: string;
	title: string;
	start: number;
	end: number;
	summary: string;
}

export interface Episode {
	id: string;
	title: string;
	duration: number;
	aspectRatio: string;
	sections: EpisodeSection[];
	tracks: TimelineTrack[];
}

export const sampleEpisode: Episode = {
	id: "episode-product-launch",
	title: "发布视频剧集",
	duration: 96,
	aspectRatio: "16:9",
	sections: [
		{
			id: "section-hook",
			title: "钩子",
			start: 0,
			end: 16,
			summary: "从 Markdown 原生工作流开始，建立创作者目标。",
		},
		{
			id: "section-build",
			title: "搭建",
			start: 16,
			end: 62,
			summary: "展示智能体如何把源文本重塑为结构化视频节拍。",
		},
		{
			id: "section-review",
			title: "审阅",
			start: 62,
			end: 96,
			summary: "以时间线审阅、生成素材和导出就绪作为收束。",
		},
	],
	tracks: [
		{
			id: "track-video",
			type: "video",
			label: "视频",
			clips: [
				{
					id: "clip-cold-open",
					title: "冷开场",
					start: 0,
					end: 8,
					content: "桌面宽幅捕捉写作区、空时间线和智能体面板。",
					status: "ready",
					prompt: "干净的产品录屏，编辑器有轻微动态。",
					source: "工作区捕捉",
				},
				{
					id: "clip-problem",
					title: "问题铺垫",
					start: 8,
					end: 16,
					content: "创作者粘贴粗略备注，突出散文文本和制作结构之间的落差。",
					status: "ready",
					prompt: "Markdown 备注变为结构化块的近景。",
					source: "生成补充镜头",
				},
				{
					id: "clip-agent-pass",
					title: "智能体处理",
					start: 16,
					end: 38,
					content: "智能体建议场景块，时间线同步填入映射片段。",
					status: "generating",
					prompt: "UI 动态演示文档编辑反映到视频时间线上。",
					source: "Seedance 草稿",
				},
				{
					id: "clip-timeline",
					title: "时间线审阅",
					start: 38,
					end: 62,
					content: "多轨时间线中旁白、字幕、音乐和视觉片段已对齐。",
					status: "draft",
					prompt: "产品时间线工作台，轨道密集但可读。",
					source: "计划渲染",
				},
				{
					id: "clip-export",
					title: "导出交接",
					start: 62,
					end: 96,
					content: "预览、时间线和源文档进入干净的导出就绪草稿状态。",
					status: "draft",
					prompt: "带导出控制和完成状态的最终产品状态。",
					source: "计划渲染",
				},
			],
		},
		{
			id: "track-voiceover",
			type: "voiceover",
			label: "旁白",
			clips: [
				{
					id: "clip-vo-hook",
					title: "旁白钩子",
					start: 1,
					end: 15,
					content: "剧本可以是事实来源，而不是剪辑完成后的附属文件。",
					status: "ready",
				},
				{
					id: "clip-vo-agent",
					title: "旁白推进",
					start: 18,
					end: 58,
					content: "智能体阅读文档、提出结构，并在修改前等待确认。",
					status: "ready",
				},
				{
					id: "clip-vo-close",
					title: "旁白收束",
					start: 66,
					end: 91,
					content: "创作者不离开工作区即可审阅时间线并导出第一版草稿。",
					status: "draft",
				},
			],
		},
		{
			id: "track-caption",
			type: "caption",
			label: "字幕",
			clips: [
				{
					id: "clip-caption-one",
					title: "剧本优先",
					start: 2,
					end: 8,
					content: "从 Markdown 开始。",
					status: "ready",
				},
				{
					id: "clip-caption-two",
					title: "智能体建议",
					start: 22,
					end: 31,
					content: "让智能体提出修改建议。",
					status: "ready",
				},
				{
					id: "clip-caption-three",
					title: "审阅时间线",
					start: 43,
					end: 52,
					content: "在上下文中审阅每条轨道。",
					status: "draft",
				},
				{
					id: "clip-caption-four",
					title: "导出草稿",
					start: 76,
					end: 87,
					content: "交付第一版剪辑。",
					status: "draft",
				},
			],
		},
		{
			id: "track-music",
			type: "music",
			label: "音乐",
			clips: [
				{
					id: "clip-bgm",
					title: "低频脉冲铺底",
					start: 0,
					end: 96,
					content: "安静的合成铺底，在时间线审阅时略微抬升。",
					status: "ready",
					source: "本地素材",
				},
			],
		},
		{
			id: "track-assets",
			type: "asset",
			label: "素材",
			clips: [
				{
					id: "clip-logo",
					title: "产品标识",
					start: 0,
					end: 5,
					content: "标题区域中的 MediaGo Drama 标识。",
					status: "ready",
					source: "品牌素材",
				},
				{
					id: "clip-still",
					title: "生成静帧",
					start: 34,
					end: 50,
					content: "三张生成静帧放入素材架。",
					status: "generating",
					source: "图像生成",
				},
				{
					id: "clip-export-file",
					title: "最终渲染",
					start: 88,
					end: 96,
					content: "导出视频占位。",
					status: "draft",
					source: "待导出",
				},
			],
		},
	],
};

export const formatTimelineTime = (seconds: number) => {
	const safeSeconds = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(safeSeconds / 60);
	const remainingSeconds = safeSeconds % 60;

	return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
};
