package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
)

// EpisodePreviewTimelineStore supplies persisted episode timeline state.
type EpisodePreviewTimelineStore interface {
	GetEpisodeTimelineState(projectID string, documentID string) (servicedocument.EpisodeTimelineStateResponse, bool, error)
}

// EpisodePreviewMediaStore supplies generated media files.
type EpisodePreviewMediaStore interface {
	Get(id string) (servicemedia.MediaAsset, bool, error)
	ServeFilePath(asset servicemedia.MediaAsset) (string, error)
}

// EpisodePreviewStreamer renders episode previews into seekable MP4 files.
type EpisodePreviewStreamer interface {
	RenderMP4(ctx context.Context, outputPath string, files []string) error
}

// EpisodePreview handles episode preview stream routes.
type EpisodePreview struct {
	timelines EpisodePreviewTimelineStore
	media     EpisodePreviewMediaStore
	streamer  EpisodePreviewStreamer
	cacheDir  string
}

// NewEpisodePreview returns an episode preview route handler.
func NewEpisodePreview(timelines EpisodePreviewTimelineStore, media EpisodePreviewMediaStore, streamer EpisodePreviewStreamer) EpisodePreview {
	return EpisodePreview{timelines: timelines, media: media, streamer: streamer}
}

// HandleEpisodePreviewStream godoc
// @Summary 获取剧集预览视频
// @Description 将剧集时间线中的视频片段组合为可拖动进度的预览 MP4（支持 Range 请求）。
// @Tags Episodes
// @Produce video/mp4
// @Param projectId path string true "Project ID"
// @Param documentId path string true "Document ID"
// @Success 200 {file} file
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/projects/{projectId}/workspace/episodes/{documentId}/preview.mp4 [get]
func (handler EpisodePreview) HandleEpisodePreviewStream(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	documentID, ok := requiredPathParam(context, "documentId", "documentId")
	if !ok {
		return
	}
	if handler.streamer == nil {
		httpresponse.Error(context, http.StatusServiceUnavailable, "ffmpeg is not configured")
		return
	}

	state, ok, err := handler.timelines.GetEpisodeTimelineState(projectID, documentID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !ok {
		httpresponse.Error(context, http.StatusNotFound, "剪辑台状态不存在")
		return
	}

	videoURLs, err := playableEpisodeVideoURLs(state.Episode)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if len(videoURLs) == 0 {
		httpresponse.Error(context, http.StatusNotFound, "暂无可连播的视频片段")
		return
	}

	files, status, err := handler.previewFiles(projectID, videoURLs)
	if err != nil {
		httpresponse.ErrorFromStatus(context, status, err)
		return
	}
	if ready, ok := handler.streamer.(interface{ Ready() error }); ok {
		if err := ready.Ready(); err != nil {
			httpresponse.ErrorFromStatus(context, http.StatusServiceUnavailable, err)
			return
		}
	}
	handler.serveRenderedPreview(context, files)
}

// serveRenderedPreview renders the concatenated clips into a seekable MP4 and
// serves it with HTTP range support so the browser can play and scrub it.
func (handler EpisodePreview) serveRenderedPreview(context *gin.Context, files []string) {
	cachePath, err := handler.renderPreviewFile(context.Request.Context(), files)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "预览生成失败", err)
		return
	}

	file, err := os.Open(cachePath)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "预览读取失败", err)
		return
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "预览读取失败", err)
		return
	}

	context.Header("Content-Type", "video/mp4")
	context.Header("Content-Disposition", `inline; filename="episode-preview.mp4"`)
	context.Header("Cache-Control", "no-store")
	context.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(context.Writer, context.Request, "episode-preview.mp4", info.ModTime(), file)
}

// renderPreviewFile renders the preview into a cache file keyed by its source
// clips, rebuilding only when the underlying media changes. Concurrent requests
// for the same preview share a single render.
func (handler EpisodePreview) renderPreviewFile(ctx context.Context, files []string) (string, error) {
	cacheDir := handler.previewCacheDir()
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", fmt.Errorf("creating preview cache dir: %w", err)
	}
	key, err := previewCacheKey(files)
	if err != nil {
		return "", err
	}
	cachePath := filepath.Join(cacheDir, key+".mp4")

	unlock := lockPreviewKey(cachePath)
	defer unlock()

	if info, statErr := os.Stat(cachePath); statErr == nil && info.Size() > 0 {
		return cachePath, nil
	}

	tmpPath := cachePath + ".tmp"
	_ = os.Remove(tmpPath)
	if err := handler.streamer.RenderMP4(ctx, tmpPath, files); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := os.Rename(tmpPath, cachePath); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("finalizing preview cache: %w", err)
	}
	return cachePath, nil
}

func (handler EpisodePreview) previewCacheDir() string {
	if dir := strings.TrimSpace(handler.cacheDir); dir != "" {
		return dir
	}
	return filepath.Join(os.TempDir(), "mediago-episode-preview")
}

var previewKeyLocks sync.Map // map[string]*sync.Mutex

func lockPreviewKey(key string) func() {
	value, _ := previewKeyLocks.LoadOrStore(key, &sync.Mutex{})
	mutex := value.(*sync.Mutex)
	mutex.Lock()
	return mutex.Unlock
}

func previewCacheKey(files []string) (string, error) {
	hasher := sha256.New()
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil {
			return "", fmt.Errorf("stat preview source %q: %w", file, err)
		}
		fmt.Fprintf(hasher, "%s|%d|%d\n", file, info.Size(), info.ModTime().UnixNano())
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func (handler EpisodePreview) previewFiles(projectID string, videoURLs []string) ([]string, int, error) {
	if handler.media == nil {
		return nil, http.StatusServiceUnavailable, errors.New("media assets are not configured")
	}

	files := make([]string, 0, len(videoURLs))
	for _, videoURL := range videoURLs {
		assetID, ok := mediaAssetIDFromURL(videoURL)
		if !ok {
			return nil, http.StatusBadRequest, fmt.Errorf("unsupported media asset url %q", videoURL)
		}
		asset, ok, err := handler.media.Get(assetID)
		if err != nil {
			return nil, http.StatusInternalServerError, err
		}
		if !ok {
			return nil, http.StatusNotFound, fmt.Errorf("media asset %q was not found", assetID)
		}
		if strings.TrimSpace(asset.ProjectID) != "" && asset.ProjectID != projectID {
			return nil, http.StatusNotFound, fmt.Errorf("media asset %q was not found", assetID)
		}
		if asset.Kind != servicemedia.MediaKindVideo {
			return nil, http.StatusBadRequest, fmt.Errorf("media asset %q is not a video", assetID)
		}
		file, err := handler.media.ServeFilePath(asset)
		if err != nil {
			return nil, http.StatusNotFound, fmt.Errorf("media asset %q was not found", assetID)
		}
		files = append(files, file)
	}
	return files, http.StatusOK, nil
}

type episodePreviewEpisode struct {
	Tracks []episodePreviewTrack `json:"tracks"`
}

type episodePreviewTrack struct {
	Type  string               `json:"type"`
	Clips []episodePreviewClip `json:"clips"`
}

type episodePreviewClip struct {
	Start    float64 `json:"start"`
	End      float64 `json:"end"`
	Status   string  `json:"status"`
	VideoURL string  `json:"videoUrl"`
}

func playableEpisodeVideoURLs(raw json.RawMessage) ([]string, error) {
	var episode episodePreviewEpisode
	if err := json.Unmarshal(raw, &episode); err != nil {
		return nil, fmt.Errorf("episode must be valid JSON: %w", err)
	}
	for _, track := range episode.Tracks {
		if strings.TrimSpace(track.Type) != "video" {
			continue
		}
		clips := append([]episodePreviewClip(nil), track.Clips...)
		sort.SliceStable(clips, func(first, second int) bool {
			return clips[first].Start < clips[second].Start
		})
		return playableVideoURLsFromClips(clips), nil
	}
	return []string{}, nil
}

func playableVideoURLsFromClips(clips []episodePreviewClip) []string {
	urls := []string{}
	for _, clip := range clips {
		videoURL := strings.TrimSpace(clip.VideoURL)
		if strings.TrimSpace(clip.Status) != "ready" || videoURL == "" {
			continue
		}
		urls = append(urls, videoURL)
	}
	return urls
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
