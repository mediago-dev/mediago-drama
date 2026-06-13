package generation

func seedreamParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "adaptive", []ParamOption{
			{Label: "Adaptive", Value: "adaptive"},
			{Label: "1:1", Value: "1:1"},
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
		}),
		selectRouteParam(ParamResolution, "2K", []ParamOption{
			{Label: "2K", Value: "2K"},
			{Label: "3K", Value: "3K"},
		}),
		selectRouteParam(ParamOutputFormat, "png", []ParamOption{
			{Label: "PNG", Value: "png"},
			{Label: "JPEG", Value: "jpeg"},
		}),
		boolRouteParam(ParamWatermark, false),
		numberRouteParam(ParamN, 1, 1, 4),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamOutputFormat},
			{From: ParamWatermark},
			{From: ParamN},
		},
		Joins: []ParamJoin{
			{
				From: []ParamID{ParamAspectRatio, ParamResolution},
				To:   "size",
				Table: map[string]string{
					"adaptive|2K": "2K",
					"adaptive|3K": "3K",
					"1:1|2K":      "2048x2048",
					"1:1|3K":      "3072x3072",
					"16:9|2K":     "2848x1600",
					"16:9|3K":     "3072x1728",
					"9:16|2K":     "1600x2848",
					"9:16|3K":     "1728x3072",
				},
			},
		},
	})
}

func jimengSeedreamParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", []ParamOption{
			{Label: "1:1", Value: "1:1"},
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
			{Label: "4:3", Value: "4:3"},
			{Label: "3:4", Value: "3:4"},
			{Label: "21:9", Value: "21:9"},
		}),
		selectRouteParam(ParamResolution, "2K", []ParamOption{
			{Label: "2K", Value: "2K"},
			{Label: "4K", Value: "4K"},
		}),
	}
	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio, To: "ratio"},
			{From: ParamResolution, To: "resolutionType", Values: map[string]string{
				"2K": "2k",
				"4K": "4k",
			}},
		},
	})
}
