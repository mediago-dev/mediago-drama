package generation

const (
	happyHorse11DocURL = "https://help.aliyun.com/zh/model-studio/video-generate-edit-model/"
)

func mediagoHappyHorse11Params() RouteParamConfig {
	return identityRouteParamConfig(cloneRouteParams(happyHorse11Params().CanonicalParams))
}

func happyHorse11Params() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", []ParamOption{
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
			{Label: "1:1", Value: "1:1"},
			{Label: "4:3", Value: "4:3"},
			{Label: "3:4", Value: "3:4"},
			{Label: "4:5", Value: "4:5"},
			{Label: "5:4", Value: "5:4"},
			{Label: "9:21", Value: "9:21"},
			{Label: "21:9", Value: "21:9"},
		}),
		selectRouteParam(ParamResolution, "720p", []ParamOption{
			{Label: "720P", Value: "720p"},
			{Label: "1080P", Value: "1080p"},
		}),
		withRouteHelp(selectRouteParam(ParamDuration, "5", happyHorseDurationOptions()), "HappyHorse 1.1 支持 3-15 秒视频。"),
	}
	moves := []ParamMove{
		{From: ParamAspectRatio, To: "ratio"},
		{From: ParamResolution, Values: map[string]string{
			"720p":  "720P",
			"1080p": "1080P",
		}},
		{From: ParamDuration},
	}

	return routeParamConfig(params, ParamTranslation{Moves: moves})
}

func happyHorseDurationOptions() []ParamOption {
	options := make([]ParamOption, 0, 13)
	for duration := 3; duration <= 15; duration++ {
		value := formatNumber(float64(duration))
		options = append(options, ParamOption{Label: value + "s", Value: value})
	}
	return options
}
