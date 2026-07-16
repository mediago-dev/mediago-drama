package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveProtectedPackImporterPath(t *testing.T) {
	resourcesDir := t.TempDir()
	serverPath := filepath.Join(resourcesDir, "bin", "mediago-server")
	importerPath := filepath.Join(resourcesDir, "tools", "mediago-rights", protectedPackImporterExecutableName())
	if err := os.MkdirAll(filepath.Dir(serverPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(importerPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(importerPath, []byte("test"), 0o755); err != nil {
		t.Fatal(err)
	}
	previousExecutablePath := executablePath
	executablePath = func() (string, error) { return serverPath, nil }
	t.Cleanup(func() { executablePath = previousExecutablePath })
	setDefaultPromptPackPolicy(t, "marketplace")
	t.Setenv("MEDIAGO_PROMPT_PACK_IMPORTER_PATH", "")

	got, err := resolveProtectedPackImporterPath()
	if err != nil {
		t.Fatalf("resolveProtectedPackImporterPath() error = %v", err)
	}
	if got != importerPath {
		t.Fatalf("resolveProtectedPackImporterPath() = %q, want %q", got, importerPath)
	}
}

func TestResolveProtectedPackImporterPathPartnerPolicy(t *testing.T) {
	setDefaultPromptPackPolicy(t, "partner")
	t.Setenv("MEDIAGO_PROMPT_PACK_IMPORTER_PATH", "/marketplace-rights")
	got, err := resolveProtectedPackImporterPath()
	if err != nil {
		t.Fatalf("resolveProtectedPackImporterPath() error = %v", err)
	}
	if got != "/marketplace-rights" {
		t.Fatalf("resolveProtectedPackImporterPath() = %q, want shared marketplace importer", got)
	}
}

func TestUnprotectedPromptPackImportPolicy(t *testing.T) {
	t.Run("marketplace rejects unprotected imports", func(t *testing.T) {
		setDefaultPromptPackPolicy(t, "marketplace")
		allowed, err := unprotectedPromptPackImportAllowed()
		if err != nil {
			t.Fatal(err)
		}
		if allowed {
			t.Fatal("unprotectedPromptPackImportAllowed() = true, want false")
		}
	})
	t.Run("partner permits unprotected imports", func(t *testing.T) {
		setDefaultPromptPackPolicy(t, "partner")
		allowed, err := unprotectedPromptPackImportAllowed()
		if err != nil {
			t.Fatal(err)
		}
		if !allowed {
			t.Fatal("unprotectedPromptPackImportAllowed() = false, want true")
		}
	})
}

func TestResolveProtectedPackImporterPathRejectsUnknownPolicy(t *testing.T) {
	setDefaultPromptPackPolicy(t, "disabled")
	if _, err := resolveProtectedPackImporterPath(); err == nil {
		t.Fatal("resolveProtectedPackImporterPath() error = nil, want invalid policy error")
	}
}

func TestResolveProtectedPackImporterPathIgnoresRuntimePolicyOverride(t *testing.T) {
	setDefaultPromptPackPolicy(t, "partner")
	t.Setenv("MEDIAGO_PROMPT_PACK_POLICY", "marketplace")
	t.Setenv("MEDIAGO_PROMPT_PACK_IMPORTER_PATH", "/shared-marketplace-importer")

	got, err := resolveProtectedPackImporterPath()
	if err != nil {
		t.Fatalf("resolveProtectedPackImporterPath() error = %v", err)
	}
	if got != "/shared-marketplace-importer" {
		t.Fatalf("resolveProtectedPackImporterPath() = %q, want shared marketplace importer", got)
	}
}

func TestResolveProtectedPackImporterPathOfficialPolicyIgnoresRuntimePartnerOverride(t *testing.T) {
	setDefaultPromptPackPolicy(t, "marketplace")
	t.Setenv("MEDIAGO_PROMPT_PACK_POLICY", "partner")
	t.Setenv("MEDIAGO_PROMPT_PACK_IMPORTER_PATH", "/embedded-policy-still-uses-importer")

	got, err := resolveProtectedPackImporterPath()
	if err != nil {
		t.Fatalf("resolveProtectedPackImporterPath() error = %v", err)
	}
	if got != "/embedded-policy-still-uses-importer" {
		t.Fatalf("resolveProtectedPackImporterPath() = %q, want embedded marketplace policy importer", got)
	}
}

func setDefaultPromptPackPolicy(t *testing.T, policy string) {
	t.Helper()
	previous := defaultPromptPackPolicy
	defaultPromptPackPolicy = policy
	t.Cleanup(func() { defaultPromptPackPolicy = previous })
}
