package repository

import (
	"path/filepath"
	"testing"
)

func TestAPIKeyStoreSetGetAndClear(t *testing.T) {
	store := NewAPIKeyStore(filepath.Join(t.TempDir(), "settings.sqlite"))

	value, source, err := store.Get("openrouter")
	if err != nil {
		t.Fatalf("Get missing key returned error: %v", err)
	}
	if value != "" || source != "none" {
		t.Fatalf("Get missing key = (%q, %q), want empty none", value, source)
	}

	if err := store.Set("openrouter", "  sk-test  "); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}
	value, source, err = store.Get("openrouter")
	if err != nil {
		t.Fatalf("Get stored key returned error: %v", err)
	}
	if value != "sk-test" || source != "settings" {
		t.Fatalf("Get stored key = (%q, %q), want trimmed settings value", value, source)
	}

	if err := store.Clear("openrouter"); err != nil {
		t.Fatalf("Clear returned error: %v", err)
	}
	value, source, err = store.Get("openrouter")
	if err != nil {
		t.Fatalf("Get cleared key returned error: %v", err)
	}
	if value != "" || source != "none" {
		t.Fatalf("Get cleared key = (%q, %q), want empty none", value, source)
	}
}
