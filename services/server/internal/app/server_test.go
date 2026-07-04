package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestSPAHandler(t *testing.T) {
	handler := NewHandler(fstest.MapFS{
		"index.html": {
			Data: []byte("<html>workspace</html>"),
		},
		"assets/app.js": {
			Data: []byte("console.log('workspace')"),
		},
	})

	tests := []struct {
		name       string
		path       string
		statusCode int
		body       string
	}{
		{
			name:       "root returns index",
			path:       "/",
			statusCode: http.StatusOK,
			body:       "<html>workspace</html>",
		},
		{
			name:       "asset returns asset",
			path:       "/assets/app.js",
			statusCode: http.StatusOK,
			body:       "console.log('workspace')",
		},
		{
			name:       "client route falls back to index",
			path:       "/projects/123",
			statusCode: http.StatusOK,
			body:       "<html>workspace</html>",
		},
		{
			name:       "missing asset returns not found",
			path:       "/assets/missing.js",
			statusCode: http.StatusNotFound,
			body:       "404 page not found\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			response := recorder.Result()
			defer response.Body.Close()

			if response.StatusCode != test.statusCode {
				t.Fatalf("status code = %d, want %d", response.StatusCode, test.statusCode)
			}

			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatalf("reading response body: %v", err)
			}

			if string(body) != test.body {
				t.Fatalf("body = %q, want %q", string(body), test.body)
			}
		})
	}
}

func TestDefaultAgentBridgeURL(t *testing.T) {
	tests := []struct {
		name string
		host string
		port int
		want string
	}{
		{name: "default", want: "http://127.0.0.1:8080"},
		{name: "wildcard", host: "0.0.0.0", port: 19090, want: "http://127.0.0.1:19090"},
		{name: "explicit", host: "localhost", port: 19090, want: "http://localhost:19090"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := defaultAgentBridgeURL(test.host, test.port); got != test.want {
				t.Fatalf("defaultAgentBridgeURL(%q, %d) = %q, want %q", test.host, test.port, got, test.want)
			}
		})
	}
}

func TestCodexRelayBridgeBaseURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{
			name: "spawn endpoint",
			url:  "http://127.0.0.1:8080/api/v1/internal/agent/spawn",
			want: "http://127.0.0.1:8080",
		},
		{
			name: "already base url",
			url:  "http://127.0.0.1:8080",
			want: "http://127.0.0.1:8080",
		},
		{
			name: "query and fragment",
			url:  "http://localhost:19090/api/v1/internal/agent/spawn?token=x#fragment",
			want: "http://localhost:19090",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := codexRelayBridgeBaseURL(test.url); got != test.want {
				t.Fatalf("codexRelayBridgeBaseURL(%q) = %q, want %q", test.url, got, test.want)
			}
		})
	}
}
