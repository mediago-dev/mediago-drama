package middleware

import "testing"

func TestIsAllowedLocalOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{name: "vite localhost", origin: "http://127.0.0.1:1420", want: true},
		{name: "electron dev localhost", origin: "http://127.0.0.1:31420", want: true},
		{name: "electron file origin", origin: "file://", want: true},
		{name: "electron app protocol", origin: "app://localhost", want: true},
		{name: "remote site", origin: "https://example.com", want: false},
		{name: "empty", origin: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isAllowedLocalOrigin(tt.origin); got != tt.want {
				t.Fatalf("isAllowedLocalOrigin(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}
