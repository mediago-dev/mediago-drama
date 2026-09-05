import type { ProjectOutputArchiveRecord } from "@/domains/projects/api/projects";

/**
 * 稳定的归档去重键：同一个生成任务的同一个结果，在同一个输出目录只归档一次。
 * assetId 为空时使用调用方传入的槽位 ID，避免多图任务互相覆盖。
 */
export const outputArchiveKey = (input: {
	taskId: string;
	assetId?: string;
	outputDirectory: string;
}) => `${input.taskId}:${input.assetId ?? ""}:${input.outputDirectory}`;

export const sanitizeOutputFilename = (value: string) => value.replace(/[\\/:*?"<>|]/g, "_").trim();

export const buildOutputFilename = (input: {
	requestedName?: string;
	sourceName?: string;
	fallbackBase: string;
	fallbackExtension: string;
	/** 可选的制作语义，尽量让文件脱离 App 后仍然看得懂。 */
	shotId?: string;
	assetLabel?: string;
	version?: string;
}) => {
	const base = sanitizeOutputFilename(
		input.requestedName?.trim() || input.sourceName?.trim() || input.fallbackBase,
	);
	const semanticPrefix = [input.shotId, input.assetLabel, input.version]
		.map((value) => sanitizeOutputFilename(value?.trim() ?? ""))
		.filter(Boolean)
		.join("_");
	const requested =
		semanticPrefix && !base.startsWith(`${semanticPrefix}_`) ? `${semanticPrefix}_${base}` : base;
	return /\.[a-z0-9]{2,5}$/i.test(requested)
		? requested
		: `${requested}.${input.fallbackExtension.replace(/^\./, "")}`;
};

/** 同一输出目录中不同任务不能互相覆盖；历史文件名保留，只给新文件加可读的副本后缀。 */
export const ensureUniqueOutputFilename = (
	filename: string,
	existingFilenames: Iterable<string>,
) => {
	const used = new Set([...existingFilenames].map((value) => value.toLowerCase()));
	if (!used.has(filename.toLowerCase())) return filename;
	const match = filename.match(/^(.*?)(\.[^.]+)?$/);
	const stem = match?.[1] || filename;
	const extension = match?.[2] || "";
	for (let index = 2; index < 10000; index += 1) {
		const candidate = `${stem}_R${String(index).padStart(2, "0")}${extension}`;
		if (!used.has(candidate.toLowerCase())) return candidate;
	}
	return `${stem}_${Date.now()}${extension}`;
};

export const mergeOutputArchives = (
	existing: ProjectOutputArchiveRecord[],
	additions: ProjectOutputArchiveRecord[],
) => {
	const keys = new Set(existing.map(outputArchiveKey));
	const next = [...existing];
	for (const record of additions) {
		const key = outputArchiveKey(record);
		if (keys.has(key)) continue;
		keys.add(key);
		next.push(record);
	}
	return next;
};
