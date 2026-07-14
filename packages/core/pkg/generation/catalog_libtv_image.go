package generation

func libTVGPTImageParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", libTVImageOptions(
			"1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21",
		)),
		selectRouteParam(ParamResolution, "2K", libTVResolutionOptions("1K", "2K", "4K")),
		selectRouteParam(ParamQuality, "medium", []ParamOption{
			{Label: "Low", Value: "low"},
			{Label: "Medium", Value: "medium"},
			{Label: "High", Value: "high"},
		}),
	}
	return routeParamConfig(params, ParamTranslation{Moves: []ParamMove{
		{From: ParamAspectRatio, To: "ratio"},
		{From: ParamResolution},
		{From: ParamQuality},
	}})
}

func libTVNanoBananaParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", libTVImageOptions(
			"adaptive", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "8:1", "1:8", "4:1", "1:4", "21:9",
		)),
		selectRouteParam(ParamResolution, "2K", libTVResolutionOptions("1K", "2K", "4K")),
	}
	return routeParamConfig(params, ParamTranslation{Moves: []ParamMove{
		{
			From: ParamAspectRatio,
			To:   "ratio",
			Values: map[string]string{
				"adaptive": "auto",
				"1:1":      "1:1",
				"9:16":     "9:16",
				"16:9":     "16:9",
				"3:4":      "3:4",
				"4:3":      "4:3",
				"3:2":      "3:2",
				"2:3":      "2:3",
				"4:5":      "4:5",
				"5:4":      "5:4",
				"8:1":      "8:1",
				"1:8":      "1:8",
				"4:1":      "4:1",
				"1:4":      "1:4",
				"21:9":     "21:9",
			},
		},
		{From: ParamResolution, To: "quality"},
	}})
}

func libTVSeedreamParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "16:9", libTVImageOptions(
			"1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3",
		)),
		selectRouteParam(ParamResolution, "2K", libTVResolutionOptions("2K", "3K")),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio, To: "ratio"},
			{From: ParamResolution, To: "quality"},
		},
		Consts: []VendorConst{
			{To: "sequential", Value: 0},
		},
	})
}

func libTVImageOptions(values ...string) []ParamOption {
	options := make([]ParamOption, 0, len(values))
	for _, value := range values {
		label := value
		if value == "adaptive" {
			label = "Adaptive"
		}
		options = append(options, ParamOption{Label: label, Value: value})
	}
	return options
}

func libTVResolutionOptions(values ...string) []ParamOption {
	options := make([]ParamOption, 0, len(values))
	for _, value := range values {
		options = append(options, ParamOption{Label: value, Value: value})
	}
	return options
}
