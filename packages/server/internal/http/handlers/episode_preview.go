package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	servicedocument "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/document"
	servicemedia "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/media"
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

// EpisodePreviewStreamer supplies fragmented MP4 preview streaming.
type EpisodePreviewStreamer interface {
	StreamFragmentedMP4(ctx context.Context, writer io.Writer, files []string) error
}

// EpisodePreviewFileRenderer supplies seekable MP4 preview rendering.
type EpisodePreviewFileRenderer interface {
	RenderMP4(ctx context.Context, outputPath string, files []string) error
}

// EpisodePreview handles episode preview stream routes.
type EpisodePreview struct {
	timelines EpisodePreviewTimelineStore
	media     EpisodePreviewMediaStore
	streamer  EpisodePreviewStreamer
}

// NewEpisodePreview returns an episode preview route handler.
func NewEpisodePreview(timelines EpisodePreviewTimelineStore, media EpisodePreviewMediaStore, streamer EpisodePreviewStreamer) EpisodePreview {
	return EpisodePreview{timelines: timelines, media: media, streamer: streamer}
}

// HandleEpisodePreviewStream serves the generated video clips for an episode timeline.
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
	if renderer, ok := handler.streamer.(EpisodePreviewFileRenderer); ok {
		handler.serveRenderedPreview(context, renderer, files)
		return
	}

	handler.streamFragmentedPreview(context, files)
}

func (handler EpisodePreview) serveRenderedPreview(context *gin.Context, renderer EpisodePreviewFileRenderer, files []string) {
	tempFile, err := os.CreateTemp("", "mediago-episode-preview-*.mp4")
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	tempPath := tempFile.Name()
	if err := tempFile.Close(); err != nil {
		_ = os.Remove(tempPath)
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	defer os.Remove(tempPath)

	if err := renderer.RenderMP4(context.Request.Context(), tempPath, files); err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "预览视频渲染失败", err)
		return
	}

	file, err := os.Open(tempPath)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if info.Size() == 0 {
		httpresponse.Error(context, http.StatusInternalServerError, "预览视频渲染失败")
		return
	}

	writePreviewHeaders(context)
	http.ServeContent(context.Writer, context.Request, "episode-preview.mp4", info.ModTime(), file)
}

func (handler EpisodePreview) streamFragmentedPreview(context *gin.Context, files []string) {
	writePreviewHeaders(context)
	context.Status(http.StatusOK)
	writer := io.Writer(context.Writer)
	if flusher, ok := context.Writer.(http.Flusher); ok {
		writer = flushWriter{writer: context.Writer, flusher: flusher}
	}
	if err := handler.streamer.StreamFragmentedMP4(context.Request.Context(), writer, files); err != nil {
		_ = context.Error(err)
	}
}

func writePreviewHeaders(context *gin.Context) {
	context.Header("Content-Type", "video/mp4")
	context.Header("Content-Disposition", `inline; filename="episode-preview.mp4"`)
	context.Header("Cache-Control", "no-store")
	context.Header("X-Content-Type-Options", "nosniff")
}

type flushWriter struct {
	writer  io.Writer
	flusher http.Flusher
}

func (writer flushWriter) Write(data []byte) (int, error) {
	n, err := writer.writer.Write(data)
	writer.flusher.Flush()
	return n, err
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
		if segment != "media-assets" || index+2 >= len(segments) || segments[index+2] != "content" {
			continue
		}
		id, err := url.PathUnescape(segments[index+1])
		if err != nil {
			return "", false
		}
		id = strings.TrimSpace(id)
		return id, id != ""
	}
	return "", false
}
