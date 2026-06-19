package media

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const mediaMetadataTimeout = 45 * time.Second

type probedVideoMetadata struct {
	DurationSeconds float64
	Width           int
	Height          int
}

func (store *MediaAssets) enrichVideoMetadata(asset MediaAsset, updatedAt string) MediaAsset {
	asset.MetadataUpdatedAt = updatedAt

	metadata, err := store.probeVideoMetadata(asset.FilePath)
	if err != nil {
		asset.MetadataStatus = MetadataStatusFailed
		asset.MetadataError = err.Error()
		return asset
	}

	asset.DurationSeconds = metadata.DurationSeconds
	asset.Width = metadata.Width
	asset.Height = metadata.Height
	asset.MetadataStatus = MetadataStatusReady
	asset.MetadataError = ""

	posterPath, err := store.extractVideoPoster(asset.FilePath, asset.ID, metadata.DurationSeconds)
	if err != nil {
		asset.MetadataError = err.Error()
		return asset
	}
	asset.PosterPath = posterPath
	asset.PosterURL = "/api/v1/media-assets/" + url.PathEscape(asset.ID) + "/poster"
	return asset
}

func (store *MediaAssets) probeVideoMetadata(filePath string) (probedVideoMetadata, error) {
	ffprobePath, err := ResolveFFprobePath("", store.ffmpegBinDir)
	if err != nil {
		return probedVideoMetadata{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), mediaMetadataTimeout)
	defer cancel()
	output, err := exec.CommandContext(
		ctx,
		ffprobePath,
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_format",
		"-show_streams",
		filePath,
	).Output()
	if err != nil {
		return probedVideoMetadata{}, fmt.Errorf("probing video metadata: %w", err)
	}

	var payload ffprobePayload
	if err := json.Unmarshal(output, &payload); err != nil {
		return probedVideoMetadata{}, fmt.Errorf("parsing ffprobe metadata: %w", err)
	}
	metadata := metadataFromFFprobePayload(payload)
	if metadata.DurationSeconds <= 0 {
		return probedVideoMetadata{}, fmt.Errorf("video duration is unavailable")
	}
	return metadata, nil
}

func (store *MediaAssets) extractVideoPoster(filePath string, assetID string, durationSeconds float64) (string, error) {
	ffmpegPath, err := ResolveFFmpegPath(store.ffmpegPath, store.ffmpegBinDir)
	if err != nil {
		return "", err
	}

	posterPath := posterPathForVideo(filePath)
	seek := posterSeekTime(durationSeconds)
	ctx, cancel := context.WithTimeout(context.Background(), mediaMetadataTimeout)
	defer cancel()
	if err := exec.CommandContext(
		ctx,
		ffmpegPath,
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-ss",
		fmt.Sprintf("%.3f", seek),
		"-i",
		filePath,
		"-frames:v",
		"1",
		"-vf",
		"scale=640:-2:force_original_aspect_ratio=decrease",
		"-q:v",
		"3",
		posterPath,
	).Run(); err != nil {
		return "", fmt.Errorf("extracting video poster for %s: %w", assetID, err)
	}
	if info, err := os.Stat(posterPath); err != nil || info.Size() == 0 {
		if err != nil {
			return "", fmt.Errorf("checking video poster: %w", err)
		}
		return "", fmt.Errorf("video poster is empty")
	}
	return posterPath, nil
}

type ffprobePayload struct {
	Format  ffprobeFormat   `json:"format"`
	Streams []ffprobeStream `json:"streams"`
}

type ffprobeFormat struct {
	Duration string `json:"duration"`
}

type ffprobeStream struct {
	CodecType string `json:"codec_type"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Duration  string `json:"duration"`
}

func metadataFromFFprobePayload(payload ffprobePayload) probedVideoMetadata {
	metadata := probedVideoMetadata{
		DurationSeconds: parsePositiveFloat(payload.Format.Duration),
	}
	for _, stream := range payload.Streams {
		if strings.TrimSpace(stream.CodecType) != "video" {
			continue
		}
		metadata.Width = stream.Width
		metadata.Height = stream.Height
		if duration := parsePositiveFloat(stream.Duration); duration > metadata.DurationSeconds {
			metadata.DurationSeconds = duration
		}
		break
	}
	return metadata
}

func parsePositiveFloat(value string) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}

func posterPathForVideo(filePath string) string {
	extension := filepath.Ext(filePath)
	if extension == "" {
		return filePath + ".poster.jpg"
	}
	return strings.TrimSuffix(filePath, extension) + ".poster.jpg"
}

func posterSeekTime(durationSeconds float64) float64 {
	if durationSeconds <= 0 {
		return 0
	}
	if durationSeconds < 1 {
		return durationSeconds / 2
	}
	return 0.5
}
