package jianyingdraft

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildContentJSONCreatesSingleVideoTrack(t *testing.T) {
	dir := t.TempDir()
	first := writeTestFile(t, dir, "first.mp4")
	second := writeTestFile(t, dir, "second.mp4")
	draft := testDraftWithShots(t, first, second)

	raw, duration, err := draft.buildContentJSON(nil)
	if err != nil {
		t.Fatalf("buildContentJSON() error = %v", err)
	}
	if duration != 8_000_000 {
		t.Fatalf("duration = %d, want sum of shots", duration)
	}

	var content contentTestDocument
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if content.Canvas.Width != 1920 || content.Canvas.Height != 1080 || content.FPS != 30 {
		t.Fatalf("canvas/fps = %#v/%v, want configured values", content.Canvas, content.FPS)
	}
	rawText := string(raw)
	for _, want := range []string{
		`"crop_scale": 1.0`,
		`"upper_left_x": 0.0`,
		`"last_nonzero_volume": 1.0`,
		`"speed": 1.0`,
		`"volume": 1.0`,
		`"rotation": 0.0`,
		`"intensity": 1.0`,
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("draft content does not contain %s; raw JSON should preserve pyJianYingDraft float literals", want)
		}
	}
	if len(content.Tracks) != 1 || content.Tracks[0].Type != "video" {
		t.Fatalf("tracks = %#v, want one video track", content.Tracks)
	}
	if content.Tracks[0].Name != "video" || content.Tracks[0].IsDefaultName {
		t.Fatalf("track name/default = %q/%v, want pyJianYingDraft default video track", content.Tracks[0].Name, content.Tracks[0].IsDefaultName)
	}
	segments := content.Tracks[0].Segments
	if len(segments) != 2 {
		t.Fatalf("segments len = %d, want 2", len(segments))
	}
	if segments[0].Target.Start != 0 || segments[0].Target.Duration != 5_000_000 {
		t.Fatalf("first target = %#v, want start 0 duration 5000000", segments[0].Target)
	}
	if segments[1].Target.Start != 5_000_000 || segments[1].Target.Duration != 3_000_000 {
		t.Fatalf("second target = %#v, want contiguous second segment", segments[1].Target)
	}
	if segments[1].Source.Start != 1_000_000 || segments[1].Source.Duration != 3_000_000 {
		t.Fatalf("second source = %#v, want trim source timerange", segments[1].Source)
	}
	if len(content.Materials.Videos) != 2 || len(content.Materials.Speeds) != 2 {
		t.Fatalf("materials videos/speeds = %d/%d, want 2/2", len(content.Materials.Videos), len(content.Materials.Speeds))
	}
	for index, segment := range segments {
		if len(segment.ExtraMaterialRefs) != 1 {
			t.Fatalf("segment %d extra refs = %#v, want one speed ref", index, segment.ExtraMaterialRefs)
		}
		if segment.ExtraMaterialRefs[0] != content.Materials.Speeds[index].ID {
			t.Fatalf("segment %d speed ref = %q, want %q", index, segment.ExtraMaterialRefs[0], content.Materials.Speeds[index].ID)
		}
		if segment.MaterialID != content.Materials.Videos[index].ID {
			t.Fatalf("segment %d material id = %q, want video id %q", index, segment.MaterialID, content.Materials.Videos[index].ID)
		}
		if !isPyJianYingDraftID(segment.MaterialID) || !isPyJianYingDraftID(segment.ExtraMaterialRefs[0]) {
			t.Fatalf("segment %d ids = %q/%q, want 32-char hex ids", index, segment.MaterialID, segment.ExtraMaterialRefs[0])
		}
		if !filepath.IsAbs(content.Materials.Videos[index].Path) {
			t.Fatalf("video path = %q, want absolute path", content.Materials.Videos[index].Path)
		}
		video := content.Materials.Videos[index]
		if video.CategoryName != "local" || video.MaterialID != video.ID {
			t.Fatalf("video %d category/material_id = %q/%q, want local and id", index, video.CategoryName, video.MaterialID)
		}
		if len(video.ExtraKeys) != 0 {
			t.Fatalf("video %d has non-pyJianYingDraft extra keys: %#v", index, video.ExtraKeys)
		}
		if len(segment.ExtraKeys) != 0 {
			t.Fatalf("segment %d has non-pyJianYingDraft extra keys: %#v", index, segment.ExtraKeys)
		}
	}
}

func isPyJianYingDraftID(value string) bool {
	return len(value) == 32 && strings.IndexFunc(value, func(r rune) bool {
		return !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f'))
	}) == -1
}

type contentTestDocument struct {
	Canvas struct {
		Height int `json:"height"`
		Width  int `json:"width"`
	} `json:"canvas_config"`
	Duration  int64   `json:"duration"`
	FPS       float64 `json:"fps"`
	Materials struct {
		Videos []contentTestVideo `json:"videos"`
		Speeds []struct {
			ID string `json:"id"`
		} `json:"speeds"`
	} `json:"materials"`
	Tracks []struct {
		IsDefaultName bool                 `json:"is_default_name"`
		Name          string               `json:"name"`
		Type          string               `json:"type"`
		Segments      []contentTestSegment `json:"segments"`
	} `json:"tracks"`
}

type contentTestVideo struct {
	Duration     int64          `json:"duration"`
	ID           string         `json:"id"`
	MaterialID   string         `json:"material_id"`
	CategoryName string         `json:"category_name"`
	Path         string         `json:"path"`
	ExtraKeys    map[string]any `json:"-"`
}

func (video *contentTestVideo) UnmarshalJSON(raw []byte) error {
	type alias contentTestVideo
	var decoded alias
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return err
	}
	var keys map[string]any
	if err := json.Unmarshal(raw, &keys); err != nil {
		return err
	}
	for _, key := range []string{
		"audio_fade",
		"category_id",
		"category_name",
		"check_flag",
		"crop",
		"crop_ratio",
		"crop_scale",
		"duration",
		"height",
		"id",
		"local_material_id",
		"material_id",
		"material_name",
		"media_path",
		"path",
		"type",
		"width",
	} {
		delete(keys, key)
	}
	*video = contentTestVideo(decoded)
	video.ExtraKeys = keys
	return nil
}

type contentTestSegment struct {
	ExtraMaterialRefs []string       `json:"extra_material_refs"`
	MaterialID        string         `json:"material_id"`
	ExtraKeys         map[string]any `json:"-"`
	Source            struct {
		Duration int64 `json:"duration"`
		Start    int64 `json:"start"`
	} `json:"source_timerange"`
	Target struct {
		Duration int64 `json:"duration"`
		Start    int64 `json:"start"`
	} `json:"target_timerange"`
}

func (segment *contentTestSegment) UnmarshalJSON(raw []byte) error {
	type alias contentTestSegment
	var decoded alias
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return err
	}
	var keys map[string]any
	if err := json.Unmarshal(raw, &keys); err != nil {
		return err
	}
	for _, key := range []string{
		"clip",
		"common_keyframes",
		"enable_adjust",
		"enable_color_correct_adjust",
		"enable_color_curves",
		"enable_color_match_adjust",
		"enable_color_wheels",
		"enable_lut",
		"enable_smart_color_adjust",
		"extra_material_refs",
		"hdr_settings",
		"id",
		"is_tone_modify",
		"keyframe_refs",
		"last_nonzero_volume",
		"material_id",
		"render_index",
		"reverse",
		"source_timerange",
		"speed",
		"target_timerange",
		"track_attribute",
		"track_render_index",
		"uniform_scale",
		"visible",
		"volume",
	} {
		delete(keys, key)
	}
	*segment = contentTestSegment(decoded)
	segment.ExtraKeys = keys
	return nil
}

func testDraftWithShots(t *testing.T, first string, second string) *Draft {
	t.Helper()
	draft := NewDraft(DraftOptions{
		Name:   "storyboard",
		Width:  1920,
		Height: 1080,
		FPS:    30,
		MetadataReader: fakeMetadataReader{metadata: map[string]VideoMetadata{
			first:  {Duration: 5_000_000, Width: 1920, Height: 1080},
			second: {Duration: 6_000_000, Width: 1280, Height: 720},
		}},
	})
	if err := draft.AddShots([]Shot{
		{Path: first},
		{Path: second, In: 1_000_000, Duration: 3_000_000},
	}); err != nil {
		t.Fatalf("AddShots() error = %v", err)
	}
	return draft
}
