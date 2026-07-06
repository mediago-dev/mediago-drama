package mediago

import "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/catalog"

const (
	RouteNanoBanana31  = "mediago.gemini-3.1-flash-image"
	RouteNanoBananaPro = "mediago.gemini-3-pro-image"
	RouteNanoBanana25  = "mediago.gemini-2.5-flash-image"

	versionNanoBanana31  = "gemini-3.1-flash-image-preview"
	versionNanoBananaPro = "gemini-3-pro-image-preview"
	versionNanoBanana25  = "gemini-2.5-flash-image"
)

func geminiImageRoutes() []catalog.RouteSpec {
	return []catalog.RouteSpec{
		geminiImageRoute(RouteNanoBanana31, versionNanoBanana31, "gemini-3.1-flash-image", nanoBanana31Params()),
		geminiImageRoute(RouteNanoBananaPro, versionNanoBananaPro, "gemini-3-pro-image", nanoBananaProParams()),
		geminiImageRoute(RouteNanoBanana25, versionNanoBanana25, "gemini-2.5-flash-image", nanoBanana25Params()),
	}
}

func geminiImageRoute(routeID string, versionID string, model string, params catalog.ParamConfig) catalog.RouteSpec {
	return catalog.RouteSpec{
		ID:                    routeID,
		FamilyID:              familyNanoBanana,
		VersionID:             versionID,
		Kind:                  kindImage,
		Label:                 "MediaGo",
		Model:                 model,
		Adapter:               adapterOpenRouterChatImage,
		DocURL:                openRouterImageDocs,
		SupportsReferenceURLs: true,
		MaxReferenceURLs:      4,
		Params:                params,
	}
}

func nanoBanana31Params() catalog.ParamConfig {
	resolutions := resolutionOptions("1K", "2K", "4K")
	params := []catalog.RouteParam{
		catalog.SelectParam(catalog.ParamAspectRatio, "1:1", nanoBanana31AspectRatioOptions()),
		catalog.SelectParam(catalog.ParamResolution, "1K", resolutions),
		catalog.NumberParam(catalog.ParamN, 1, 1, 4),
	}
	config := catalog.ParamConfigFor(params, catalog.ParamTranslation{
		Moves: []catalog.ParamMove{
			{From: catalog.ParamAspectRatio},
			{From: catalog.ParamResolution, To: "imageSize"},
			{From: catalog.ParamN},
		},
	})
	return catalog.WithCombos(config, []catalog.ParamCombo{nanoBanana31SizeParamCombo(resolutions)})
}

func nanoBananaProParams() catalog.ParamConfig {
	resolutions := resolutionOptions("1K", "2K", "4K")
	params := []catalog.RouteParam{
		catalog.SelectParam(catalog.ParamAspectRatio, "1:1", standardImageAspectRatioOptions()),
		catalog.SelectParam(catalog.ParamResolution, "1K", resolutions),
		catalog.NumberParam(catalog.ParamN, 1, 1, 4),
	}
	config := catalog.ParamConfigFor(params, catalog.ParamTranslation{
		Moves: []catalog.ParamMove{
			{From: catalog.ParamAspectRatio},
			{From: catalog.ParamResolution, To: "imageSize"},
			{From: catalog.ParamN},
		},
	})
	return catalog.WithCombos(config, []catalog.ParamCombo{nanoBananaProSizeParamCombo(resolutions)})
}

func nanoBanana25Params() catalog.ParamConfig {
	params := []catalog.RouteParam{
		catalog.SelectParam(catalog.ParamAspectRatio, "1:1", standardImageAspectRatioOptions()),
		catalog.SelectParam(catalog.ParamResolution, "1K", resolutionOptions("1K")),
		catalog.NumberParam(catalog.ParamN, 1, 1, 4),
	}
	config := catalog.ParamConfigFor(params, catalog.ParamTranslation{
		Moves: []catalog.ParamMove{
			{From: catalog.ParamAspectRatio},
			{From: catalog.ParamResolution, To: "imageSize"},
			{From: catalog.ParamN},
		},
	})
	return catalog.WithCombos(config, []catalog.ParamCombo{nanoBanana25SizeParamCombo()})
}

func nanoBanana31AspectRatioOptions() []catalog.ParamOption {
	return []catalog.ParamOption{
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

func nanoBanana25SizeParamCombo() catalog.ParamCombo {
	ratios := []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
	allowed := make([][]string, 0, len(ratios))
	for _, ratio := range ratios {
		allowed = append(allowed, []string{ratio, "1K"})
	}
	return catalog.ParamCombo{
		Params:  []string{string(catalog.ParamAspectRatio), string(catalog.ParamResolution)},
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

func nanoBananaProSizeParamCombo(resolutionOptions []catalog.ParamOption) catalog.ParamCombo {
	ratios := []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
	allowed := sizeAllowedValues(ratios, resolutionOptions)
	return catalog.ParamCombo{
		Params:  []string{string(catalog.ParamAspectRatio), string(catalog.ParamResolution)},
		Allowed: allowed,
		Outputs: map[string]string{
			"1:1|1K":  "1024x1024",
			"2:3|1K":  "848x1264",
			"3:2|1K":  "1264x848",
			"3:4|1K":  "896x1200",
			"4:3|1K":  "1200x896",
			"4:5|1K":  "928x1152",
			"5:4|1K":  "1152x928",
			"9:16|1K": "768x1376",
			"16:9|1K": "1376x768",
			"21:9|1K": "1584x672",
			"1:1|2K":  "2048x2048",
			"2:3|2K":  "1696x2528",
			"3:2|2K":  "2528x1696",
			"3:4|2K":  "1792x2400",
			"4:3|2K":  "2400x1792",
			"4:5|2K":  "1856x2304",
			"5:4|2K":  "2304x1856",
			"9:16|2K": "1536x2752",
			"16:9|2K": "2752x1536",
			"21:9|2K": "3168x1344",
			"1:1|4K":  "4096x4096",
			"2:3|4K":  "3392x5056",
			"3:2|4K":  "5056x3392",
			"3:4|4K":  "3584x4800",
			"4:3|4K":  "4800x3584",
			"4:5|4K":  "3712x4608",
			"5:4|4K":  "4608x3712",
			"9:16|4K": "3072x5504",
			"16:9|4K": "5504x3072",
			"21:9|4K": "6336x2688",
		},
	}
}

func nanoBanana31SizeParamCombo(resolutionOptions []catalog.ParamOption) catalog.ParamCombo {
	ratios := []string{"1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"}
	allowed := sizeAllowedValues(ratios, resolutionOptions)
	return catalog.ParamCombo{
		Params:  []string{string(catalog.ParamAspectRatio), string(catalog.ParamResolution)},
		Allowed: allowed,
		Outputs: map[string]string{
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
		},
	}
}
