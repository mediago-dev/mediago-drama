const visualStylePrefix = "项目视觉风格：";
const visualStyleInstruction = "本次图片/视频生成必须遵循这个风格。";

export const applyVisualStyle = (
	prompt: string,
	options: { briefStyle?: string; chipPrompt?: string } = {},
) => {
	const style = (options.chipPrompt?.trim() || options.briefStyle?.trim() || "").trim();
	if (!style) return prompt;

	const basePrompt = stripTrailingVisualStyleBlock(prompt).trimEnd();
	return `${basePrompt}\n\n${visualStylePrefix}\n${style}\n\n${visualStyleInstruction}`;
};

const stripTrailingVisualStyleBlock = (prompt: string) => {
	const trimmed = prompt.trimEnd();
	const instructionIndex = trimmed.lastIndexOf(visualStyleInstruction);
	if (instructionIndex < 0) return prompt;

	const prefixIndex = trimmed.lastIndexOf(`\n\n${visualStylePrefix}`, instructionIndex);
	if (prefixIndex < 0) return prompt;

	const trailing = trimmed.slice(instructionIndex + visualStyleInstruction.length).trim();
	if (trailing) return prompt;

	return trimmed.slice(0, prefixIndex);
};
