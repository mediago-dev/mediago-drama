package generation

func nanoBananaParams() RouteParamConfig {
	return nanoBananaParamsWithResolutions([]ParamOption{
		{Label: "512px", Value: "512px"},
		{Label: "1K", Value: "1K"},
		{Label: "2K", Value: "2K"},
		{Label: "4K", Value: "4K"},
	})
}

func officialNanoBanana31Params() RouteParamConfig {
	return nanoBananaParams()
}

func officialNanoBanana25Params() RouteParamConfig {
	return nanoBanana25Params()
}

func mediagoNanoBanana31Params() RouteParamConfig {
	resolutionOptions := []ParamOption{
		{Label: "1K", Value: "1K"},
		{Label: "2K", Value: "2K"},
		{Label: "4K", Value: "4K"},
	}
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", mediagoNanoBanana31AspectRatioOptions()),
		selectRouteParam(ParamResolution, "1K", resolutionOptions),
		numberRouteParam(ParamN, 1, 1, 4),
	}
	config := routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio},
			{From: ParamResolution, To: "imageSize"},
			{From: ParamN},
		},
	})
	return withRouteParamCombos(config, []ParamCombo{mediagoNanoBanana31SizeParamCombo(resolutionOptions)})
}

func mediagoNanoBanana25Params() RouteParamConfig {
	resolutionOptions := []ParamOption{
		{Label: "1K", Value: "1K"},
	}
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", nanoBanana25AspectRatioOptions()),
		selectRouteParam(ParamResolution, "1K", resolutionOptions),
		numberRouteParam(ParamN, 1, 1, 4),
	}
	config := routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio},
			{From: ParamResolution, To: "imageSize"},
			{From: ParamN},
		},
	})
	return withRouteParamCombos(config, []ParamCombo{nanoBanana25SizeParamCombo()})
}

func nanoBanana25Params() RouteParamConfig {
	resolutionOptions := []ParamOption{
		{Label: "1K", Value: "1K"},
	}
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", nanoBanana25AspectRatioOptions()),
		selectRouteParam(ParamResolution, "1K", resolutionOptions),
		numberRouteParam(ParamN, 1, 1, 4),
	}
	config := routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio},
			{From: ParamResolution, To: "imageSize"},
			{From: ParamN},
		},
	})
	return withRouteParamCombos(config, []ParamCombo{nanoBanana25SizeParamCombo()})
}

func mediagoNanoBanana31AspectRatioOptions() []ParamOption {
	return []ParamOption{
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
		{Label: "9:16", Value: "9:16"},
		{Label: "16:9", Value: "16:9"},
		{Label: "21:9", Value: "21:9"},
	}
}

func nanoBananaParamsWithResolutions(resolutionOptions []ParamOption) RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamAspectRatio, "1:1", nanoBananaAspectRatioOptions()),
		selectRouteParam(ParamResolution, "1K", resolutionOptions),
		numberRouteParam(ParamN, 1, 1, 4),
	}
	config := routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamAspectRatio},
			{From: ParamResolution, To: "imageSize"},
			{From: ParamN},
		},
	})
	return withRouteParamCombos(config, []ParamCombo{nanoBananaSizeParamCombo(resolutionOptions)})
}

func nanoBananaAspectRatioOptions() []ParamOption {
	return []ParamOption{
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
		{Label: "9:21", Value: "9:21"},
	}
}

func nanoBanana25AspectRatioOptions() []ParamOption {
	return []ParamOption{
		{Label: "1:1", Value: "1:1"},
		{Label: "2:3", Value: "2:3"},
		{Label: "3:2", Value: "3:2"},
		{Label: "3:4", Value: "3:4"},
		{Label: "4:3", Value: "4:3"},
		{Label: "4:5", Value: "4:5"},
		{Label: "5:4", Value: "5:4"},
		{Label: "9:16", Value: "9:16"},
		{Label: "16:9", Value: "16:9"},
		{Label: "21:9", Value: "21:9"},
	}
}

func nanoBanana25SizeParamCombo() ParamCombo {
	ratios := []string{
		"1:1",
		"2:3",
		"3:2",
		"3:4",
		"4:3",
		"4:5",
		"5:4",
		"9:16",
		"16:9",
		"21:9",
	}
	allowed := make([][]string, 0, len(ratios))
	for _, ratio := range ratios {
		allowed = append(allowed, []string{ratio, "1K"})
	}
	return ParamCombo{
		Params:  []string{string(ParamAspectRatio), string(ParamResolution)},
		Allowed: allowed,
		Outputs: map[string]string{
			"1:1|1K":  "1024x1024",
			"2:3|1K":  "832x1248",
			"3:2|1K":  "1248x832",
			"3:4|1K":  "864x1184",
			"4:3|1K":  "1184x864",
			"4:5|1K":  "896x1152",
			"5:4|1K":  "1152x896",
			"9:16|1K": "768x1344",
			"16:9|1K": "1344x768",
			"21:9|1K": "1536x672",
		},
	}
}

func mediagoNanoBanana31SizeParamCombo(resolutionOptions []ParamOption) ParamCombo {
	ratios := []string{
		"1:1",
		"1:4",
		"1:8",
		"2:3",
		"3:2",
		"3:4",
		"4:1",
		"4:3",
		"4:5",
		"5:4",
		"8:1",
		"9:16",
		"16:9",
		"21:9",
	}
	allowed := make([][]string, 0, len(ratios)*len(resolutionOptions))
	for _, ratio := range ratios {
		for _, resolution := range resolutionOptions {
			allowed = append(allowed, []string{ratio, resolution.Value})
		}
	}
	outputs := map[string]string{
		"1:1|1K":  "1024x1024",
		"1:4|1K":  "512x2048",
		"1:8|1K":  "384x3072",
		"2:3|1K":  "848x1264",
		"3:2|1K":  "1264x848",
		"3:4|1K":  "896x1200",
		"4:1|1K":  "2048x512",
		"4:3|1K":  "1200x896",
		"4:5|1K":  "928x1152",
		"5:4|1K":  "1152x928",
		"8:1|1K":  "3072x384",
		"9:16|1K": "768x1376",
		"16:9|1K": "1376x768",
		"21:9|1K": "1584x672",
		"1:1|2K":  "2048x2048",
		"1:4|2K":  "1024x4096",
		"1:8|2K":  "768x6144",
		"2:3|2K":  "1696x2528",
		"3:2|2K":  "2528x1696",
		"3:4|2K":  "1792x2400",
		"4:1|2K":  "4096x1024",
		"4:3|2K":  "2400x1792",
		"4:5|2K":  "1856x2304",
		"5:4|2K":  "2304x1856",
		"8:1|2K":  "6144x768",
		"9:16|2K": "1536x2752",
		"16:9|2K": "2752x1536",
		"21:9|2K": "3168x1344",
		"1:1|4K":  "4096x4096",
		"1:4|4K":  "2048x8192",
		"1:8|4K":  "1536x12288",
		"2:3|4K":  "3392x5056",
		"3:2|4K":  "5056x3392",
		"3:4|4K":  "3584x4800",
		"4:1|4K":  "8192x2048",
		"4:3|4K":  "4800x3584",
		"4:5|4K":  "3712x4608",
		"5:4|4K":  "4608x3712",
		"8:1|4K":  "12288x1536",
		"9:16|4K": "3072x5504",
		"16:9|4K": "5504x3072",
		"21:9|4K": "6336x2688",
	}
	return ParamCombo{
		Params:  []string{string(ParamAspectRatio), string(ParamResolution)},
		Allowed: allowed,
		Outputs: outputs,
	}
}

func nanoBananaSizeParamCombo(resolutionOptions []ParamOption) ParamCombo {
	ratios := []string{
		"1:1",
		"1:4",
		"1:8",
		"2:3",
		"3:2",
		"3:4",
		"4:1",
		"4:3",
		"4:5",
		"5:4",
		"8:1",
		"16:9",
		"9:16",
		"21:9",
		"9:21",
	}
	allowed := make([][]string, 0, len(ratios)*len(resolutionOptions))
	for _, ratio := range ratios {
		for _, resolution := range resolutionOptions {
			allowed = append(allowed, []string{ratio, resolution.Value})
		}
	}

	outputs := map[string]string{
		"1:1|512px":  "512x512",
		"1:4|512px":  "256x1024",
		"1:8|512px":  "192x1536",
		"2:3|512px":  "424x632",
		"3:2|512px":  "632x424",
		"3:4|512px":  "448x600",
		"4:1|512px":  "1024x256",
		"4:3|512px":  "600x448",
		"4:5|512px":  "464x576",
		"5:4|512px":  "576x464",
		"8:1|512px":  "1536x192",
		"16:9|512px": "688x384",
		"9:16|512px": "384x688",
		"21:9|512px": "792x168",
		"9:21|512px": "168x792",
		"1:1|1K":     "1024x1024",
		"1:4|1K":     "512x2048",
		"1:8|1K":     "384x3072",
		"2:3|1K":     "848x1264",
		"3:2|1K":     "1264x848",
		"3:4|1K":     "896x1200",
		"4:1|1K":     "2048x512",
		"4:3|1K":     "1200x896",
		"4:5|1K":     "928x1152",
		"5:4|1K":     "1152x928",
		"8:1|1K":     "3072x384",
		"16:9|1K":    "1376x768",
		"9:16|1K":    "768x1376",
		"21:9|1K":    "1584x672",
		"9:21|1K":    "672x1584",
		"1:1|2K":     "2048x2048",
		"1:4|2K":     "1024x4096",
		"1:8|2K":     "768x6144",
		"2:3|2K":     "1696x2528",
		"3:2|2K":     "2528x1696",
		"3:4|2K":     "1792x2400",
		"4:1|2K":     "4096x1024",
		"4:3|2K":     "2400x1792",
		"4:5|2K":     "1856x2304",
		"5:4|2K":     "2304x1856",
		"8:1|2K":     "6144x768",
		"16:9|2K":    "2752x1536",
		"9:16|2K":    "1536x2752",
		"21:9|2K":    "3168x1344",
		"9:21|2K":    "1344x3168",
		"1:1|4K":     "4096x4096",
		"1:4|4K":     "2048x8192",
		"1:8|4K":     "1536x12288",
		"2:3|4K":     "3392x5056",
		"3:2|4K":     "5056x3392",
		"3:4|4K":     "3584x4800",
		"4:1|4K":     "8192x2048",
		"4:3|4K":     "4800x3584",
		"4:5|4K":     "3712x4608",
		"5:4|4K":     "4608x3712",
		"8:1|4K":     "12288x1536",
		"16:9|4K":    "5504x3072",
		"9:16|4K":    "3072x5504",
		"21:9|4K":    "6336x2688",
		"9:21|4K":    "2688x6336",
	}
	resolutionSet := make(map[string]bool, len(resolutionOptions))
	for _, resolution := range resolutionOptions {
		resolutionSet[resolution.Value] = true
	}
	for key := range outputs {
		resolution := key
		for index := len(key) - 1; index >= 0; index-- {
			if key[index] == '|' {
				resolution = key[index+1:]
				break
			}
		}
		if !resolutionSet[resolution] {
			delete(outputs, key)
		}
	}
	return ParamCombo{
		Params:  []string{string(ParamAspectRatio), string(ParamResolution)},
		Allowed: allowed,
		Outputs: outputs,
	}
}
