package jianyingdraft

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// FFProbeReader reads video metadata by executing ffprobe.
type FFProbeReader struct {
	BinaryPath string
	BinDir     string
}

// Probe returns duration, width, and height for the first video stream.
func (reader FFProbeReader) Probe(ctx context.Context, path string) (VideoMetadata, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	absolutePath, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil {
		return VideoMetadata{}, fmt.Errorf("resolving video path: %w", err)
	}
	info, err := os.Stat(absolutePath)
	if err != nil {
		if os.IsNotExist(err) {
			return VideoMetadata{}, fmt.Errorf("video path does not exist: %s", absolutePath)
		}
		return VideoMetadata{}, err
	}
	if info.IsDir() {
		return VideoMetadata{}, fmt.Errorf("video path is a directory: %s", absolutePath)
	}

	binary, err := reader.resolveBinary()
	if err != nil {
		return VideoMetadata{}, err
	}
	output, err := exec.CommandContext(
		ctx,
		binary,
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_streams",
		"-show_format",
		absolutePath,
	).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			return VideoMetadata{}, fmt.Errorf("running ffprobe: %w", err)
		}
		return VideoMetadata{}, fmt.Errorf("running ffprobe: %w: %s", err, message)
	}
	return parseFFProbeMetadata(output)
}

func (reader FFProbeReader) resolveBinary() (string, error) {
	if path := strings.TrimSpace(reader.BinaryPath); path != "" {
		return path, nil
	}
	if dir := strings.TrimSpace(reader.BinDir); dir != "" {
		for _, name := range ffprobeBinaryNames() {
			for _, candidate := range []string{
				filepath.Join(dir, name),
				filepath.Join(dir, "ffprobe", name),
			} {
				if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
					return candidate, nil
				}
			}
		}
	}
	for _, name := range ffprobeBinaryNames() {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", errors.New("ffprobe not found; install ffmpeg and ensure ffprobe is on PATH")
}

func ffprobeBinaryNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"ffprobe.exe", "ffprobe"}
	}
	return []string{"ffprobe"}
}

type ffprobeOutput struct {
	Format  ffprobeFormat   `json:"format"`
	Streams []ffprobeStream `json:"streams"`
}

type ffprobeFormat struct {
	Duration string `json:"duration"`
}

type ffprobeStream struct {
	CodecType string `json:"codec_type"`
	Duration  string `json:"duration"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

func parseFFProbeMetadata(raw []byte) (VideoMetadata, error) {
	var payload ffprobeOutput
	if err := json.Unmarshal(raw, &payload); err != nil {
		return VideoMetadata{}, fmt.Errorf("decoding ffprobe json: %w", err)
	}

	var video *ffprobeStream
	for index := range payload.Streams {
		if payload.Streams[index].CodecType == "video" {
			video = &payload.Streams[index]
			break
		}
	}
	if video == nil {
		return VideoMetadata{}, errors.New("video file has no video stream")
	}
	if video.Width <= 0 || video.Height <= 0 {
		return VideoMetadata{}, errors.New("video stream width and height are required")
	}

	duration, err := parseDurationMicros(video.Duration)
	if err != nil {
		duration, err = parseDurationMicros(payload.Format.Duration)
	}
	if err != nil {
		return VideoMetadata{}, errors.New("unable to determine video duration")
	}

	return VideoMetadata{
		Duration: duration,
		Width:    video.Width,
		Height:   video.Height,
	}, nil
}

func parseDurationMicros(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "N/A" {
		return 0, errors.New("duration is empty")
	}
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 {
		return 0, errors.New("duration must be positive")
	}
	// pyJianYingDraft reads MediaInfo durations in milliseconds and then
	// converts that rounded value to microseconds. Match that on ffprobe data.
	return int64(math.Round(seconds*1_000)) * 1_000, nil
}
