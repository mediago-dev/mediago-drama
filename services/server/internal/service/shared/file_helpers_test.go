package shared

import (
	"path/filepath"
	"testing"
)

func TestCleanRelativeFilenamePreservesSafeNestedPaths(t *testing.T) {
	got := CleanRelativeFilename("../第一章/./场景:一?.md")
	want := filepath.Join("第一章", "场景-一-.md")
	if got != want {
		t.Fatalf("CleanRelativeFilename() = %q, want %q", got, want)
	}
}

func TestCleanRelativeFilenameFallsBackForEmptyPath(t *testing.T) {
	for _, value := range []string{"", ".", "..", "../.."} {
		if got := CleanRelativeFilename(value); got != "untitled.md" {
			t.Fatalf("CleanRelativeFilename(%q) = %q, want untitled.md", value, got)
		}
	}
}
