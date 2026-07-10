export const sanitizeSkillName = (value: string) =>
	value
		.trim()
		.replace(/\.skill\.md$/iu, "")
		.replace(/[^\p{L}\p{N}_-]/gu, "-")
		.replace(/^[-_]+/, "");
