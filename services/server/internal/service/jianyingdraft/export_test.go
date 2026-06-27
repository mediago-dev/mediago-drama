package jianyingdraft

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	draftlib "github.com/mediago-dev/mediago-drama/packages/jianyingdraft/pkg/jianyingdraft"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	servicesettings "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

type fakeTimelineStore struct {
	state servicedocument.EpisodeTimelineStateResponse
	ok    bool
}

func (store fakeTimelineStore) GetEpisodeTimelineState(_ string, _ string) (servicedocument.EpisodeTimelineStateResponse, bool, error) {
	return store.state, store.ok, nil
}

type fakeMediaStore struct {
	assets map[string]servicemedia.MediaAsset
}

func (store fakeMediaStore) Get(id string) (servicemedia.MediaAsset, bool, error) {
	asset, ok := store.assets[id]
	return asset, ok, nil
}

func (store fakeMediaStore) ServeFilePath(asset servicemedia.MediaAsset) (string, error) {
	return asset.FilePath, nil
}

type fakeSettingsStore struct {
	settings servicesettings.JianyingDraftSettings
}

func (store fakeSettingsStore) GetJianyingDraftSettings(_ context.Context) (servicesettings.JianyingDraftSettings, error) {
	return store.settings, nil
}

type failingMetadataReader struct{}

func (reader failingMetadataReader) Probe(_ context.Context, _ string) (draftlib.VideoMetadata, error) {
	return draftlib.VideoMetadata{}, errors.New("metadata unavailable")
}

type staticMetadataReader struct {
	metadata draftlib.VideoMetadata
}

func (reader staticMetadataReader) Probe(_ context.Context, _ string) (draftlib.VideoMetadata, error) {
	return reader.metadata, nil
}

func TestExportEpisodeWritesJianyingDraftFromReadyVideoClips(t *testing.T) {
	dir := t.TempDir()
	first := writeServiceTestFile(t, dir, "first.mp4")
	second := writeServiceTestFile(t, dir, "second.mp4")
	draftsRoot := filepath.Join(dir, "drafts")
	service := NewService(
		fakeTimelineStore{
			ok: true,
			state: servicedocument.EpisodeTimelineStateResponse{
				Episode: json.RawMessage(`{
					"title": "测试剧集",
					"aspectRatio": "9:16",
					"tracks": [
						{"type": "video", "clips": [
							{"id":"clip-2","title":"第二镜","start":10,"end":20,"status":"ready","videoUrl":"/api/v1/media-assets/asset-2/content"},
							{"id":"clip-1","title":"第一镜","start":0,"end":10,"status":"ready","videoUrl":"/api/v1/media-assets/asset-1/content"},
							{"id":"clip-3","title":"第三镜","start":20,"end":30,"status":"draft","videoUrl":""}
						]}
					]
				}`),
			},
		},
		fakeMediaStore{assets: map[string]servicemedia.MediaAsset{
			"asset-1": {
				ID:              "asset-1",
				Kind:            servicemedia.MediaKindVideo,
				ProjectID:       "project-a",
				FilePath:        first,
				DurationSeconds: 4,
				Width:           1080,
				Height:          1920,
			},
			"asset-2": {
				ID:              "asset-2",
				Kind:            servicemedia.MediaKindVideo,
				ProjectID:       "project-a",
				FilePath:        second,
				DurationSeconds: 6,
				Width:           1080,
				Height:          1920,
			},
		}},
		fakeSettingsStore{settings: servicesettings.JianyingDraftSettings{DraftsRoot: draftsRoot}},
		failingMetadataReader{},
	)
	service.now = func() time.Time {
		return time.Date(2026, 6, 27, 10, 11, 12, 0, time.UTC)
	}

	result, err := service.ExportEpisode(context.Background(), "project-a", "doc-1", ExportRequest{})
	if err != nil {
		t.Fatalf("ExportEpisode() error = %v", err)
	}
	if result.DraftName != "测试剧集-20260627-101112" {
		t.Fatalf("draft name = %q, want title plus timestamp", result.DraftName)
	}
	if result.ShotCount != 2 || result.SkippedCount != 1 || result.DurationMicros != 10_000_000 {
		t.Fatalf("result = %#v, want 2 shots, 1 skipped, 10s duration", result)
	}

	raw, err := os.ReadFile(filepath.Join(result.DraftPath, "draft_content.json"))
	if err != nil {
		t.Fatalf("read draft_content.json: %v", err)
	}
	var content serviceContentDocument
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if content.Canvas.Width != 1080 || content.Canvas.Height != 1920 {
		t.Fatalf("canvas = %#v, want portrait canvas", content.Canvas)
	}
	if len(content.Tracks) != 1 || len(content.Tracks[0].Segments) != 2 {
		t.Fatalf("tracks = %#v, want one video track with two segments", content.Tracks)
	}
	if got := content.Materials.Videos[0].Path; got != first {
		t.Fatalf("first video path = %q, want first timeline clip path %q", got, first)
	}
	if got := content.Materials.Videos[1].Path; got != second {
		t.Fatalf("second video path = %q, want second timeline clip path %q", got, second)
	}
	if content.Tracks[0].Segments[1].Target.Start != 4_000_000 {
		t.Fatalf("second segment start = %d, want first clip duration", content.Tracks[0].Segments[1].Target.Start)
	}
}

func TestExportEpisodeRequiresConfiguredDraftRoot(t *testing.T) {
	service := NewService(
		fakeTimelineStore{
			ok: true,
			state: servicedocument.EpisodeTimelineStateResponse{
				Episode: json.RawMessage(`{"title":"x","tracks":[{"type":"video","clips":[{"status":"ready","videoUrl":"/api/v1/media-assets/a/content"}]}]}`),
			},
		},
		fakeMediaStore{},
		fakeSettingsStore{},
		failingMetadataReader{},
	)
	_, err := service.ExportEpisode(context.Background(), "project-a", "doc-1", ExportRequest{})
	if !errors.Is(err, ErrDraftRootNotConfigured) {
		t.Fatalf("ExportEpisode() error = %v, want ErrDraftRootNotConfigured", err)
	}
}

func TestAssetMetadataReaderPrefersProbedVideoStreamMetadata(t *testing.T) {
	reader := assetMetadataReader{
		fallback: staticMetadataReader{metadata: draftlib.VideoMetadata{
			Duration: 5_016_667,
			Width:    1280,
			Height:   720,
		}},
		metadataByPath: map[string]draftlib.VideoMetadata{
			"/video.m4v": {
				Duration: 5_088_005,
				Width:    1280,
				Height:   720,
			},
		},
	}

	metadata, err := reader.Probe(context.Background(), "/video.m4v")
	if err != nil {
		t.Fatalf("Probe() error = %v", err)
	}
	if metadata.Duration != 5_016_667 {
		t.Fatalf("duration = %d, want probed video stream duration", metadata.Duration)
	}
}

type serviceContentDocument struct {
	Canvas struct {
		Height int `json:"height"`
		Width  int `json:"width"`
	} `json:"canvas_config"`
	Materials struct {
		Videos []struct {
			Path string `json:"path"`
		} `json:"videos"`
	} `json:"materials"`
	Tracks []struct {
		Segments []struct {
			Target struct {
				Start int64 `json:"start"`
			} `json:"target_timerange"`
		} `json:"segments"`
	} `json:"tracks"`
}

func writeServiceTestFile(t *testing.T, dir string, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("video"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		t.Fatalf("abs test file: %v", err)
	}
	return absolute
}
