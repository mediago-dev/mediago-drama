package acp

import (
	"errors"
	"fmt"
	"testing"

	acpsdk "github.com/coder/acp-go-sdk"
)

func TestIsAuthenticationRequiredError(t *testing.T) {
	typedNil := (*acpsdk.RequestError)(nil)
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "nil error",
		},
		{
			name: "typed authentication error",
			err:  &acpsdk.RequestError{Code: -32000, Message: "Authentication required"},
			want: true,
		},
		{
			name: "wrapped typed authentication error",
			err: fmt.Errorf(
				"creating ACP config probe session: %w",
				&acpsdk.RequestError{Code: -32000, Message: "Authentication required"},
			),
			want: true,
		},
		{
			name: "matching text without typed code",
			err:  errors.New("creating ACP config probe session: Authentication required"),
		},
		{
			name: "different typed code with matching text",
			err:  &acpsdk.RequestError{Code: -32603, Message: "Authentication required"},
		},
		{
			name: "typed nil request error",
			err:  typedNil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsAuthenticationRequiredError(tt.err); got != tt.want {
				t.Fatalf("IsAuthenticationRequiredError() = %t, want %t", got, tt.want)
			}
		})
	}
}
