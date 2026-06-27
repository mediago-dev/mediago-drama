// Package jianyingdraft writes minimal Jianying desktop draft directories.
package jianyingdraft

import "context"

// DraftOptions configures a video-only Jianying draft.
type DraftOptions struct {
	Name           string
	Width          int
	Height         int
	FPS            int
	MetadataReader MetadataReader
}

// Shot describes one local video clip to place on the timeline.
type Shot struct {
	Path     string
	In       int64
	Duration int64
}

// ExportOptions controls draft directory creation.
type ExportOptions struct {
	ReplaceExisting bool
	CopyMedia       bool
}

// ExportResult describes the draft files written by ExportContext.
type ExportResult struct {
	DraftPath      string
	ContentPath    string
	MetaPath       string
	DurationMicros int64
	ShotCount      int
}

// VideoMetadata contains the minimum source video metadata Jianying needs.
type VideoMetadata struct {
	Duration int64
	Width    int
	Height   int
}

// MetadataReader reads source video metadata.
type MetadataReader interface {
	Probe(ctx context.Context, path string) (VideoMetadata, error)
}

type normalizedShot struct {
	duration int64
	in       int64
	path     string
	metadata VideoMetadata
}
