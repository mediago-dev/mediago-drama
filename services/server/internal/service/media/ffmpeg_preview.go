package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	defaultPreviewWidth  = 1280
	defaultPreviewHeight = 720
)

// FFmpegPreviewStreamer streams an episode preview as fragmented MP4.
type FFmpegPreviewStreamer struct {
	path   string
	binDir string
}

// NewFFmpegPreviewStreamer returns a preview streamer backed by ffmpeg.
func NewFFmpegPreviewStreamer(path string, binDir string) *FFmpegPreviewStreamer {
	return &FFmpegPreviewStreamer{
		path:   strings.TrimSpace(path),
		binDir: strings.TrimSpace(binDir),
	}
}

// Ready verifies that an ffmpeg binary can be resolved.
func (streamer *FFmpegPreviewStreamer) Ready() error {
	if streamer == nil {
		return errors.New("ffmpeg preview streamer is nil")
	}
	_, err := ResolveFFmpegPath(streamer.path, streamer.binDir)
	return err
}

// StreamFragmentedMP4 concatenates the provided files and writes fragmented MP4 to writer.
func (streamer *FFmpegPreviewStreamer) StreamFragmentedMP4(ctx context.Context, writer io.Writer, files []string) error {
	if streamer == nil {
		return errors.New("ffmpeg preview streamer is nil")
	}
	ffmpegPath, err := ResolveFFmpegPath(streamer.path, streamer.binDir)
	if err != nil {
		return err
	}
	args, err := BuildFFmpegPreviewArgs(files)
	if err != nil {
		return err
	}

	command := exec.CommandContext(ctx, ffmpegPath, args...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("opening ffmpeg stdout: %w", err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		return fmt.Errorf("starting ffmpeg: %w", err)
	}
	_, copyErr := io.Copy(writer, stdout)
	waitErr := command.Wait()
	if copyErr != nil {
		return fmt.Errorf("streaming ffmpeg output: %w", copyErr)
	}
	if waitErr != nil {
		message := strings.TrimSpace(stderr.String())
		if message != "" {
			return fmt.Errorf("ffmpeg preview failed: %w: %s", waitErr, message)
		}
		return fmt.Errorf("ffmpeg preview failed: %w", waitErr)
	}
	return nil
}

// RenderMP4 concatenates the provided files into a seekable MP4 file.
func (streamer *FFmpegPreviewStreamer) RenderMP4(ctx context.Context, outputPath string, files []string) error {
	if streamer == nil {
		return errors.New("ffmpeg preview streamer is nil")
	}
	ffmpegPath, err := ResolveFFmpegPath(streamer.path, streamer.binDir)
	if err != nil {
		return err
	}
	args, err := BuildFFmpegPreviewFileArgs(files, outputPath)
	if err != nil {
		return err
	}

	if err := runPreviewFFmpeg(ctx, ffmpegPath, args); err == nil {
		return nil
	} else {
		videoOnlyArgs, fallbackErr := buildFFmpegPreviewFileArgs(files, outputPath, false)
		if fallbackErr != nil {
			return err
		}
		_ = os.Remove(outputPath)
		if videoOnlyErr := runPreviewFFmpeg(ctx, ffmpegPath, videoOnlyArgs); videoOnlyErr != nil {
			return err
		}
		return nil
	}
}

func runPreviewFFmpeg(ctx context.Context, ffmpegPath string, args []string) error {
	command := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message != "" {
			return fmt.Errorf("ffmpeg preview failed: %w: %s", err, message)
		}
		return fmt.Errorf("ffmpeg preview failed: %w", err)
	}
	return nil
}

// ResolveFFmpegPath resolves an explicit ffmpeg binary path, vendored bin dir, or PATH fallback.
func ResolveFFmpegPath(explicitPath string, binDir string) (string, error) {
	return resolveMediaToolPath("ffmpeg", explicitPath, binDir)
}

// ResolveFFprobePath resolves an explicit ffprobe binary path, vendored bin dir, or PATH fallback.
func ResolveFFprobePath(explicitPath string, binDir string) (string, error) {
	return resolveMediaToolPath("ffprobe", explicitPath, binDir)
}

func resolveMediaToolPath(tool string, explicitPath string, binDir string) (string, error) {
	if path := strings.TrimSpace(explicitPath); path != "" {
		return executablePath(path)
	}
	if dir := strings.TrimSpace(binDir); dir != "" {
		for _, name := range mediaToolBinaryNames(tool) {
			for _, path := range []string{
				filepath.Join(dir, name),
				filepath.Join(dir, tool, name),
			} {
				if resolved, err := executablePath(path); err == nil {
					return resolved, nil
				}
			}
		}
		return "", fmt.Errorf("%s binary was not found in %s", tool, dir)
	}
	path, err := exec.LookPath(tool)
	if err != nil {
		return "", fmt.Errorf("%s binary was not found; set MEDIAGO_FFMPEG_PATH or MEDIAGO_FFMPEG_BIN_DIR", tool)
	}
	return path, nil
}

// BuildFFmpegPreviewArgs builds the ffmpeg argv for an episode preview stream.
func BuildFFmpegPreviewArgs(files []string) ([]string, error) {
	paths := compactFilePaths(files)
	if len(paths) == 0 {
		return nil, errors.New("at least one video file is required")
	}

	args := buildPreviewTranscodeArgs(paths, false)
	args = append(args,
		"-flush_packets", "1",
		"-muxdelay", "0",
		"-muxpreload", "0",
		"-frag_duration", "500000",
		"-movflags", "+frag_keyframe+empty_moov+default_base_moof",
		"-f", "mp4",
		"pipe:1",
	)
	return args, nil
}

// BuildFFmpegPreviewFileArgs builds the ffmpeg argv for a seekable episode preview file.
func BuildFFmpegPreviewFileArgs(files []string, outputPath string) ([]string, error) {
	return buildFFmpegPreviewFileArgs(files, outputPath, true)
}

func buildFFmpegPreviewFileArgs(files []string, outputPath string, includeAudio bool) ([]string, error) {
	paths := compactFilePaths(files)
	if len(paths) == 0 {
		return nil, errors.New("at least one video file is required")
	}
	output := strings.TrimSpace(outputPath)
	if output == "" {
		return nil, errors.New("output file is required")
	}

	args := buildPreviewTranscodeArgs(paths, includeAudio)
	args = append(args,
		"-movflags", "+faststart",
		"-f", "mp4",
		"-y",
		output,
	)
	return args, nil
}

func buildPreviewTranscodeArgs(paths []string, includeAudio bool) []string {
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-fflags", "+genpts"}
	for _, path := range paths {
		args = append(args, "-i", path)
	}
	args = append(args,
		"-filter_complex", previewFilterGraph(len(paths), includeAudio),
		"-map", "[v]",
		"-c:v", "libx264",
		"-preset", "veryfast",
		"-tune", "zerolatency",
		"-crf", "23",
		"-pix_fmt", "yuv420p",
		"-r", "30",
		"-g", "30",
		"-keyint_min", "30",
		"-sc_threshold", "0",
	)
	if includeAudio {
		args = append(args,
			"-map", "[a]",
			"-c:a", "aac",
			"-b:a", "160k",
			"-ar", "48000",
			"-ac", "2",
		)
		return args
	}
	return append(args, "-an")
}

func previewFilterGraph(count int, includeAudio bool) string {
	parts := make([]string, 0, count+1)
	concatInputs := strings.Builder{}
	for index := 0; index < count; index += 1 {
		videoLabel := fmt.Sprintf("v%d", index)
		parts = append(parts, fmt.Sprintf(
			"[%d:v:0]scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[%s]",
			index,
			defaultPreviewWidth,
			defaultPreviewHeight,
			defaultPreviewWidth,
			defaultPreviewHeight,
			videoLabel,
		))
		concatInputs.WriteString("[")
		concatInputs.WriteString(videoLabel)
		concatInputs.WriteString("]")
		if includeAudio {
			audioLabel := fmt.Sprintf("a%d", index)
			parts = append(parts, fmt.Sprintf(
				"[%d:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[%s]",
				index,
				audioLabel,
			))
			concatInputs.WriteString("[")
			concatInputs.WriteString(audioLabel)
			concatInputs.WriteString("]")
		}
	}
	if includeAudio {
		parts = append(parts, fmt.Sprintf("%sconcat=n=%d:v=1:a=1[v][a]", concatInputs.String(), count))
		return strings.Join(parts, ";")
	}
	parts = append(parts, fmt.Sprintf("%sconcat=n=%d:v=1:a=0[v]", concatInputs.String(), count))
	return strings.Join(parts, ";")
}

func compactFilePaths(files []string) []string {
	paths := make([]string, 0, len(files))
	for _, file := range files {
		if path := strings.TrimSpace(file); path != "" {
			paths = append(paths, path)
		}
	}
	return paths
}

func mediaToolBinaryNames(tool string) []string {
	if runtime.GOOS == "windows" {
		return []string{tool + ".exe", tool}
	}
	return []string{tool}
}

func executablePath(path string) (string, error) {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolving ffmpeg path %s: %w", path, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("checking ffmpeg path %s: %w", resolved, err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("ffmpeg path %s is a directory", resolved)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("ffmpeg path %s is not executable", resolved)
	}
	return resolved, nil
}
