package middleware

import "testing"

func TestIsAllowedLocalOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{name: "tauri localhost", origin: "tauri://localhost", want: true},
		{name: "tauri http localhost", origin: "http://tauri.localhost", want: true},
		{name: "vite localhost", origin: "http://127.0.0.1:1420", want: true},
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
