const hiddenProviderDetailPattern = /\b(dmx|dmxapi|openrouter)\b/i;
const rawStructuredErrorPattern =
	/(^\s*\{)|(\\"error\\")|("error")|(request failed with status)|(api returned error)/i;

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
	if (!detail) return false;

	return hiddenProviderDetailPattern.test(detail) || rawStructuredErrorPattern.test(detail);
};

export const visibleGenerationErrorDetail = (rawError: string) => {
	const detail = compactGenerationError(rawError);
	if (!detail || shouldHideGenerationErrorDetail(detail)) return "";

	return detail;
};

export const safeGenerationHistoryErrorText = (
	error: string | undefined,
	content: string,
	fallback = "生成失败，暂无错误详情。",
) => {
	const contentText = visibleGenerationErrorDetail(content);
	if (contentText) return contentText;

	const errorText = visibleGenerationErrorDetail(error ?? "");
	if (errorText) return errorText;

	return fallback;
};
