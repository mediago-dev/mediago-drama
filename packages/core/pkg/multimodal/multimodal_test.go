package multimodal

import (
	"errors"
	"testing"
)

func TestValidateRequest(t *testing.T) {
	tests := []struct {
		name    string
		request GenerateRequest
		wantErr error
	}{
		{
			name:    "empty request",
			request: GenerateRequest{},
			wantErr: ErrEmptyRequest,
		},
		{
			name: "message with no content",
			request: GenerateRequest{
				Messages: []Message{
					{Role: RoleUser},
				},
			},
			wantErr: ErrEmptyPart,
		},
		{
			name: "message with unsupported role",
			request: GenerateRequest{
				Messages: []Message{
					{
						Role: "runtime",
						Parts: []Part{
							{Modality: ModalityText, Text: "hello"},
						},
					},
				},
			},
			wantErr: ErrUnsupportedRole,
		},
		{
			name: "request with message",
			request: GenerateRequest{
				Messages: []Message{
					{
						Role: RoleUser,
						Parts: []Part{
							{
								Modality: ModalityText,
								Text:     "Create a video from this markdown.",
							},
						},
					},
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateRequest(test.request)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("ValidateRequest() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}
