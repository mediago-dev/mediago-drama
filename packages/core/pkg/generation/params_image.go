package generation

var imageParamGroups = []ParamGroupSpec{
	{ID: ParamGroupSize, Label: "大小"},
	{ID: ParamGroupCount, Label: "数量"},
	{ID: ParamGroupOther, Label: "其他"},
}

var imageParamRegistry = map[ParamID]CanonicalParamSpec{
	ParamAspectRatio: {
		ID:      ParamAspectRatio,
		Label:   "Aspect ratio",
		Type:    "select",
		Group:   ParamGroupSize,
		Options: aspectRatioParamOptions(),
	},
	ParamResolution: {
		ID:    ParamResolution,
		Label: "Resolution",
		Type:  "select",
		Group: ParamGroupSize,
		Options: []ParamOption{
			{Label: "1K", Value: "1K"},
			{Label: "2K", Value: "2K"},
			{Label: "3K", Value: "3K"},
			{Label: "4K", Value: "4K"},
		},
	},
	ParamN: {
		ID:    ParamN,
		Label: "Images",
		Type:  "number",
		Group: ParamGroupCount,
		Min:   paramFloat(1),
		Max:   paramFloat(10),
	},
	ParamQuality: {
		ID:    ParamQuality,
		Label: "Quality",
		Type:  "select",
		Group: ParamGroupOther,
		Options: []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "High", Value: "high"},
			{Label: "Medium", Value: "medium"},
			{Label: "Low", Value: "low"},
		},
	},
	ParamOutputFormat: {
		ID:    ParamOutputFormat,
		Label: "Output format",
		Type:  "select",
		Group: ParamGroupOther,
		Options: []ParamOption{
			{Label: "PNG", Value: "png"},
			{Label: "JPEG", Value: "jpeg"},
			{Label: "WEBP", Value: "webp"},
		},
	},
	ParamOutputCompression: {
		ID:    ParamOutputCompression,
		Label: "Output compression",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(0),
		Max:   paramFloat(100),
		Help:  "Only applies to JPEG and WEBP output.",
	},
	ParamModeration: {
		ID:    ParamModeration,
		Label: "Moderation",
		Type:  "select",
		Group: ParamGroupOther,
		Options: []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Low", Value: "low"},
		},
	},
	ParamBackground: {
		ID:    ParamBackground,
		Label: "Background",
		Type:  "select",
		Group: ParamGroupOther,
		Options: []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Opaque", Value: "opaque"},
		},
	},
	ParamWatermark: {
		ID:    ParamWatermark,
		Label: "Watermark",
		Type:  "boolean",
		Group: ParamGroupOther,
	},
}
