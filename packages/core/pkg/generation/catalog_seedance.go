package generation

func officialSeedanceParams() []ParamSpec {
	params := seedanceParams()
	params = append(params, textParam("negativePrompt", "Negative prompt", ""))
	return params
}

func dmxSeedanceParams() []ParamSpec {
	return seedanceParams()
}

func jimengSeedanceParams() []ParamSpec {
	return []ParamSpec{
		selectParam("ratio", "Ratio", "16:9", []ParamOption{
			{Label: "16:9", Value: "16:9"},
			{Label: "4:3", Value: "4:3"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:4", Value: "3:4"},
			{Label: "9:16", Value: "9:16"},
			{Label: "21:9", Value: "21:9"},
		}),
		selectParam("videoResolution", "Resolution", "720p", []ParamOption{
			{Label: "720p", Value: "720p"},
			{Label: "1080p", Value: "1080p"},
		}),
		withHelp(selectParam("duration", "Duration", "5", jimengSeedanceDurationOptions()), "即梦 CLI 支持 4-15 秒视频。"),
		selectParam("modelVersion", "Model version", "seedance2.0fast", []ParamOption{
			{Label: "Seedance 2.0 Fast", Value: "seedance2.0fast"},
			{Label: "Seedance 2.0", Value: "seedance2.0"},
			{Label: "Seedance 2.0 Fast VIP", Value: "seedance2.0fast_vip"},
			{Label: "Seedance 2.0 VIP", Value: "seedance2.0_vip"},
		}),
		withHelp(optionalNumberParam("poll", "Poll seconds", 0, 600), "Seconds for the CLI to wait before returning an intermediate task state."),
	}
}

func seedanceParams() []ParamSpec {
	return []ParamSpec{
		selectParam("ratio", "Ratio", "16:9", []ParamOption{
			{Label: "16:9", Value: "16:9"},
			{Label: "4:3", Value: "4:3"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:4", Value: "3:4"},
			{Label: "9:16", Value: "9:16"},
			{Label: "21:9", Value: "21:9"},
			{Label: "Adaptive", Value: "adaptive"},
		}),
		selectParam("resolution", "Resolution", "480p", []ParamOption{
			{Label: "480p", Value: "480p"},
			{Label: "720p", Value: "720p"},
		}),
		withHelp(selectParam("duration", "Duration", "4", seedanceDurationOptions()), "Use -1 to let the model choose a duration."),
		boolParam("generateAudio", "Generate audio", false),
		optionalNumberParam("seed", "Seed", -1, 2147483647),
		boolParam("watermark", "Watermark", false),
		boolParam("returnLastFrame", "Return last frame", false),
		withHelp(optionalNumberParam("executionExpiresAfter", "Task timeout", 3600, 259200), "Seconds before a queued or running task expires."),
	}
}

func seedanceDurationOptions() []ParamOption {
	options := []ParamOption{{Label: "Auto", Value: "-1"}}
	for duration := 4; duration <= 15; duration++ {
		value := formatNumber(float64(duration))
		options = append(options, ParamOption{Label: value + "s", Value: value})
	}
	return options
}

func jimengSeedanceDurationOptions() []ParamOption {
	options := []ParamOption{}
	for duration := 4; duration <= 15; duration++ {
		value := formatNumber(float64(duration))
		options = append(options, ParamOption{Label: value + "s", Value: value})
	}
	return options
}
