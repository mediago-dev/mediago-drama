package jianyingdraft

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseFFProbeMetadataPrefersVideoStreamDuration(t *testing.T) {
	raw := []byte(`{
		"format": {"duration": "1.234567"},
		"streams": [
			{"codec_type": "audio", "duration": "10.0"},
			{"codec_type": "video", "width": 1920, "height": 1080, "duration": "9.0"}
		]
	}`)
	metadata, err := parseFFProbeMetadata(raw)
	if err != nil {
		t.Fatalf("parseFFProbeMetadata() error = %v", err)
	}
	if metadata.Duration != 9_000_000 || metadata.Width != 1920 || metadata.Height != 1080 {
		t.Fatalf("metadata = %#v, want video stream duration and first video stream size", metadata)
	}
}

func TestParseFFProbeMetadataFallsBackToFormatDuration(t *testing.T) {
	raw := []byte(`{
		"format": {"duration": "2.5"},
		"streams": [
			{"codec_type": "video", "width": 1280, "height": 720}
		]
	}`)
	metadata, err := parseFFProbeMetadata(raw)
	if err != nil {
		t.Fatalf("parseFFProbeMetadata() error = %v", err)
	}
	if metadata.Duration != 2_500_000 {
		t.Fatalf("duration = %d, want stream duration", metadata.Duration)
	}
}

func TestParseDurationMicrosRoundsToMillisecondsLikePyJianYingDraft(t *testing.T) {
	duration, err := parseDurationMicros("5.016667")
	if err != nil {
		t.Fatalf("parseDurationMicros() error = %v", err)
	}
	if duration != 5_017_000 {
		t.Fatalf("duration = %d, want pyJianYingDraft-style millisecond rounding", duration)
	}
}

func TestParseFFProbeMetadataErrorsWithoutVideoStream(t *testing.T) {
	_, err := parseFFProbeMetadata([]byte(`{"format":{"duration":"1"},"streams":[]}`))
	if err == nil || !strings.Contains(err.Error(), "no video stream") {
		t.Fatalf("parseFFProbeMetadata() error = %v, want no video stream", err)
	}
}

func TestFFProbeReaderResolveBinaryUsesPackagedToolsDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ffprobe", ffprobeBinaryNames()[0])
	writeExecutableForFFProbeTest(t, path)

	got, err := (FFProbeReader{BinDir: dir}).resolveBinary()
	if err != nil {
		t.Fatalf("resolveBinary() error = %v", err)
	}
	if got != path {
		t.Fatalf("resolveBinary() = %q, want packaged ffprobe %q", got, path)
	}
}

func TestFFProbeReaderResolveBinarySupportsFlatBinDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ffprobeBinaryNames()[0])
	writeExecutableForFFProbeTest(t, path)

	got, err := (FFProbeReader{BinDir: dir}).resolveBinary()
	if err != nil {
		t.Fatalf("resolveBinary() error = %v", err)
	}
	if got != path {
		t.Fatalf("resolveBinary() = %q, want flat ffprobe %q", got, path)
	}
}

func writeExecutableForFFProbeTest(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", path, err)
	}
}
