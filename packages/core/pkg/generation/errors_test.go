package generation

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestHTTPErrorFromResponse(t *testing.T) {
	err := HTTPErrorFromResponse(ProviderDMX, &http.Response{
		StatusCode: http.StatusTooManyRequests,
		Body:       io.NopCloser(strings.NewReader("rate limited")),
	})

	var httpErr *HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("HTTPErrorFromResponse() error = %T, want *HTTPError", err)
	}
	if httpErr.Provider != ProviderDMX ||
		httpErr.StatusCode != http.StatusTooManyRequests ||
		httpErr.Body != "rate limited" {
		t.Fatalf("HTTPErrorFromResponse() = %#v", httpErr)
	}
	if got := err.Error(); got != "dmx request failed with status 429: rate limited" {
		t.Fatalf("Error() = %q", got)
	}
}
