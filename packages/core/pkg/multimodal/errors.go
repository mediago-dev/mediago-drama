package multimodal

import (
	"errors"
	"fmt"
)

// ErrEmptyRequest is returned when a generation request has no messages.
var ErrEmptyRequest = errors.New("multimodal request has no messages")

// ErrEmptyPart is returned when a message part does not contain usable content.
var ErrEmptyPart = errors.New("multimodal message part is empty")

// ErrUnsupportedRole is returned when a message role is not part of the core contract.
var ErrUnsupportedRole = errors.New("multimodal message role is unsupported")

// ErrUnsupportedModality is returned when a part modality is not part of the core contract.
var ErrUnsupportedModality = errors.New("multimodal part modality is unsupported")

// ErrorKind classifies provider failures for API and event-layer handling.
type ErrorKind string

const (
	// ErrorKindUnknown is used when the provider did not expose a more precise category.
	ErrorKindUnknown ErrorKind = "unknown"
	// ErrorKindInvalidRequest marks malformed input.
	ErrorKindInvalidRequest ErrorKind = "invalid_request"
	// ErrorKindAuthentication marks missing or rejected provider credentials.
	ErrorKindAuthentication ErrorKind = "authentication"
	// ErrorKindRateLimited marks provider quota or throttling errors.
	ErrorKindRateLimited ErrorKind = "rate_limited"
	// ErrorKindUnavailable marks temporary provider outages.
	ErrorKindUnavailable ErrorKind = "unavailable"
)

// ProviderError carries provider context while preserving the original error.
type ProviderError struct {
	Kind     ErrorKind
	Provider string
	Message  string
	Err      error
}

// Error returns a stable provider error message.
func (err *ProviderError) Error() string {
	if err == nil {
		return ""
	}

	message := err.Message
	if message == "" && err.Err != nil {
		message = err.Err.Error()
	}
	if message == "" {
		message = string(err.Kind)
	}
	if err.Provider == "" {
		return message
	}

	return fmt.Sprintf("%s: %s", err.Provider, message)
}

// Unwrap exposes the original provider error.
func (err *ProviderError) Unwrap() error {
	if err == nil {
		return nil
	}

	return err.Err
}
