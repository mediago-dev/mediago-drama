package acp

import (
	"bufio"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func codexGeneratedProjectAssetURL(projectID, imagePath string) string {
	seed := strings.TrimSpace(projectID) + "\x00" + filepath.Base(imagePath)
	sum := sha1.Sum([]byte(seed))
	assetID := "asset-file-" + hex.EncodeToString(sum[:])[:16]
	return fmt.Sprintf("/api/v1/projects/%s/assets/%s/content", strings.TrimSpace(projectID), assetID)
}

// importCodexGeneratedImages bridges Codex built-in image results into the
// project's work directory, where the existing asset synchronizer registers them.
func importCodexGeneratedImages(acpSessionID, projectDir string, since time.Time) ([]string, error) {
	acpSessionID = strings.TrimSpace(acpSessionID)
	projectDir = strings.TrimSpace(projectDir)
	if acpSessionID == "" || projectDir == "" {
		return nil, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	root := filepath.Join(home, ".codex", "sessions")
	var sessionPath string
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		if strings.Contains(entry.Name(), acpSessionID) && strings.HasSuffix(entry.Name(), ".jsonl") {
			sessionPath = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil || sessionPath == "" {
		return nil, err
	}
	file, err := os.Open(sessionPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	workDir := filepath.Join(projectDir, "work")
	if err := os.MkdirAll(workDir, 0o700); err != nil {
		return nil, err
	}

	seen := map[string]struct{}{}
	var imported []string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 64*1024*1024)
	for scanner.Scan() {
		var row any
		if json.Unmarshal(scanner.Bytes(), &row) != nil || !codexRowIsRecent(row, since) {
			continue
		}
		var urls []string
		collectCodexImageDataURLs(row, &urls)
		for _, dataURL := range urls {
			mimeType, encoded, ok := strings.Cut(strings.TrimPrefix(dataURL, "data:"), ";base64,")
			if !ok || !strings.HasPrefix(mimeType, "image/") {
				continue
			}
			data, decodeErr := base64.StdEncoding.DecodeString(encoded)
			if decodeErr != nil || len(data) == 0 {
				continue
			}
			sum := sha256.Sum256(data)
			key := hex.EncodeToString(sum[:8])
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			ext := ".png"
			if mimeType == "image/jpeg" {
				ext = ".jpg"
			} else if mimeType == "image/webp" {
				ext = ".webp"
			}
			path := filepath.Join(workDir, fmt.Sprintf("codex-generated-%s%s", key, ext))
			if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
				if writeErr := os.WriteFile(path, data, 0o600); writeErr != nil {
					return imported, writeErr
				}
			}
			imported = append(imported, path)
		}
	}
	return imported, scanner.Err()
}

func codexRowIsRecent(value any, since time.Time) bool {
	row, ok := value.(map[string]any)
	if !ok || since.IsZero() {
		return true
	}
	raw, _ := row["timestamp"].(string)
	stamp, err := time.Parse(time.RFC3339Nano, raw)
	return err != nil || !stamp.Before(since.Add(-2*time.Second))
}

func collectCodexImageDataURLs(value any, output *[]string) {
	switch typed := value.(type) {
	case string:
		if strings.HasPrefix(typed, "data:image/") && strings.Contains(typed, ";base64,") {
			*output = append(*output, typed)
		}
	case []any:
		for _, item := range typed {
			collectCodexImageDataURLs(item, output)
		}
	case map[string]any:
		for _, item := range typed {
			collectCodexImageDataURLs(item, output)
		}
	}
}
