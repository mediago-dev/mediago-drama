package jianyingdraft

import (
	"encoding/json"
	"fmt"
	"path/filepath"
)

var (
	jsonFloatZero = json.Number("0.0")
	jsonFloatOne  = json.Number("1.0")
)

func (draft *Draft) buildContentJSON(mediaPaths map[string]string) ([]byte, int64, error) {
	draftID, err := randomID()
	if err != nil {
		return nil, 0, err
	}
	content := baseContentDocument(draftID, draft.options)
	materials := content["materials"].(map[string]any)
	videos := make([]map[string]any, 0, len(draft.shots))
	speeds := make([]map[string]any, 0, len(draft.shots))
	segments := make([]map[string]any, 0, len(draft.shots))
	materialByPath := map[string]string{}

	var targetStart int64
	for _, shot := range draft.shots {
		mediaPath := shot.path
		if copiedPath := mediaPaths[shot.path]; copiedPath != "" {
			mediaPath = copiedPath
		}

		materialID, ok := materialByPath[shot.path]
		if !ok {
			materialID, err = randomHexID()
			if err != nil {
				return nil, 0, err
			}
			materialByPath[shot.path] = materialID
			videos = append(videos, videoMaterialObject(materialID, mediaPath, shot.metadata))
		}

		speedID, err := randomHexID()
		if err != nil {
			return nil, 0, err
		}
		segmentID, err := randomHexID()
		if err != nil {
			return nil, 0, err
		}
		speeds = append(speeds, speedObject(speedID))
		segments = append(segments, segmentObject(segmentID, materialID, speedID, shot, targetStart))
		targetStart += shot.duration
	}

	trackID, err := randomHexID()
	if err != nil {
		return nil, 0, err
	}
	content["duration"] = targetStart
	materials["videos"] = videos
	materials["speeds"] = speeds
	content["tracks"] = []map[string]any{trackObject(trackID, segments)}

	raw, err := json.MarshalIndent(content, "", "\t")
	if err != nil {
		return nil, 0, fmt.Errorf("encoding draft content: %w", err)
	}
	return append(raw, '\n'), targetStart, nil
}

func baseContentDocument(id string, options DraftOptions) map[string]any {
	return map[string]any{
		"canvas_config": map[string]any{
			"height": options.Height,
			"ratio":  "original",
			"width":  options.Width,
		},
		"color_space": 0,
		"config": map[string]any{
			"adjust_max_index":          1,
			"attachment_info":           []any{},
			"combination_max_index":     1,
			"export_range":              nil,
			"extract_audio_last_index":  1,
			"lyrics_recognition_id":     "",
			"lyrics_sync":               true,
			"lyrics_taskinfo":           []any{},
			"maintrack_adsorb":          true,
			"material_save_mode":        0,
			"multi_language_current":    "none",
			"multi_language_list":       []any{},
			"multi_language_main":       "none",
			"multi_language_mode":       "none",
			"original_sound_last_index": 1,
			"record_audio_last_index":   1,
			"sticker_max_index":         1,
			"subtitle_keywords_config":  nil,
			"subtitle_recognition_id":   "",
			"subtitle_sync":             true,
			"subtitle_taskinfo":         []any{},
			"system_font_list":          []any{},
			"video_mute":                false,
			"zoom_info_params":          nil,
		},
		"cover":                     nil,
		"create_time":               0,
		"duration":                  0,
		"extra_info":                nil,
		"fps":                       float64(options.FPS),
		"free_render_index_mode_on": false,
		"group_container":           nil,
		"id":                        id,
		"keyframe_graph_list":       []any{},
		"keyframes": map[string]any{
			"adjusts":    []any{},
			"audios":     []any{},
			"effects":    []any{},
			"filters":    []any{},
			"handwrites": []any{},
			"stickers":   []any{},
			"texts":      []any{},
			"videos":     []any{},
		},
		"last_modified_platform":     platformObject(),
		"materials":                  emptyMaterialsObject(),
		"mutable_config":             nil,
		"name":                       "",
		"new_version":                "110.0.0",
		"platform":                   platformObject(),
		"relationships":              []any{},
		"render_index_track_mode_on": false,
		"retouch_cover":              nil,
		"source":                     "default",
		"static_cover_image_path":    "",
		"time_marks":                 nil,
		"tracks":                     []any{},
		"update_time":                0,
		"version":                    360000,
	}
}

func emptyMaterialsObject() map[string]any {
	keys := []string{
		"ai_translates",
		"audio_balances",
		"audio_effects",
		"audio_fades",
		"audio_track_indexes",
		"audios",
		"beats",
		"canvases",
		"chromas",
		"color_curves",
		"digital_humans",
		"drafts",
		"effects",
		"flowers",
		"green_screens",
		"handwrites",
		"hsl",
		"images",
		"log_color_wheels",
		"loudnesses",
		"manual_deformations",
		"masks",
		"material_animations",
		"material_colors",
		"multi_language_refs",
		"placeholders",
		"plugin_effects",
		"primary_color_wheels",
		"realtime_denoises",
		"shapes",
		"smart_crops",
		"smart_relights",
		"sound_channel_mappings",
		"speeds",
		"stickers",
		"tail_leaders",
		"text_templates",
		"texts",
		"time_marks",
		"transitions",
		"video_effects",
		"video_trackings",
		"videos",
		"vocal_beautifys",
		"vocal_separations",
	}
	materials := make(map[string]any, len(keys))
	for _, key := range keys {
		materials[key] = []any{}
	}
	return materials
}

func platformObject() map[string]any {
	return map[string]any{
		"app_id":      3704,
		"app_source":  "lv",
		"app_version": "5.9.0",
		"os":          "windows",
	}
}

func videoMaterialObject(id string, path string, metadata VideoMetadata) map[string]any {
	return map[string]any{
		"audio_fade":    nil,
		"category_id":   "",
		"category_name": "local",
		"check_flag":    63487,
		"crop": map[string]any{
			"upper_left_x":  jsonFloatZero,
			"upper_left_y":  jsonFloatZero,
			"upper_right_x": jsonFloatOne,
			"upper_right_y": jsonFloatZero,
			"lower_left_x":  jsonFloatZero,
			"lower_left_y":  jsonFloatOne,
			"lower_right_x": jsonFloatOne,
			"lower_right_y": jsonFloatOne,
		},
		"crop_ratio":        "free",
		"crop_scale":        jsonFloatOne,
		"duration":          metadata.Duration,
		"height":            metadata.Height,
		"id":                id,
		"local_material_id": "",
		"material_id":       id,
		"material_name":     filepath.Base(path),
		"media_path":        "",
		"path":              path,
		"type":              "video",
		"width":             metadata.Width,
	}
}

func speedObject(id string) map[string]any {
	return map[string]any{
		"curve_speed": nil,
		"id":          id,
		"mode":        0,
		"speed":       jsonFloatOne,
		"type":        "speed",
	}
}

func segmentObject(id string, materialID string, speedID string, shot normalizedShot, targetStart int64) map[string]any {
	return map[string]any{
		"enable_adjust":               true,
		"enable_color_correct_adjust": false,
		"enable_color_curves":         true,
		"enable_color_match_adjust":   false,
		"enable_color_wheels":         true,
		"enable_lut":                  true,
		"enable_smart_color_adjust":   false,
		"last_nonzero_volume":         jsonFloatOne,
		"reverse":                     false,
		"track_attribute":             0,
		"track_render_index":          0,
		"visible":                     true,
		"id":                          id,
		"material_id":                 materialID,
		"target_timerange": map[string]any{
			"start":    targetStart,
			"duration": shot.duration,
		},
		"common_keyframes": []any{},
		"keyframe_refs":    []any{},
		"source_timerange": map[string]any{
			"start":    shot.in,
			"duration": shot.duration,
		},
		"speed":               jsonFloatOne,
		"volume":              jsonFloatOne,
		"extra_material_refs": []string{speedID},
		"is_tone_modify":      false,
		"clip": map[string]any{
			"alpha": jsonFloatOne,
			"flip": map[string]any{
				"horizontal": false,
				"vertical":   false,
			},
			"rotation": jsonFloatZero,
			"scale": map[string]any{
				"x": jsonFloatOne,
				"y": jsonFloatOne,
			},
			"transform": map[string]any{
				"x": jsonFloatZero,
				"y": jsonFloatZero,
			},
		},
		"uniform_scale": map[string]any{
			"on":    true,
			"value": jsonFloatOne,
		},
		"hdr_settings": map[string]any{
			"intensity": jsonFloatOne,
			"mode":      1,
			"nits":      1000,
		},
		"render_index": 0,
	}
}

func trackObject(id string, segments []map[string]any) map[string]any {
	return map[string]any{
		"attribute":       0,
		"flag":            0,
		"id":              id,
		"is_default_name": false,
		"name":            "video",
		"segments":        segments,
		"type":            "video",
	}
}
