package generation

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net/url"
	"path"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
)

const (
	stylePresetRoot         = "style-presets"
	stylePresetManifestPath = stylePresetRoot + "/manifest.json"
)

// StylePresetStore indexes bundled visual style presets and their preview images.
type StylePresetStore struct {
	files   fs.FS
	presets []dto.GenerationStylePreset
	byID    map[string]stylePresetEntry
	err     error
}

type stylePresetManifest struct {
	SchemaVersion int                        `json:"schemaVersion"`
	Presets       []stylePresetManifestEntry `json:"presets"`
}

type stylePresetManifestEntry struct {
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	Description  string         `json:"description,omitempty"`
	Kinds        []string       `json:"kinds,omitempty"`
	RouteID      string         `json:"routeId,omitempty"`
	PromptSuffix string         `json:"promptSuffix"`
	Params       map[string]any `json:"params,omitempty"`
	PreviewPath  string         `json:"previewPath,omitempty"`
	MIMEType     string         `json:"mimeType,omitempty"`
}

type stylePresetEntry struct {
	Preset      dto.GenerationStylePreset
	PreviewPath string
}

// NewStylePresetStore loads the embedded style preset manifest. A missing
// manifest is treated as an empty catalog.
func NewStylePresetStore(files fs.FS) *StylePresetStore {
	store := &StylePresetStore{
		files: files,
		byID:  map[string]stylePresetEntry{},
	}
	if files == nil {
		return store
	}

	data, err := fs.ReadFile(files, stylePresetManifestPath)
	if err != nil {
		if !fsValidFileMissing(err) {
			store.err = fmt.Errorf("reading style preset manifest: %w", err)
		}
		return store
	}

	var manifest stylePresetManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		store.err = fmt.Errorf("parsing style preset manifest: %w", err)
		return store
	}
	if manifest.SchemaVersion != 1 {
		store.err = fmt.Errorf("unsupported style preset manifest schema version %d", manifest.SchemaVersion)
		return store
	}

	for index, item := range manifest.Presets {
		entry, err := store.manifestEntry(item)
		if err != nil {
			store.err = fmt.Errorf("style preset manifest entry %d: %w", index, err)
			return store
		}
		if _, exists := store.byID[entry.Preset.ID]; exists {
			store.err = fmt.Errorf("style preset manifest entry %d: duplicate id %q", index, entry.Preset.ID)
			return store
		}
		store.byID[entry.Preset.ID] = entry
		store.presets = append(store.presets, entry.Preset)
	}
	return store
}

func (store *StylePresetStore) manifestEntry(item stylePresetManifestEntry) (stylePresetEntry, error) {
	presetID := strings.TrimSpace(item.ID)
	title := strings.TrimSpace(item.Title)
	promptSuffix := strings.TrimSpace(item.PromptSuffix)
	if presetID == "" {
		return stylePresetEntry{}, fmt.Errorf("missing id")
	}
	if title == "" {
		return stylePresetEntry{}, fmt.Errorf("missing title")
	}
	if promptSuffix == "" {
		return stylePresetEntry{}, fmt.Errorf("missing promptSuffix")
	}
	if routeID := strings.TrimSpace(item.RouteID); routeID != "" {
		if _, ok := coregeneration.FindRoute(routeID); !ok {
			return stylePresetEntry{}, fmt.Errorf("unknown routeId %q", routeID)
		}
	}
	kinds := CompactStrings(item.Kinds)
	if len(kinds) == 0 {
		kinds = []string{string(coregeneration.KindImage)}
	}

	preset := dto.GenerationStylePreset{
		ID:           presetID,
		Title:        title,
		Description:  strings.TrimSpace(item.Description),
		Kinds:        kinds,
		RouteID:      strings.TrimSpace(item.RouteID),
		PromptSuffix: promptSuffix,
		Params:       item.Params,
	}

	previewPath := strings.TrimSpace(item.PreviewPath)
	if previewPath == "" {
		return stylePresetEntry{Preset: preset}, nil
	}
	if !fs.ValidPath(previewPath) || strings.HasPrefix(previewPath, "../") || strings.Contains(previewPath, "/../") {
		return stylePresetEntry{}, fmt.Errorf("invalid previewPath %q", previewPath)
	}
	filePath := path.Join(stylePresetRoot, previewPath)
	fileInfo, err := fs.Stat(store.files, filePath)
	if err != nil {
		return stylePresetEntry{}, fmt.Errorf("stat %q: %w", filePath, err)
	}
	if fileInfo.IsDir() {
		return stylePresetEntry{}, fmt.Errorf("previewPath %q is a directory", filePath)
	}
	mimeType := strings.TrimSpace(item.MIMEType)
	if mimeType == "" {
		mimeType = stylePreviewMIMEType(previewPath)
	}
	preset.PreviewURL = stylePreviewURL(presetID)
	preset.MIMEType = mimeType
	return stylePresetEntry{Preset: preset, PreviewPath: filePath}, nil
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

func stylePreviewURL(presetID string) string {
	return "/api/v1/generation/style-previews/" + url.PathEscape(presetID)
}

// List returns the bundled style presets in manifest order.
func (store *StylePresetStore) List() ([]dto.GenerationStylePreset, error) {
	if store == nil {
		return nil, nil
	}
	if store.err != nil {
		return nil, store.err
	}
	presets := make([]dto.GenerationStylePreset, len(store.presets))
	copy(presets, store.presets)
	return presets, nil
}

// PreviewContent returns the bundled preview image for one preset.
func (store *StylePresetStore) PreviewContent(presetID string) (dto.GenerationStylePreset, []byte, bool, error) {
	if store == nil {
		return dto.GenerationStylePreset{}, nil, false, nil
	}
	if store.err != nil {
		return dto.GenerationStylePreset{}, nil, false, store.err
	}
	entry, ok := store.byID[strings.TrimSpace(presetID)]
	if !ok || entry.PreviewPath == "" {
		return dto.GenerationStylePreset{}, nil, false, nil
	}
	data, err := fs.ReadFile(store.files, entry.PreviewPath)
	if err != nil {
		return dto.GenerationStylePreset{}, nil, false, fmt.Errorf("reading style preview %q: %w", entry.PreviewPath, err)
	}
	return entry.Preset, data, true, nil
}
