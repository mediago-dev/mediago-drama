package shared

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
)

// WriteJSONFile writes pretty JSON, creating parent directories first.
func WriteJSONFile(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating %s directory: %w", filepath.Base(path), err)
	}
	data, err := json.MarshalIndent(value, "", "\t")
	if err != nil {
		return fmt.Errorf("encoding %s: %w", filepath.Base(path), err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", filepath.Base(path), err)
	}
	return nil
}

// WriteJSONFileIfMissing writes pretty JSON only when the target file is absent.
func WriteJSONFileIfMissing(path string, value any) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("checking %s: %w", filepath.Base(path), err)
	}
	return WriteJSONFile(path, value)
}

// WriteTextFileIfMissing writes text only when the target file is absent.
func WriteTextFileIfMissing(path string, content string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("checking %s: %w", filepath.Base(path), err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating %s directory: %w", filepath.Base(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", filepath.Base(path), err)
	}
	return nil
}

func writeTextFileIfMissing(path string, content string) error {
	return WriteTextFileIfMissing(path, content)
}

// FallbackWorkspaceID returns a stable workspace ID from a directory name.
func FallbackWorkspaceID(dir string) string {
	base := domain.CleanProjectID(filepath.Base(dir))
	if base == "" {
		base = "workspace"
	}
	return "workspace-" + strings.ToLower(base)
}

// CleanRelativeFilename returns a safe relative filename.
func CleanRelativeFilename(filename string) string {
	filename = strings.TrimSpace(filepath.ToSlash(filename))
	if filename == "" {
		return "untitled.md"
	}

	parts := strings.Split(filename, "/")
	cleanParts := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || part == "." || part == ".." {
			continue
		}
		cleaned := strings.Map(func(r rune) rune {
			switch r {
			case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
				return '-'
			default:
				return r
			}
		}, part)
		cleaned = strings.Trim(cleaned, ". ")
		if cleaned == "" {
			continue
		}
		cleanParts = append(cleanParts, cleaned)
	}
	if len(cleanParts) == 0 {
		return "untitled.md"
	}
	return filepath.Join(cleanParts...)
}
