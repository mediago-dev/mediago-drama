export const continuityDimensions = [
	"人物身份",
	"服装与材质",
	"色彩与光线",
	"镜头方向",
	"环境与物体状态",
] as const;

export type ContinuityDimension = (typeof continuityDimensions)[number];

export const buildContinuityRule = (
	fromShot: string,
	toShot: string,
	dimensions: readonly ContinuityDimension[],
	condition: string,
) => {
	const source = fromShot.trim();
	const target = toShot.trim();
	if (!source || !target || source === target) return "";
	const inherited =
		dimensions.length > 0 ? dimensions.join("、") : "人物身份、服装与材质、色彩与光线";
	const variable = condition.trim() || "仅允许按分镜改变动作、表情与景别，其他稳定项不得漂移";
	return `${target} 继承 ${source}：保持${inherited}一致；${variable}。`;
};

export const promptFromAssistantReply = (value: string) => {
	const text = value.trim();
	if (!text) return "";
	const promptMarker = text.match(/【修改后\s*Prompt】\s*([\s\S]+)/iu);
	if (promptMarker?.[1]?.trim()) return promptMarker[1].trim();
	const fenced = [...text.matchAll(/```(?:text|markdown|prompt)?\s*\n?([\s\S]*?)```/giu)]
		.map((match) => match[1]?.trim() ?? "")
		.filter(Boolean)
		.sort((left, right) => right.length - left.length);
	return fenced[0] || text;
};

export const rulesForShot = (rules: readonly string[], shotCode: string) => {
	const code = shotCode.trim();
	if (!code) return [];
	return rules.filter((rule) => {
		const target = rule.match(/^\s*([^：:]+?)\s*继承\s*([^：:]+?)[：:]/u)?.[1]?.trim();
		return target === code;
	});
};

export const promptWithContinuityRules = (
	prompt: string,
	shotCode: string,
	rules: readonly string[],
) => {
	const matched = rulesForShot(rules, shotCode);
	if (matched.length === 0) return prompt;
	return `${prompt.trim()}\n\n【跨镜连续性规则｜必须执行】\n${matched.map((rule) => `- ${rule}`).join("\n")}`;
};

export const storyboardGridCrop = (shotId: string, columns = 5, rows = 4) => {
	const ordinal = Number.parseInt(shotId.match(/\d+/u)?.[0] ?? "", 10);
	if (!Number.isFinite(ordinal) || ordinal < 1) return { column: 0, row: 0, valid: false };
	const index = Math.min(columns * rows - 1, ordinal - 1);
	return { column: index % columns, row: Math.floor(index / columns), valid: true };
};
