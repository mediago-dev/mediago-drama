package media

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildFFmpegPreviewArgs(t *testing.T) {
	args, err := BuildFFmpegPreviewArgs([]string{"/tmp/a.mp4", " ", "/tmp/b.mp4"})
	if err != nil {
		t.Fatalf("BuildFFmpegPreviewArgs() error = %v", err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"-i /tmp/a.mp4",
		"-i /tmp/b.mp4",
		"fps=30",
		"setpts=PTS-STARTPTS",
		"concat=n=2:v=1:a=0[v]",
		"-tune zerolatency",
		"-pix_fmt yuv420p",
		"-g 30",
		"-keyint_min 30",
		"-flush_packets 1",
		"-frag_duration 500000",
		"-movflags +frag_keyframe+empty_moov+default_base_moof",
		"-f mp4 pipe:1",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args = %q, missing %q", joined, want)
		}
	}
}

func TestBuildFFmpegPreviewFileArgs(t *testing.T) {
	args, err := BuildFFmpegPreviewFileArgs([]string{"/tmp/a.mp4", "/tmp/b.mp4"}, "/tmp/out.mp4")
	if err != nil {
		t.Fatalf("BuildFFmpegPreviewFileArgs() error = %v", err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"-i /tmp/a.mp4",
		"-i /tmp/b.mp4",
		"concat=n=2:v=1:a=1[v][a]",
		"-map [a]",
		"-c:a aac",
		"-b:a 160k",
		"-ar 48000",
		"-ac 2",
		"-pix_fmt yuv420p",
		"-movflags +faststart",
		"-f mp4 -y /tmp/out.mp4",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args = %q, missing %q", joined, want)
		}
	}
	if strings.Contains(joined, "empty_moov") || strings.Contains(joined, "pipe:1") {
		t.Fatalf("args = %q, want seekable file output args", joined)
	}
	if strings.Contains(joined, "-an") {
		t.Fatalf("args = %q, want audio preserved in seekable file output", joined)
	}
}

func TestBuildFFmpegPreviewFileArgsCanDisableAudio(t *testing.T) {
	args, err := buildFFmpegPreviewFileArgs([]string{"/tmp/a.mp4", "/tmp/b.mp4"}, "/tmp/out.mp4", false)
	if err != nil {
		t.Fatalf("buildFFmpegPreviewFileArgs() error = %v", err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"concat=n=2:v=1:a=0[v]",
		"-an",
		"-f mp4 -y /tmp/out.mp4",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args = %q, missing %q", joined, want)
		}
	}
	if strings.Contains(joined, "-map [a]") || strings.Contains(joined, "-c:a aac") {
		t.Fatalf("args = %q, want video-only fallback args", joined)
	}
}

func TestBuildFFmpegPreviewFileArgsRequiresOutput(t *testing.T) {
	if _, err := BuildFFmpegPreviewFileArgs([]string{"/tmp/a.mp4"}, " "); err == nil {
		t.Fatal("BuildFFmpegPreviewFileArgs() error = nil, want missing output error")
	}
}

func TestBuildFFmpegPreviewArgsRequiresFiles(t *testing.T) {
	if _, err := BuildFFmpegPreviewArgs([]string{" "}); err == nil {
		t.Fatal("BuildFFmpegPreviewArgs() error = nil, want missing file error")
	}
}

func TestResolveFFmpegPathUsesBinDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ffmpeg", "ffmpeg")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	writeExecutableForTest(t, path)

	got, err := ResolveFFmpegPath("", dir)
	if err != nil {
		t.Fatalf("ResolveFFmpegPath() error = %v", err)
	}
	if got != path {
		t.Fatalf("ResolveFFmpegPath() = %q, want %q", got, path)
	}
}

func TestResolveFFprobePathUsesBinDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ffprobe", "ffprobe")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	writeExecutableForTest(t, path)

	got, err := ResolveFFprobePath("", dir)
	if err != nil {
		t.Fatalf("ResolveFFprobePath() error = %v", err)
	}
	if got != path {
		t.Fatalf("ResolveFFprobePath() = %q, want %q", got, path)
	}
}

func writeExecutableForTest(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", path, err)
	}
}
