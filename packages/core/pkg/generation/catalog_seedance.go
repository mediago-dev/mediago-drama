package generation

func officialSeedanceParams() RouteParamConfig {
	base := seedanceParams()
	params := append(cloneRouteParams(base.CanonicalParams), textRouteParam(ParamNegativePrompt, ""))
	translation := cloneParamTranslation(base.Translation)
	translation.Moves = append(translation.Moves, ParamMove{From: ParamNegativePrompt})
	return routeParamConfig(params, translation)
}

func dmxSeedanceParams() RouteParamConfig {
	return seedanceParams()
}

func jimengSeedanceParams() RouteParamConfig {
	return jimengSeedanceRouteParams(false)
}

func jimengSeedanceVIPParams() RouteParamConfig {
	return jimengSeedanceRouteParams(true)
}

func pippitSeedanceParams() RouteParamConfig {
	return pippitSeedanceRouteParams(false)
}

func pippitSeedanceStandardParams() RouteParamConfig {
	return pippitSeedanceRouteParams(true)
}

func pippitSeedanceRouteParams(allow1080p bool) RouteParamConfig {
	resolutionOptions := []ParamOption{{Label: "720p", Value: "720p"}}
	if allow1080p {
		resolutionOptions = append(resolutionOptions, ParamOption{Label: "1080p", Value: "1080p"})
	}

	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", []ParamOption{
			{Label: "16:9", Value: "16:9"},
			{Label: "4:3", Value: "4:3"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:4", Value: "3:4"},
			{Label: "9:16", Value: "9:16"},
		}),
		selectRouteParam(ParamResolution, "720p", resolutionOptions),
		withRouteHelp(selectRouteParam(ParamDuration, "5", jimengSeedanceDurationOptions()), "小云雀支持 4-15 秒视频。"),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio, To: "ratio"},
			{From: ParamResolution},
			{From: ParamDuration},
		},
	})
}

func libTVSeedanceParams() RouteParamConfig {
	return libTVSeedanceRouteParams(false)
}

func libTVSeedanceStandardParams() RouteParamConfig {
	return libTVSeedanceRouteParams(true)
}

func libTVSeedanceRouteParams(allowHighRes bool) RouteParamConfig {
	resolutionOptions := []ParamOption{
		{Label: "480p", Value: "480p"},
		{Label: "720p", Value: "720p"},
	}
	if allowHighRes {
		resolutionOptions = append(
			resolutionOptions,
			ParamOption{Label: "1080p", Value: "1080p"},
			ParamOption{Label: "4K", Value: "4k"},
		)
	}

	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", []ParamOption{
			{Label: "Auto", Value: "adaptive"},
			{Label: "16:9", Value: "16:9"},
			{Label: "4:3", Value: "4:3"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:4", Value: "3:4"},
			{Label: "9:16", Value: "9:16"},
			{Label: "21:9", Value: "21:9"},
		}),
		selectRouteParam(ParamResolution, "720p", resolutionOptions),
		withRouteHelp(selectRouteParam(ParamDuration, "5", jimengSeedanceDurationOptions()), "LibTV Seedance 2.0 支持 4-15 秒视频。"),
		boolRouteParam(ParamGenerateAudio, true),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio, To: "ratio"},
			{From: ParamResolution},
			{From: ParamDuration},
			{From: ParamGenerateAudio, To: "enableSound"},
		},
	})
}

func jimengSeedanceRouteParams(allow1080p bool) RouteParamConfig {
	resolutionOptions := []ParamOption{{Label: "720p", Value: "720p"}}
	if allow1080p {
		resolutionOptions = append(resolutionOptions, ParamOption{Label: "1080p", Value: "1080p"})
	}

	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", []ParamOption{
			{Label: "16:9", Value: "16:9"},
			{Label: "4:3", Value: "4:3"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:4", Value: "3:4"},
			{Label: "9:16", Value: "9:16"},
			{Label: "21:9", Value: "21:9"},
		}),
		selectRouteParam(ParamResolution, "720p", resolutionOptions),
		withRouteHelp(selectRouteParam(ParamDuration, "5", jimengSeedanceDurationOptions()), "即梦支持 4-15 秒视频。"),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio, To: "ratio"},
			{From: ParamResolution, To: "videoResolution"},
			{From: ParamDuration},
		},
	})
}

func seedanceParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", []ParamOption{
			{Label: "16:9", Value: "16:9"},
			{Label: "4:3", Value: "4:3"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:4", Value: "3:4"},
			{Label: "9:16", Value: "9:16"},
			{Label: "21:9", Value: "21:9"},
			{Label: "Adaptive", Value: "adaptive"},
		}),
		selectRouteParam(ParamResolution, "480p", []ParamOption{
			{Label: "480p", Value: "480p"},
			{Label: "720p", Value: "720p"},
		}),
		withRouteHelp(selectRouteParam(ParamDuration, "4", seedanceDurationOptions()), "Use -1 to let the model choose a duration."),
		boolRouteParam(ParamGenerateAudio, false),
		optionalNumberRouteParam(ParamSeed, -1, 2147483647),
		boolRouteParam(ParamWatermark, false),
		boolRouteParam(ParamReturnLastFrame, false),
		withRouteHelp(optionalNumberRouteParam(ParamExecutionExpiresAfter, 3600, 259200), "Seconds before a queued or running task expires."),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio, To: "ratio"},
			{From: ParamResolution},
			{From: ParamDuration},
			{From: ParamGenerateAudio},
			{From: ParamSeed},
			{From: ParamWatermark},
			{From: ParamReturnLastFrame},
			{From: ParamExecutionExpiresAfter},
		},
	})
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
