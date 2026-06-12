package app

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	configassets "github.com/mediago-dev/mediago-drama/packages/server/configs"
)

func archiveLegacyDocumentTemplates() {
	dir := configassets.SourceTemplateDir("documents")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("legacy document template directory scan failed", "dir", dir, "error", err)
		}
		return
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		files = append(files, entry.Name())
	}
	if len(files) == 0 {
		return
	}

	legacyDir := filepath.Join(dir, "legacy")
	if err := os.MkdirAll(legacyDir, 0o755); err != nil {
		slog.Warn("legacy document template archive directory unavailable", "dir", legacyDir, "error", err)
		return
	}

	archived := 0
	for _, name := range files {
		source := filepath.Join(dir, name)
		target := uniqueArchivePath(legacyDir, name)
		if err := os.Rename(source, target); err != nil {
			slog.Warn("legacy document template archive failed", "source", source, "target", target, "error", err)
			continue
		}
		archived++
	}
	if archived > 0 {
		slog.Warn("legacy document templates archived", "dir", dir, "legacy_dir", legacyDir, "count", archived)
	}
}

func uniqueArchivePath(dir string, name string) string {
	target := filepath.Join(dir, name)
	if _, err := os.Stat(target); os.IsNotExist(err) {
		return target
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	return filepath.Join(dir, fmt.Sprintf("%s-%s%s", stem, time.Now().UTC().Format("20060102T150405"), ext))
}
