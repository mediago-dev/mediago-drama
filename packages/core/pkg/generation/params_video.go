package generation

var videoParamGroups = []ParamGroupSpec{
	{ID: ParamGroupSize, Label: "大小"},
	{ID: ParamGroupDuration, Label: "秒数"},
	{ID: ParamGroupOther, Label: "其他"},
}

var videoParamRegistry = map[ParamID]CanonicalParamSpec{
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
			{Label: "480p", Value: "480p"},
			{Label: "720p", Value: "720p"},
			{Label: "1080p", Value: "1080p"},
		},
	},
	ParamDuration: {
		ID:      ParamDuration,
		Label:   "Duration",
		Type:    "select",
		Group:   ParamGroupDuration,
		Options: durationParamOptions(),
	},
	ParamGenerateAudio: {
		ID:    ParamGenerateAudio,
		Label: "Generate audio",
		Type:  "boolean",
		Group: ParamGroupOther,
	},
	ParamNegativePrompt: {
		ID:    ParamNegativePrompt,
		Label: "Negative prompt",
		Type:  "text",
		Group: ParamGroupOther,
	},
	ParamSeed: {
		ID:    ParamSeed,
		Label: "Seed",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(-1),
		Max:   paramFloat(2147483647),
	},
	ParamWatermark: {
		ID:    ParamWatermark,
		Label: "Watermark",
		Type:  "boolean",
		Group: ParamGroupOther,
	},
	ParamReturnLastFrame: {
		ID:    ParamReturnLastFrame,
		Label: "Return last frame",
		Type:  "boolean",
		Group: ParamGroupOther,
	},
	ParamExecutionExpiresAfter: {
		ID:    ParamExecutionExpiresAfter,
		Label: "Task timeout",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(3600),
		Max:   paramFloat(259200),
		Help:  "Seconds before a queued or running task expires.",
	},
}
