package jianyingdraft

import (
	"encoding/json"
	"fmt"
)

func (draft *Draft) buildMetaJSON(draftPath string, rootPath string, duration int64) ([]byte, error) {
	id, err := randomID()
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"cloud_package_completed_time":       "",
		"draft_cloud_capcut_purchase_info":   "",
		"draft_cloud_last_action_download":   false,
		"draft_cloud_materials":              []any{},
		"draft_cloud_purchase_info":          "",
		"draft_cloud_template_id":            "",
		"draft_cloud_tutorial_info":          "",
		"draft_cloud_videocut_purchase_info": "",
		"draft_cover":                        "",
		"draft_deeplink_url":                 "",
		"draft_enterprise_info": map[string]any{
			"draft_enterprise_extra": "",
			"draft_enterprise_id":    "",
			"draft_enterprise_name":  "",
			"enterprise_material":    []any{},
		},
		"draft_fold_path":                "",
		"draft_id":                       id,
		"draft_is_ai_packaging_used":     false,
		"draft_is_ai_shorts":             false,
		"draft_is_ai_translate":          false,
		"draft_is_article_video_draft":   false,
		"draft_is_from_deeplink":         "false",
		"draft_is_invisible":             false,
		"draft_materials":                draftMetaMaterials(),
		"draft_materials_copied_info":    []any{},
		"draft_name":                     "",
		"draft_new_version":              "",
		"draft_removable_storage_device": "",
		"draft_root_path":                "",
		"draft_segment_extra_info":       []any{},
		"draft_type":                     "",
		"tm_draft_cloud_completed":       "",
		"tm_draft_cloud_modified":        0,
		"tm_draft_removed":               0,
		"tm_duration":                    0,
	}
	raw, err := json.MarshalIndent(payload, "", "\t")
	if err != nil {
		return nil, fmt.Errorf("encoding draft meta info: %w", err)
	}
	return append(raw, '\n'), nil
}

func draftMetaMaterials() []map[string]any {
	materials := make([]map[string]any, 0, 7)
	for _, kind := range []int{0, 1, 2, 3, 6, 7, 8} {
		materials = append(materials, map[string]any{
			"type":  kind,
			"value": []any{},
		})
	}
	return materials
}
