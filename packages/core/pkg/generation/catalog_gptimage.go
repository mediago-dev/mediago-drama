package generation

func officialGPTImageParams() RouteParamConfig {
	base := gptImageParams()
	params := append(cloneRouteParams(base.CanonicalParams), selectRouteParam(ParamBackground, "auto", []ParamOption{
		{Label: "Auto", Value: "auto"},
		{Label: "Opaque", Value: "opaque"},
	}))
	translation := cloneParamTranslation(base.Translation)
	translation.Moves = append(translation.Moves, ParamMove{From: ParamBackground})
	return routeParamConfig(params, translation)
}

func dmxGPTImageParams() RouteParamConfig {
	return gptImageParams()
}

func gptImageParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", []ParamOption{
			{Label: "Adaptive", Value: "adaptive"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:2", Value: "3:2"},
			{Label: "2:3", Value: "2:3"},
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
		}),
		selectRouteParam(ParamResolution, "1K", []ParamOption{
			{Label: "1K", Value: "1K"},
			{Label: "2K", Value: "2K"},
			{Label: "4K", Value: "4K"},
		}),
		selectRouteParam(ParamQuality, "low", []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "High", Value: "high"},
			{Label: "Medium", Value: "medium"},
			{Label: "Low", Value: "low"},
		}),
		selectRouteParam(ParamOutputFormat, "jpeg", []ParamOption{
			{Label: "PNG", Value: "png"},
			{Label: "JPEG", Value: "jpeg"},
			{Label: "WEBP", Value: "webp"},
		}),
		selectRouteParam(ParamModeration, "auto", []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Low", Value: "low"},
		}),
		withRouteHelp(numberRouteParam(ParamOutputCompression, 100, 0, 100), "Only applies to JPEG and WEBP output."),
		numberRouteParam(ParamN, 1, 1, 10),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamQuality},
			{From: ParamOutputFormat},
			{From: ParamModeration},
			{From: ParamOutputCompression},
			{From: ParamN},
		},
		Joins: []ParamJoin{
			{
				From: []ParamID{ParamAspectRatio, ParamResolution},
				To:   "size",
				Table: map[string]string{
					"adaptive|1K": "auto",
					"1:1|1K":      "1024x1024",
					"1:1|2K":      "2048x2048",
					"3:2|1K":      "1536x1024",
					"2:3|1K":      "1024x1536",
					"16:9|2K":     "2048x1152",
					"16:9|4K":     "3840x2160",
					"9:16|4K":     "2160x3840",
				},
			},
		},
	})
}
