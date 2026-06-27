package jianyingdraft

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	draftlib "github.com/mediago-dev/mediago-drama/packages/jianyingdraft/pkg/jianyingdraft"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
	servicesettings "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

// Export errors returned by the Jianying draft export service.
var (
	ErrDraftRootNotConfigured = errors.New("jianying draft root is not configured")
	ErrEpisodeNotFound        = errors.New("episode timeline state not found")
	ErrNoExportableShots      = errors.New("no exportable storyboard videos")
	ErrUnsupportedMediaURL    = errors.New("unsupported media asset url")
	ErrMediaAssetNotFound     = errors.New("media asset not found")
	ErrMediaAssetInvalid      = errors.New("media asset is invalid")
)

// TimelineStore supplies persisted episode timeline state.
type TimelineStore interface {
	GetEpisodeTimelineState(projectID string, documentID string) (servicedocument.EpisodeTimelineStateResponse, bool, error)
}

// MediaStore supplies local media files referenced by an episode.
type MediaStore interface {
	Get(id string) (servicemedia.MediaAsset, bool, error)
	ServeFilePath(asset servicemedia.MediaAsset) (string, error)
}

// SettingsStore supplies Jianying draft settings.
type SettingsStore interface {
	GetJianyingDraftSettings(ctx context.Context) (servicesettings.JianyingDraftSettings, error)
}

// Service exports episode timelines to Jianying draft folders.
type Service struct {
	timelines      TimelineStore
	media          MediaStore
	settings       SettingsStore
	metadataReader draftlib.MetadataReader
	now            func() time.Time
}

// NewService creates a Jianying draft export service.
func NewService(timelines TimelineStore, media MediaStore, settings SettingsStore, metadataReader draftlib.MetadataReader) *Service {
	if metadataReader == nil {
		metadataReader = draftlib.FFProbeReader{}
	}
	return &Service{
		timelines:      timelines,
		media:          media,
		settings:       settings,
		metadataReader: metadataReader,
		now:            time.Now,
	}
}

// ExportRequest describes one Jianying draft export request.
type ExportRequest struct {
	DraftName       string `json:"draftName,omitempty"`
	DraftsRoot      string `json:"draftsRoot,omitempty"`
	ReplaceExisting bool   `json:"replaceExisting,omitempty"`
	CopyMedia       bool   `json:"copyMedia,omitempty"`
}

// ExportResponse describes a completed Jianying draft export.
type ExportResponse struct {
	DraftName      string `json:"draftName"`
	DraftPath      string `json:"draftPath"`
	DurationMicros int64  `json:"durationMicros"`
	ShotCount      int    `json:"shotCount"`
	SkippedCount   int    `json:"skippedCount"`
}

// ExportEpisode writes a Jianying draft for a persisted episode timeline.
func (service *Service) ExportEpisode(ctx context.Context, projectID string, documentID string, request ExportRequest) (ExportResponse, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if service == nil {
		return ExportResponse{}, errors.New("jianying draft service is nil")
	}
	projectID = strings.TrimSpace(projectID)
	documentID = strings.TrimSpace(documentID)
	if projectID == "" {
		return ExportResponse{}, fmt.Errorf("%w: projectId is required", ErrMediaAssetInvalid)
	}
	if documentID == "" {
		return ExportResponse{}, fmt.Errorf("%w: documentId is required", ErrEpisodeNotFound)
	}
	if service.timelines == nil {
		return ExportResponse{}, errors.New("episode timeline store is unavailable")
	}
	if service.media == nil {
		return ExportResponse{}, errors.New("media asset store is unavailable")
	}

	state, ok, err := service.timelines.GetEpisodeTimelineState(projectID, documentID)
	if err != nil {
		return ExportResponse{}, err
	}
	if !ok {
		return ExportResponse{}, ErrEpisodeNotFound
	}

	var episode model.EpisodeRecord
	if err := json.Unmarshal(state.Episode, &episode); err != nil {
		return ExportResponse{}, fmt.Errorf("episode must be valid JSON: %w", err)
	}
	clips, skipped := exportableVideoClips(episode)
	if len(clips) == 0 {
		return ExportResponse{}, ErrNoExportableShots
	}

	draftsRoot, err := service.resolveDraftsRoot(ctx, request.DraftsRoot)
	if err != nil {
		return ExportResponse{}, err
	}
	draftName := strings.TrimSpace(request.DraftName)
	if draftName == "" {
		draftName = service.defaultDraftName(episode.Title)
	} else {
		draftName = sanitizeDraftName(draftName)
	}

	shots, metadataByPath, err := service.shotsForClips(ctx, projectID, clips)
	if err != nil {
		return ExportResponse{}, err
	}
	width, height := canvasSizeForAspectRatio(episode.AspectRatio)
	metadataReader := assetMetadataReader{
		fallback:       service.metadataReader,
		metadataByPath: metadataByPath,
	}
	draft := draftlib.NewDraft(draftlib.DraftOptions{
		Name:           draftName,
		Width:          width,
		Height:         height,
		FPS:            30,
		MetadataReader: metadataReader,
	})
	if err := draft.AddShotsContext(ctx, shots); err != nil {
		return ExportResponse{}, err
	}
	result, err := draft.ExportContext(ctx, draftsRoot, draftlib.ExportOptions{
		ReplaceExisting: request.ReplaceExisting,
		CopyMedia:       request.CopyMedia,
	})
	if err != nil {
		return ExportResponse{}, err
	}

	return ExportResponse{
		DraftName:      draftName,
		DraftPath:      result.DraftPath,
		DurationMicros: result.DurationMicros,
		ShotCount:      result.ShotCount,
		SkippedCount:   skipped,
	}, nil
}

func (service *Service) resolveDraftsRoot(ctx context.Context, requestRoot string) (string, error) {
	root := strings.TrimSpace(requestRoot)
	if root == "" {
		if service.settings == nil {
			return "", ErrDraftRootNotConfigured
		}
		settings, err := service.settings.GetJianyingDraftSettings(ctx)
		if err != nil {
			return "", err
		}
		root = strings.TrimSpace(settings.DraftsRoot)
	}
	if root == "" {
		return "", ErrDraftRootNotConfigured
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolving drafts root: %w", err)
	}
	return absolute, nil
}

func (service *Service) defaultDraftName(title string) string {
	now := time.Now
	if service != nil && service.now != nil {
		now = service.now
	}
	base := sanitizeDraftName(title)
	if base == "" {
		base = "剪映草稿"
	}
	return fmt.Sprintf("%s-%s", base, now().Format("20060102-150405"))
}

func (service *Service) shotsForClips(ctx context.Context, projectID string, clips []model.TimelineClipRecord) ([]draftlib.Shot, map[string]draftlib.VideoMetadata, error) {
	shots := make([]draftlib.Shot, 0, len(clips))
	metadataByPath := map[string]draftlib.VideoMetadata{}
	for index, clip := range clips {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		assetID, ok := mediaAssetIDFromURL(clip.VideoURL)
		if !ok {
			return nil, nil, fmt.Errorf("%w: %s", ErrUnsupportedMediaURL, clip.VideoURL)
		}
		asset, ok, err := service.media.Get(assetID)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			return nil, nil, fmt.Errorf("%w: %s", ErrMediaAssetNotFound, assetID)
		}
		if strings.TrimSpace(asset.ProjectID) != "" && asset.ProjectID != projectID {
			return nil, nil, fmt.Errorf("%w: %s", ErrMediaAssetNotFound, assetID)
		}
		if asset.Kind != servicemedia.MediaKindVideo {
			return nil, nil, fmt.Errorf("%w: media asset %s is not a video", ErrMediaAssetInvalid, assetID)
		}
		filePath, err := service.media.ServeFilePath(asset)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: %s", ErrMediaAssetNotFound, assetID)
		}
		shots = append(shots, draftlib.Shot{Path: filePath})
		if metadata, ok := metadataFromAsset(asset); ok {
			metadataByPath[filePath] = metadata
		}
		_ = index
	}
	return shots, metadataByPath, nil
}

func exportableVideoClips(episode model.EpisodeRecord) ([]model.TimelineClipRecord, int) {
	var clips []model.TimelineClipRecord
	total := 0
	for _, track := range episode.Tracks {
		if strings.TrimSpace(track.Type) != "video" {
			continue
		}
		candidates := append([]model.TimelineClipRecord(nil), track.Clips...)
		sort.SliceStable(candidates, func(first, second int) bool {
			return candidates[first].Start < candidates[second].Start ||
				(candidates[first].Start == candidates[second].Start &&
					candidates[first].End < candidates[second].End)
		})
		total = len(candidates)
		for _, clip := range candidates {
			if strings.TrimSpace(clip.Status) != "ready" || strings.TrimSpace(clip.VideoURL) == "" {
				continue
			}
			clips = append(clips, clip)
		}
		break
	}
	return clips, total - len(clips)
}

func metadataFromAsset(asset servicemedia.MediaAsset) (draftlib.VideoMetadata, bool) {
	if asset.DurationSeconds <= 0 || asset.Width <= 0 || asset.Height <= 0 {
		return draftlib.VideoMetadata{}, false
	}
	duration := int64(math.Round(asset.DurationSeconds * 1_000_000))
	if duration <= 0 {
		return draftlib.VideoMetadata{}, false
	}
	return draftlib.VideoMetadata{
		Duration: duration,
		Width:    asset.Width,
		Height:   asset.Height,
	}, true
}

type assetMetadataReader struct {
	fallback       draftlib.MetadataReader
	metadataByPath map[string]draftlib.VideoMetadata
}

func (reader assetMetadataReader) Probe(ctx context.Context, path string) (draftlib.VideoMetadata, error) {
	if reader.fallback != nil {
		metadata, err := reader.fallback.Probe(ctx, path)
		if err == nil {
			return metadata, nil
		}
	}
	if metadata, ok := reader.metadataByPath[path]; ok {
		return metadata, nil
	}
	return draftlib.VideoMetadata{}, errors.New("video metadata is unavailable")
}

func canvasSizeForAspectRatio(value string) (int, int) {
	switch strings.TrimSpace(value) {
	case "9:16":
		return 1080, 1920
	case "1:1":
		return 1080, 1080
	default:
		return 1920, 1080
	}
}

func sanitizeDraftName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return ' '
		default:
			return r
		}
	}, value)
	value = strings.Join(strings.Fields(value), " ")
	if len([]rune(value)) <= 60 {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:60]))
}

func mediaAssetIDFromURL(value string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}
	segments := strings.Split(parsed.Path, "/")
	for index, segment := range segments {
		switch {
		case segment == "media-assets" && index+2 < len(segments) && segments[index+2] == "content":
			return cleanMediaAssetIDSegment(segments[index+1])
		case segment == "media" &&
			index+3 < len(segments) &&
			segments[index+1] == "assets" &&
			segments[index+3] == "content":
			return cleanMediaAssetIDSegment(segments[index+2])
		}
	}
	return "", false
}

func cleanMediaAssetIDSegment(segment string) (string, bool) {
	id, err := url.PathUnescape(segment)
	if err != nil {
		return "", false
	}
	id = strings.TrimSpace(id)
	return id, id != ""
}
