package generation

const wan27DocURL = "https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference"

func mediagoWan27Params(include4K bool) RouteParamConfig {
	config := wan27Params(include4K)
	config.Translation.Consts = nil
	return config
}

func wan27Params(include4K bool) RouteParamConfig {
	resolutionOptions := []ParamOption{
		{Label: "1K", Value: "1K"},
		{Label: "2K", Value: "2K"},
	}
	if include4K {
		resolutionOptions = append(resolutionOptions, ParamOption{
			Label:                   "4K",
			Value:                   "4K",
			RequiresNoReferenceURLs: true,
		})
	}

	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", []ParamOption{
			{Label: "1:1", Value: "1:1"},
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
			{Label: "4:3", Value: "4:3"},
			{Label: "3:4", Value: "3:4"},
		}),
		selectRouteParam(ParamResolution, "2K", resolutionOptions),
		numberRouteParam(ParamN, 1, 1, 4),
	}

	sizeTable := map[string]string{
		"1:1|1K":  "1280*1280",
		"16:9|1K": "1696*960",
		"9:16|1K": "960*1696",
		"4:3|1K":  "1472*1104",
		"3:4|1K":  "1104*1472",
		"1:1|2K":  "2048*2048",
		"16:9|2K": "2688*1536",
		"9:16|2K": "1536*2688",
		"4:3|2K":  "2368*1728",
		"3:4|2K":  "1728*2368",
	}
	if include4K {
		sizeTable["1:1|4K"] = "4096*4096"
		sizeTable["16:9|4K"] = "4096*2304"
		sizeTable["9:16|4K"] = "2304*4096"
		sizeTable["4:3|4K"] = "4096*3072"
		sizeTable["3:4|4K"] = "3072*4096"
	}

	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamN},
		},
		Joins: []ParamJoin{
			{
				From:  []ParamID{ParamAspectRatio, ParamResolution},
				To:    "size",
				Table: sizeTable,
			},
		},
		Consts: []VendorConst{
			{To: "enable_sequential", Value: false},
			{To: "thinking_mode", Value: true},
		},
	})
}
