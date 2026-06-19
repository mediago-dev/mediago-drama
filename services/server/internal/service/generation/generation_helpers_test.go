package generation

import "testing"

func TestGenerationProjectIDFromScopeID(t *testing.T) {
	tests := []struct {
		name    string
		scopeID string
		want    string
	}{
		{name: "project scope", scopeID: "project-alpha", want: "alpha"},
		{name: "trims whitespace", scopeID: " project-alpha ", want: "alpha"},
		{name: "studio scope", scopeID: "studio", want: ""},
		{name: "empty scope", scopeID: "", want: ""},
		{name: "sanitizes project id", scopeID: "project-alpha/beta", want: "alpha-beta"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := GenerationProjectIDFromScopeID(test.scopeID); got != test.want {
				t.Fatalf("GenerationProjectIDFromScopeID(%q) = %q, want %q", test.scopeID, got, test.want)
			}
		})
	}
}

func TestGenerationProjectIDForRequestPrefersExplicitProjectID(t *testing.T) {
	if got := GenerationProjectIDForRequest("alpha", "episode-video:episode-1:clip-1"); got != "alpha" {
		t.Fatalf("GenerationProjectIDForRequest() = %q, want alpha", got)
	}
	if got := GenerationProjectIDForRequest("", "project-beta"); got != "beta" {
		t.Fatalf("GenerationProjectIDForRequest() fallback = %q, want beta", got)
	}
}
