package generation

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/url"
	"path"
	"sort"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
)

const (
	voicePreviewRoot         = "voice-previews"
	voicePreviewManifestPath = voicePreviewRoot + "/manifest.json"
)

// VoicePreviewStore indexes bundled voice preview audio files.
type VoicePreviewStore struct {
	files  fs.FS
	assets []dto.GenerationVoicePreviewAsset
	byKey  map[string]voicePreviewEntry
	err    error
}

type voicePreviewManifest struct {
	SchemaVersion int                         `json:"schemaVersion"`
	Previews      []voicePreviewManifestEntry `json:"previews"`
}

type voicePreviewManifestEntry struct {
	RouteID  string `json:"routeId"`
	VoiceID  string `json:"voiceId"`
	Path     string `json:"path"`
	MIMEType string `json:"mimeType,omitempty"`
}

type voicePreviewEntry struct {
	Asset dto.GenerationVoicePreviewAsset
	Path  string
}

// NewVoicePreviewStore loads the embedded preview manifest. A missing manifest is treated as an empty catalog.
func NewVoicePreviewStore(files fs.FS) *VoicePreviewStore {
	store := &VoicePreviewStore{
		files: files,
		byKey: map[string]voicePreviewEntry{},
	}
	if files == nil {
		return store
	}

	data, err := fs.ReadFile(files, voicePreviewManifestPath)
	if err != nil {
		if !fsValidFileMissing(err) {
			store.err = fmt.Errorf("reading voice preview manifest: %w", err)
		}
		return store
	}

	var manifest voicePreviewManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		store.err = fmt.Errorf("parsing voice preview manifest: %w", err)
		return store
	}
	if manifest.SchemaVersion != 1 {
		store.err = fmt.Errorf("unsupported voice preview manifest schema version %d", manifest.SchemaVersion)
		return store
	}

	for index, item := range manifest.Previews {
		entry, err := store.manifestEntry(item)
		if err != nil {
			store.err = fmt.Errorf("voice preview manifest entry %d: %w", index, err)
			return store
		}
		key := voicePreviewKey(entry.Asset.RouteID, entry.Asset.VoiceID)
		store.byKey[key] = entry
		store.assets = append(store.assets, entry.Asset)
	}
	sort.Slice(store.assets, func(left int, right int) bool {
		if store.assets[left].RouteID == store.assets[right].RouteID {
			return store.assets[left].VoiceID < store.assets[right].VoiceID
		}
		return store.assets[left].RouteID < store.assets[right].RouteID
	})
	return store
}

func fsValidFileMissing(err error) bool {
	return errors.Is(err, fs.ErrNotExist)
}

func (store *VoicePreviewStore) manifestEntry(item voicePreviewManifestEntry) (voicePreviewEntry, error) {
	routeID := strings.TrimSpace(item.RouteID)
	voiceID := strings.TrimSpace(item.VoiceID)
	relativePath := strings.TrimSpace(item.Path)
	if routeID == "" {
		return voicePreviewEntry{}, fmt.Errorf("missing routeId")
	}
	if voiceID == "" {
		return voicePreviewEntry{}, fmt.Errorf("missing voiceId")
	}
	if err := validateBuiltInVoicePreview(routeID, voiceID); err != nil {
		return voicePreviewEntry{}, err
	}
	if relativePath == "" {
		return voicePreviewEntry{}, fmt.Errorf("missing path")
	}
	if !fs.ValidPath(relativePath) || strings.HasPrefix(relativePath, "../") || strings.Contains(relativePath, "/../") {
		return voicePreviewEntry{}, fmt.Errorf("invalid path %q", relativePath)
	}

	filePath := path.Join(voicePreviewRoot, relativePath)
	fileInfo, err := fs.Stat(store.files, filePath)
	if err != nil {
		return voicePreviewEntry{}, fmt.Errorf("stat %q: %w", filePath, err)
	}
	if fileInfo.IsDir() {
		return voicePreviewEntry{}, fmt.Errorf("path %q is a directory", filePath)
	}

	mimeType := strings.TrimSpace(item.MIMEType)
	if mimeType == "" {
		mimeType = voicePreviewMIMEType(relativePath)
	}
	asset := dto.GenerationVoicePreviewAsset{
		RouteID:  routeID,
		VoiceID:  voiceID,
		URL:      voicePreviewURL(routeID, voiceID),
		MIMEType: mimeType,
	}
	return voicePreviewEntry{Asset: asset, Path: filePath}, nil
}

func validateBuiltInVoicePreview(routeID string, voiceID string) error {
	route, ok := coregeneration.FindRoute(routeID)
	if !ok {
		return fmt.Errorf("unknown routeId %q", routeID)
	}
	if route.Kind != coregeneration.KindAudio {
		return fmt.Errorf("routeId %q is %s, not audio", routeID, route.Kind)
	}
	for _, param := range route.Params {
		if param.Name != string(coregeneration.ParamVoiceID) {
			continue
		}
		for _, option := range param.Options {
			if option.Value == voiceID {
				return nil
			}
		}
		return fmt.Errorf("voiceId %q is not a built-in voice for routeId %q", voiceID, routeID)
	}
	return fmt.Errorf("routeId %q has no built-in voiceId options", routeID)
}

func voicePreviewMIMEType(filename string) string {
	switch strings.ToLower(path.Ext(filename)) {
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".wav":
		return "audio/wav"
	case ".webm":
		return "audio/webm"
	}
	if mimeType := mime.TypeByExtension(path.Ext(filename)); mimeType != "" {
		return mimeType
	}
	return "application/octet-stream"
}

func voicePreviewURL(routeID string, voiceID string) string {
	return "/api/v1/generation/voice-previews/" + url.PathEscape(routeID) + "/" + url.PathEscape(voiceID)
}

func voicePreviewKey(routeID string, voiceID string) string {
	return strings.TrimSpace(routeID) + "\x00" + strings.TrimSpace(voiceID)
}

// List returns previewable route/voice pairs.
func (store *VoicePreviewStore) List() ([]dto.GenerationVoicePreviewAsset, error) {
	if store == nil {
		return nil, nil
	}
	if store.err != nil {
		return nil, store.err
	}
	assets := make([]dto.GenerationVoicePreviewAsset, len(store.assets))
	copy(assets, store.assets)
	return assets, nil
}

// Asset returns the local preview asset metadata for a route/voice pair.
func (store *VoicePreviewStore) Asset(routeID string, voiceID string) (dto.GenerationVoicePreviewAsset, bool, error) {
	if store == nil {
		return dto.GenerationVoicePreviewAsset{}, false, nil
	}
	if store.err != nil {
		return dto.GenerationVoicePreviewAsset{}, false, store.err
	}
	entry, ok := store.byKey[voicePreviewKey(routeID, voiceID)]
	return entry.Asset, ok, nil
}

// Content returns the bundled preview file content for a route/voice pair.
func (store *VoicePreviewStore) Content(routeID string, voiceID string) (dto.GenerationVoicePreviewAsset, []byte, bool, error) {
	if store == nil {
		return dto.GenerationVoicePreviewAsset{}, nil, false, nil
	}
	if store.err != nil {
		return dto.GenerationVoicePreviewAsset{}, nil, false, store.err
	}
	entry, ok := store.byKey[voicePreviewKey(routeID, voiceID)]
	if !ok {
		return dto.GenerationVoicePreviewAsset{}, nil, false, nil
	}
	data, err := fs.ReadFile(store.files, entry.Path)
	if err != nil {
		return dto.GenerationVoicePreviewAsset{}, nil, false, fmt.Errorf("reading voice preview %q: %w", entry.Path, err)
	}
	return entry.Asset, data, true, nil
}
