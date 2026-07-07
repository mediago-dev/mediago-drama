package generation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"mime"
	"net/url"
	"path"
	"sort"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
)

const (
	stylePreviewDir      = "style-presets/previews"
	stylePromptCategory  = "style"
	stylePreviewURLBase  = "/api/v1/generation/style-previews/"
	stylePresetKindImage = string(coregeneration.KindImage)
)

// StylePromptSource lists reusable prompt entries; satisfied by the prompt
// library service. Style presets are the library's "style" category so the
// agent recommends exactly what the workbench and prompt packs manage.
type StylePromptSource interface {
	List(ctx context.Context, filter promptlibrary.Filter) ([]promptlibrary.PromptEntry, error)
}

// StylePreviewStore indexes bundled style preview images by prompt entry ID
// (file stem under style-presets/previews).
type StylePreviewStore struct {
	files fs.FS
	byID  map[string]stylePreviewEntry
	err   error
}

type stylePreviewEntry struct {
	URL      string
	MIMEType string
	Path     string
}

// NewStylePreviewStore scans the embedded preview directory. A missing
// directory is treated as an empty catalog.
func NewStylePreviewStore(files fs.FS) *StylePreviewStore {
	store := &StylePreviewStore{files: files, byID: map[string]stylePreviewEntry{}}
	if files == nil {
		return store
	}
	entries, err := fs.ReadDir(files, stylePreviewDir)
	if err != nil {
		if !fsValidFileMissing(err) {
			store.err = fmt.Errorf("reading style preview directory: %w", err)
		}
		return store
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		presetID := strings.TrimSuffix(name, path.Ext(name))
		if presetID == "" {
			continue
		}
		filePath := path.Join(stylePreviewDir, name)
		data, err := fs.ReadFile(files, filePath)
		if err != nil {
			store.err = fmt.Errorf("reading style preview %q: %w", filePath, err)
			return store
		}
		if existing, ok := store.byID[presetID]; ok {
			store.err = fmt.Errorf("duplicate style preview id %q (%s and %s)", presetID, existing.Path, filePath)
			return store
		}
		// Hash the content into the URL: the endpoint replies with an
		// immutable cache header, so the URL must change whenever the image does.
		digest := sha256.Sum256(data)
		store.byID[presetID] = stylePreviewEntry{
			URL:      stylePreviewURLBase + url.PathEscape(presetID) + "?v=" + hex.EncodeToString(digest[:4]),
			MIMEType: stylePreviewMIMEType(name),
			Path:     filePath,
		}
	}
	return store
}

// Lookup returns the preview URL and MIME type for one prompt entry ID.
func (store *StylePreviewStore) Lookup(presetID string) (string, string, bool) {
	if store == nil || store.err != nil {
		return "", "", false
	}
	entry, ok := store.byID[strings.TrimSpace(presetID)]
	if !ok {
		return "", "", false
	}
	return entry.URL, entry.MIMEType, true
}

// PreviewContent returns the bundled preview image for one prompt entry ID.
func (store *StylePreviewStore) PreviewContent(presetID string) (dto.GenerationStylePreset, []byte, bool, error) {
	if store == nil {
		return dto.GenerationStylePreset{}, nil, false, nil
	}
	if store.err != nil {
		return dto.GenerationStylePreset{}, nil, false, store.err
	}
	entry, ok := store.byID[strings.TrimSpace(presetID)]
	if !ok {
		return dto.GenerationStylePreset{}, nil, false, nil
	}
	data, err := fs.ReadFile(store.files, entry.Path)
	if err != nil {
		return dto.GenerationStylePreset{}, nil, false, fmt.Errorf("reading style preview %q: %w", entry.Path, err)
	}
	preset := dto.GenerationStylePreset{ID: strings.TrimSpace(presetID), PreviewURL: entry.URL, MIMEType: entry.MIMEType}
	return preset, data, true, nil
}

func stylePreviewMIMEType(filename string) string {
	switch strings.ToLower(path.Ext(filename)) {
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	}
	if mimeType := mime.TypeByExtension(path.Ext(filename)); mimeType != "" {
		return mimeType
	}
	return "application/octet-stream"
}

// stylePresetsFromLibrary assembles agent-facing style presets from the prompt
// library's style category, attaching bundled preview images where available.
func stylePresetsFromLibrary(ctx context.Context, source StylePromptSource, previews *StylePreviewStore) []dto.GenerationStylePreset {
	if source == nil {
		return nil
	}
	entries, err := source.List(ctx, promptlibrary.Filter{Category: stylePromptCategory})
	if err != nil {
		return nil
	}
	presets := make([]dto.GenerationStylePreset, 0, len(entries))
	for _, entry := range entries {
		promptSuffix := strings.TrimSpace(entry.Prompt)
		if entry.ID == "" || promptSuffix == "" {
			continue
		}
		preset := dto.GenerationStylePreset{
			ID:           entry.ID,
			Title:        firstNonEmpty(entry.Name, entry.ID),
			Kinds:        []string{stylePresetKindImage},
			PromptSuffix: promptSuffix,
		}
		if previewURL, mimeType, ok := previews.Lookup(entry.ID); ok {
			preset.PreviewURL = previewURL
			preset.MIMEType = mimeType
		}
		presets = append(presets, preset)
	}
	sort.SliceStable(presets, func(left int, right int) bool {
		// Presets with bundled previews first: they make better selection cards.
		return presets[left].PreviewURL != "" && presets[right].PreviewURL == ""
	})
	return presets
}
