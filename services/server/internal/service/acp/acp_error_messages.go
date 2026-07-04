package acp

import "strings"

const apiKeyBalanceInsufficientMessage = "当前 API Key 余额不足，请充值后重试。"
const apiKeyInvalidMessage = "当前模型调用的 API Key 无效或已失效，请在对应设置页更新后重试。"
const codexRelayAPIKeyInvalidMessage = "Codex 中转 API Key 无效或已失效，请在「设置 > Codex 中转」更新后重试。"

type friendlyACPProviderError struct {
	message string
	reason  string
}

func friendlyACPProviderErrorMessage(raw string) string {
	return friendlyACPProviderErrorFor(raw).message
}

func friendlyACPProviderErrorFor(raw string) friendlyACPProviderError {
	normalized := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(raw)), " "))
	if normalized == "" {
		return friendlyACPProviderError{}
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
	case strings.Contains(normalized, "invalid_api_key"),
		strings.Contains(normalized, "invalid api key"),
		strings.Contains(normalized, "incorrect api key"),
		strings.Contains(normalized, "api key is invalid"),
		strings.Contains(normalized, "apikey is invalid"),
		strings.Contains(normalized, "unauthorized") && strings.Contains(normalized, "api key"):
		message := apiKeyInvalidMessage
		if strings.Contains(normalized, "codex-relay") || strings.Contains(normalized, "mediago-codex-relay") {
			message = codexRelayAPIKeyInvalidMessage
		}
		return friendlyACPProviderError{
			message: message,
			reason:  "api_key_invalid",
		}
	case strings.Contains(normalized, "insufficient_quota"),
		strings.Contains(normalized, "credit insufficient"),
		strings.Contains(normalized, "insufficient balance"),
		strings.Contains(normalized, "quota_exceeded"),
		hasQuotaCode,
		strings.Contains(normalized, "余额不足"),
		strings.Contains(normalized, "额度不足"):
		return friendlyACPProviderError{
			message: apiKeyBalanceInsufficientMessage,
			reason:  "api_key_balance_insufficient",
		}
	default:
		return friendlyACPProviderError{}
	}
}
