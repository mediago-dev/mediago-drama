package generation

const (
	ParamAspectRatio           ParamID = "aspectRatio"
	ParamResolution            ParamID = "resolution"
	ParamDuration              ParamID = "duration"
	ParamN                     ParamID = "n"
	ParamSeed                  ParamID = "seed"
	ParamOutputFormat          ParamID = "outputFormat"
	ParamWatermark             ParamID = "watermark"
	ParamQuality               ParamID = "quality"
	ParamNegativePrompt        ParamID = "negativePrompt"
	ParamGenerateAudio         ParamID = "generateAudio"
	ParamReturnLastFrame       ParamID = "returnLastFrame"
	ParamExecutionExpiresAfter ParamID = "executionExpiresAfter"
	ParamBackground            ParamID = "background"
	ParamModeration            ParamID = "moderation"
	ParamOutputCompression     ParamID = "outputCompression"
	ParamTemperature           ParamID = "temperature"
	ParamMaxTokens             ParamID = "maxTokens"
)

var canonicalParamRegistry = map[ParamID]CanonicalParamSpec{
	ParamAspectRatio: {
		ID:    ParamAspectRatio,
		Label: "Aspect ratio",
		Type:  "select",
		Options: []ParamOption{
			{Label: "Adaptive", Value: "adaptive"},
			{Label: "1:1", Value: "1:1"},
			{Label: "1:4", Value: "1:4"},
			{Label: "1:8", Value: "1:8"},
			{Label: "2:3", Value: "2:3"},
			{Label: "3:2", Value: "3:2"},
			{Label: "3:4", Value: "3:4"},
			{Label: "4:1", Value: "4:1"},
			{Label: "4:3", Value: "4:3"},
			{Label: "4:5", Value: "4:5"},
			{Label: "5:4", Value: "5:4"},
			{Label: "8:1", Value: "8:1"},
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
			{Label: "21:9", Value: "21:9"},
		},
	},
	ParamResolution: {
		ID:    ParamResolution,
		Label: "Resolution",
		Type:  "select",
		Options: []ParamOption{
			{Label: "480p", Value: "480p"},
			{Label: "720p", Value: "720p"},
			{Label: "1080p", Value: "1080p"},
			{Label: "1K", Value: "1K"},
			{Label: "2K", Value: "2K"},
			{Label: "3K", Value: "3K"},
			{Label: "4K", Value: "4K"},
		},
	},
	ParamDuration: {
		ID:      ParamDuration,
		Label:   "Duration",
		Type:    "select",
		Options: durationParamOptions(),
	},
	ParamN: {
		ID:    ParamN,
		Label: "Images",
		Type:  "number",
	},
	ParamSeed: {
		ID:    ParamSeed,
		Label: "Seed",
		Type:  "number",
	},
	ParamOutputFormat: {
		ID:    ParamOutputFormat,
		Label: "Output format",
		Type:  "select",
		Options: []ParamOption{
			{Label: "PNG", Value: "png"},
			{Label: "JPEG", Value: "jpeg"},
			{Label: "WEBP", Value: "webp"},
		},
	},
	ParamWatermark: {
		ID:    ParamWatermark,
		Label: "Watermark",
		Type:  "boolean",
	},
	ParamQuality: {
		ID:    ParamQuality,
		Label: "Quality",
		Type:  "select",
		Options: []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "High", Value: "high"},
			{Label: "Medium", Value: "medium"},
			{Label: "Low", Value: "low"},
		},
	},
	ParamNegativePrompt: {
		ID:    ParamNegativePrompt,
		Label: "Negative prompt",
		Type:  "text",
	},
	ParamGenerateAudio: {
		ID:    ParamGenerateAudio,
		Label: "Generate audio",
		Type:  "boolean",
	},
	ParamReturnLastFrame: {
		ID:    ParamReturnLastFrame,
		Label: "Return last frame",
		Type:  "boolean",
	},
	ParamExecutionExpiresAfter: {
		ID:    ParamExecutionExpiresAfter,
		Label: "Task timeout",
		Type:  "number",
		Help:  "Seconds before a queued or running task expires.",
	},
	ParamBackground: {
		ID:    ParamBackground,
		Label: "Background",
		Type:  "select",
		Options: []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Opaque", Value: "opaque"},
		},
	},
	ParamModeration: {
		ID:    ParamModeration,
		Label: "Moderation",
		Type:  "select",
		Options: []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Low", Value: "low"},
		},
	},
	ParamOutputCompression: {
		ID:    ParamOutputCompression,
		Label: "Output compression",
		Type:  "number",
		Help:  "Only applies to JPEG and WEBP output.",
	},
	ParamTemperature: {
		ID:    ParamTemperature,
		Label: "Temperature",
		Type:  "number",
	},
	ParamMaxTokens: {
		ID:    ParamMaxTokens,
		Label: "Max tokens",
		Type:  "number",
	},
}

func durationParamOptions() []ParamOption {
	options := []ParamOption{{Label: "Auto", Value: "-1"}}
	for duration := 3; duration <= 15; duration++ {
		value := formatNumber(float64(duration))
		options = append(options, ParamOption{Label: value + "s", Value: value})
	}
	return options
}
