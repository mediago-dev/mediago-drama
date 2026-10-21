package codex

import "testing"

func TestFriendlyRuntimeProviderErrorMessageDetectsInsufficientQuota(t *testing.T) {
	raw := `{"error":{"message":"credit insufficient","type":"insufficient_quota","code":"400003"}}`

	message := friendlyRuntimeProviderErrorMessage(raw)
	if message != apiKeyBalanceInsufficientMessage {
		t.Fatalf("message = %q, want balance hint", message)
	}
}

func TestFriendlyRuntimeProviderErrorMessageDetectsInvalidAPIKey(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "codex relay",
			raw:  `unexpected status 401 Unauthorized: {"code":"INVALID_API_KEY","message":"Invalid API key"}, url: http://127.0.0.1:48273/api/v1/codex-relay/v1/responses`,
			want: codexRelayAPIKeyInvalidMessage,
		},
		{
			name: "generic incorrect key",
			raw:  `{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}`,
			want: apiKeyInvalidMessage,
		},
		{
			name: "generic unauthorized key",
			raw:  `provider failed: unauthorized api key`,
			want: apiKeyInvalidMessage,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			message := friendlyRuntimeProviderErrorMessage(test.raw)
			if message != test.want {
				t.Fatalf("message = %q, want invalid API key hint", message)
			}
		})
	}
}

func TestParseRuntimeFinalResponseMapsProviderQuotaError(t *testing.T) {
	response := ParseRuntimeFinalResponse(
		`{"error":{"message":"credit insufficient","type":"insufficient_quota","code":"400003"}}`,
		agentRunRequest{},
	)

	if response.Message != apiKeyBalanceInsufficientMessage {
		t.Fatalf("message = %q, want balance hint", response.Message)
	}
}
