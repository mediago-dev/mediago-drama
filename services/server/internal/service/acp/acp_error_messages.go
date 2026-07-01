package acp

import "strings"

const apiKeyBalanceInsufficientMessage = "当前 API Key 余额不足，请充值后重试。"

func friendlyACPProviderErrorMessage(raw string) string {
	normalized := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(raw)), " "))
	if normalized == "" {
		return ""
	}
	hasQuotaCode := strings.Contains(normalized, "400003") &&
		(strings.Contains(normalized, "quota") ||
			strings.Contains(normalized, "credit") ||
			strings.Contains(normalized, `"code"`) ||
			strings.Contains(normalized, "code:") ||
			strings.Contains(normalized, "错误码") ||
			strings.Contains(normalized, "余额") ||
			strings.Contains(normalized, "额度"))
	switch {
	case strings.Contains(normalized, "insufficient_quota"),
		strings.Contains(normalized, "credit insufficient"),
		strings.Contains(normalized, "insufficient balance"),
		strings.Contains(normalized, "quota_exceeded"),
		hasQuotaCode,
		strings.Contains(normalized, "余额不足"),
		strings.Contains(normalized, "额度不足"):
		return apiKeyBalanceInsufficientMessage
	default:
		return ""
	}
}
