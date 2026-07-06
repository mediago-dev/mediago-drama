const providerErrorMessageKeys = [
	"message",
	"error_message",
	"task_status_msg",
	"failure_message",
	"msg",
	"detail",
	"reason",
];

export const compactGenerationError = (rawError: string) =>
	rawError
		.trim()
		.replace(/^生成请求失败。\s*/u, "")
		.replace(/^视频生成任务已提交，完成后请再次检查状态。\s*/u, "")
		.replace(/\\n/g, "\n")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");

export const shouldHideGenerationErrorDetail = (value: string) => {
	const detail = compactGenerationError(value);
	return !detail;
};

export const visibleGenerationErrorDetail = (rawError: string) => {
	const detail = compactGenerationError(rawError);
	if (!detail || shouldHideGenerationErrorDetail(detail)) return "";

	return providerErrorMessageFromText(detail) || detail;
};

export const safeGenerationHistoryErrorText = (
	error: string | undefined,
	content: string,
	fallback = "生成失败，暂无错误详情。",
) => {
	const errorText = visibleGenerationErrorDetail(error ?? "");
	if (errorText) return errorText;

	const contentText = visibleGenerationErrorDetail(content);
	if (contentText) return contentText;

	return fallback;
};

const providerErrorMessageFromText = (detail: string) => {
	for (const candidate of jsonCandidatesFromText(detail)) {
		try {
			const parsed: unknown = JSON.parse(candidate);
			const message = providerErrorMessageFromValue(parsed);
			if (message) return message;
		} catch {
			// Keep trying the embedded JSON candidates below.
		}
	}
	return "";
};

const jsonCandidatesFromText = (detail: string) => {
	const candidates = [detail.trim()];
	const firstObjectStart = detail.indexOf("{");
	const lastObjectEnd = detail.lastIndexOf("}");
	if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
		candidates.push(detail.slice(firstObjectStart, lastObjectEnd + 1));
	}

	const initialCandidates = candidates.slice();
	for (const candidate of initialCandidates) {
		const trimmed = candidate.trim();
		if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
			candidates.push(trimmed.slice(1, -1));
		}
	}

	return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
};

const providerErrorMessageFromValue = (value: unknown): string => {
	if (typeof value === "string") return value.trim();
	if (!value || typeof value !== "object") return "";
	if (Array.isArray(value)) {
		for (const item of value) {
			const message = providerErrorMessageFromValue(item);
			if (message) return message;
		}
		return "";
	}

	const record = value as Record<string, unknown>;
	const nestedError = record.error;
	if (typeof nestedError === "string" && nestedError.trim()) return nestedError.trim();
	if (nestedError && typeof nestedError === "object") {
		const nestedMessage = providerErrorMessageFromValue(nestedError);
		if (nestedMessage) return nestedMessage;
	}

	for (const key of providerErrorMessageKeys) {
		const message = stringValue(record[key]);
		if (message) return message;
	}

	const code = stringValue(record.code);
	const type = stringValue(record.type);
	return [code, type].filter(Boolean).join(" ");
};

const stringValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");
