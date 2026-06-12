export interface TimelineSegment {
	id: string;
	title: string;
	start: number;
	end: number;
	visual: string;
	audio: string;
}

export interface MarkdownPatchSummary {
	added: number;
	removed: number;
	unchanged: number;
}

export const initialVideoMarkdown = `---
title: 智能体原生工作区草稿
duration: 30
---

# 开场

建立 Markdown 原生视频工作区的核心承诺。

\`\`\`video
start: 0
end: 8
visual: 分屏展示智能体面板正在塑造 Markdown 文档。
audio: 平静的旁白介绍项目目标和工作界面。
\`\`\`

# 搭建

展示时间线如何成为 Markdown 源文档的结构化投影。

\`\`\`video
start: 8
end: 20
visual: 时间线块依次归位，同时 Markdown 仍可编辑。
audio: 智能体提出修改、解释取舍，并等待确认。
\`\`\`

# 导出

以工作区产出干净的视频草稿作为收束。

\`\`\`video
start: 20
end: 30
visual: 预览、时间线和源文档进入就绪状态。
audio: 创作者检查结果并导出第一版剪辑。
\`\`\`
`;

export const agentDraftMarkdown = (prompt: string) => `---
title: 智能体生成草稿
duration: 36
---

# 意图

${prompt || "根据当前工作区简报创建一版简洁的视频草稿。"}

\`\`\`video
start: 0
end: 10
visual: 工作区打开，智能体面板位于 Markdown 源文档旁边。
audio: 介绍目标并确定创作方向。
\`\`\`

# 组装

智能体将请求转换为场景、时长、旁白和预览结构。

\`\`\`video
start: 10
end: 26
visual: Markdown 编辑流入时间线片段和预览检查点。
audio: 说明每个场景如何映射回作为事实来源的 Markdown。
\`\`\`

# 审阅

创作者在提交到文档前审阅建议补丁。

\`\`\`video
start: 26
end: 36
visual: 差异被接受后，视频剪辑台立即更新。
audio: 确认下一轮迭代路径并准备导出。
\`\`\`
`;

export const parseTimeline = (markdown: string): TimelineSegment[] => {
	const sections = markdown.split(/^# /m);
	const segments: TimelineSegment[] = [];

	for (const section of sections) {
		const title = section.split("\n")[0]?.trim() || "未命名";
		const fenceMatch = section.match(/```video\n([\s\S]*?)```/);
		if (!fenceMatch) continue;

		const fields = parseFields(fenceMatch[1] || "");
		const start = Number(fields.start ?? 0);
		const end = Number(fields.end ?? start);

		segments.push({
			id: `${segments.length}-${title.toLowerCase().replace(/\s+/g, "-")}`,
			title,
			start,
			end,
			visual: fields.visual ?? "",
			audio: fields.audio ?? "",
		});
	}

	return segments;
};

export const summarizePatch = (current: string, proposed: string): MarkdownPatchSummary => {
	const currentLines = current.split("\n");
	const proposedLines = proposed.split("\n");
	const max = Math.max(currentLines.length, proposedLines.length);
	let added = 0;
	let removed = 0;
	let unchanged = 0;

	for (let index = 0; index < max; index += 1) {
		const before = currentLines[index];
		const after = proposedLines[index];
		if (before === after) {
			unchanged += 1;
			continue;
		}
		if (before !== undefined) removed += 1;
		if (after !== undefined) added += 1;
	}

	return { added, removed, unchanged };
};

export const formatDuration = (seconds: number) => {
	const minutes = Math.floor(seconds / 60);
	const remaining = seconds % 60;
	return minutes > 0 ? `${minutes}分 ${remaining}秒` : `${remaining}秒`;
};

const parseFields = (body: string) => {
	const fields: Record<string, string> = {};

	for (const line of body.split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;

		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (key) fields[key] = value;
	}

	return fields;
};
