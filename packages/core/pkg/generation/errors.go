package generation

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ErrMissingPrompt is returned when a generation request has no prompt.
var ErrMissingPrompt = errors.New("generation prompt is required")

// ErrUnsupportedKind is returned when a provider does not support the requested generation kind.
var ErrUnsupportedKind = errors.New("generation kind is unsupported")

// ErrMissingAPIKey is returned when a remote provider has no configured API key.
var ErrMissingAPIKey = errors.New("generation provider API key is required")

// ErrTextStreamingUnsupported is returned when a text provider can generate
// text but cannot emit incremental text events.
var ErrTextStreamingUnsupported = errors.New("text streaming is unsupported")

// FailureReason identifies the normalized reason a provider request failed.
type FailureReason string

const (
	// FailureProviderError is used when a provider failed without a more specific reason.
	FailureProviderError FailureReason = "provider_error"
	// FailureInvalidParameter is used when provider validation rejects request parameters.
	FailureInvalidParameter FailureReason = "invalid_parameter"
	// FailurePolicyViolation is used when provider safety policy rejects a request or result.
	FailurePolicyViolation FailureReason = "policy_violation"
	// FailureRateLimited is used when provider quota or rate limits reject a request.
	FailureRateLimited FailureReason = "rate_limited"
	// FailureAuthentication is used when provider credentials are missing or invalid.
	FailureAuthentication FailureReason = "authentication"
	// FailureTimeout is used when provider communication exceeds the configured deadline.
	FailureTimeout FailureReason = "timeout"
)

// FailureInfo carries provider error semantics without losing the raw detail.
type FailureInfo struct {
	Provider  string
	Code      string
	Reason    FailureReason
	Message   string
	Raw       string
	Retryable bool
}

// HTTPError carries provider HTTP failure details while keeping a concise error string.
type HTTPError struct {
	Provider   string
	StatusCode int
	Body       string
	Code       string
	Reason     FailureReason
	Message    string
	Retryable  bool
}

// Error returns a stable provider HTTP error message.
func (err *HTTPError) Error() string {
	if err == nil {
		return ""
	}
	provider := err.Provider
	if provider == "" {
		provider = "generation provider"
	}
	if err.Body == "" {
		return fmt.Sprintf("%s request failed with status %d", provider, err.StatusCode)
	}

	return fmt.Sprintf("%s request failed with status %d: %s", provider, err.StatusCode, err.Body)
}

// HTTPErrorFromResponse creates an HTTPError from a non-2xx provider response.
func HTTPErrorFromResponse(provider string, response *http.Response) error {
	if response == nil {
		return &HTTPError{
			Provider: provider,
			Code:     "provider_http_error",
			Reason:   FailureProviderError,
			Message:  "Provider request failed.",
		}
	}

	body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	statusCode := response.StatusCode
	reason := FailureProviderError
	code := "provider_http_error"
	message := "Provider request failed."
	retryable := statusCode == http.StatusTooManyRequests || statusCode >= 500
	if statusCode == http.StatusTooManyRequests {
		reason = FailureRateLimited
		code = "rate_limited"
		message = "Provider rate limit exceeded."
	} else if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		reason = FailureAuthentication
		code = "authentication"
		message = "Provider authentication failed."
	}
	return &HTTPError{
		Provider:   provider,
		StatusCode: statusCode,
		Body:       strings.TrimSpace(string(body)),
		Code:       code,
		Reason:     reason,
		Message:    message,
		Retryable:  retryable,
	}
}

// FailureFromError extracts normalized provider failure details from an error.
func FailureFromError(err error) (FailureInfo, bool) {
	if err == nil {
		return FailureInfo{}, false
	}

	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		return FailureInfo{
			Provider:  httpErr.Provider,
			Code:      firstNonEmpty(httpErr.Code, "provider_http_error"),
			Reason:    failureReasonOrDefault(httpErr.Reason),
			Message:   firstNonEmpty(httpErr.Message, "Provider request failed."),
			Raw:       firstNonEmpty(httpErr.Body, httpErr.Error()),
			Retryable: httpErr.Retryable,
		}, true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return FailureInfo{
			Code:      "timeout",
			Reason:    FailureTimeout,
			Message:   "Provider request timed out.",
			Raw:       err.Error(),
			Retryable: true,
		}, true
	}
	if errors.Is(err, ErrMissingAPIKey) {
		return FailureInfo{
			Code:      "authentication",
			Reason:    FailureAuthentication,
			Message:   "Provider API key is not configured.",
			Raw:       err.Error(),
			Retryable: false,
		}, true
	}

	return FailureInfo{}, false
}

func failureReasonOrDefault(reason FailureReason) FailureReason {
	if reason == "" {
		return FailureProviderError
	}
	return reason
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
