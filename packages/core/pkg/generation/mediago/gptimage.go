package mediago

import "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/catalog"

const (
	RouteGPTImage2 = "mediago.gpt-image-2"

	versionGPTImage2 = "gpt-image-2"
)

func gptImageRoutes() []catalog.RouteSpec {
	return []catalog.RouteSpec{
		{
			ID:                    RouteGPTImage2,
			FamilyID:              familyGPTImage,
			VersionID:             versionGPTImage2,
			Kind:                  kindImage,
			Label:                 "MediaGo",
			Model:                 "gpt-image-2",
			Adapter:               adapterOpenRouterImages,
			DocURL:                openRouterImageDocs,
			SupportsReferenceURLs: true,
			Params:                gptImageParams(),
		},
	}
}

func gptImageParams() catalog.ParamConfig {
	params := []catalog.RouteParam{
		catalog.SelectParam(catalog.ParamAspectRatio, "1:1", []catalog.ParamOption{
			{Label: "Adaptive", Value: "adaptive"},
			{Label: "1:1", Value: "1:1"},
			{Label: "3:2", Value: "3:2"},
			{Label: "2:3", Value: "2:3"},
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
		}),
		catalog.SelectParam(catalog.ParamResolution, "1K", resolutionOptions("1K", "2K", "4K")),
		catalog.SelectParam(catalog.ParamQuality, "auto", []catalog.ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "High", Value: "high"},
			{Label: "Medium", Value: "medium"},
			{Label: "Low", Value: "low"},
		}),
		catalog.SelectParam(catalog.ParamOutputFormat, "png", []catalog.ParamOption{
			{Label: "PNG", Value: "png"},
			{Label: "JPEG", Value: "jpeg"},
			{Label: "WEBP", Value: "webp"},
		}),
		catalog.SelectParam(catalog.ParamModeration, "auto", []catalog.ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Low", Value: "low"},
		}),
		catalog.WithHelp(catalog.OptionalNumberParam(catalog.ParamOutputCompression, 0, 100), "Only applies to JPEG and WEBP output."),
		catalog.NumberParam(catalog.ParamN, 1, 1, 10),
		catalog.SelectParam(catalog.ParamBackground, "auto", []catalog.ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Opaque", Value: "opaque"},
		}),
	}
	config := catalog.ParamConfigFor(params, catalog.ParamTranslation{
		Moves: []catalog.ParamMove{
			{From: catalog.ParamQuality},
			{From: catalog.ParamOutputFormat},
			{From: catalog.ParamModeration},
			{From: catalog.ParamOutputCompression},
			{From: catalog.ParamN},
			{From: catalog.ParamBackground},
		},
		Joins: []catalog.ParamJoin{
			{
				From: []catalog.ParamID{catalog.ParamAspectRatio, catalog.ParamResolution},
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
	return catalog.WithCombos(config, []catalog.ParamCombo{gptImageSizeParamCombo(true)})
}

func gptImageSizeParamCombo(includeAdaptive bool) catalog.ParamCombo {
	allowed := [][]string{
		{"1:1", "1K"},
		{"1:1", "2K"},
		{"3:2", "1K"},
		{"2:3", "1K"},
		{"16:9", "2K"},
		{"16:9", "4K"},
		{"9:16", "4K"},
	}
	outputs := map[string]string{
		"1:1|1K":  "1024x1024",
		"1:1|2K":  "2048x2048",
		"3:2|1K":  "1536x1024",
		"2:3|1K":  "1024x1536",
		"16:9|2K": "2048x1152",
		"16:9|4K": "3840x2160",
		"9:16|4K": "2160x3840",
	}
	if includeAdaptive {
		allowed = append([][]string{{"adaptive", "1K"}}, allowed...)
		outputs["adaptive|1K"] = "auto"
	}
	return catalog.ParamCombo{
		Params:  []string{string(catalog.ParamAspectRatio), string(catalog.ParamResolution)},
		Allowed: allowed,
		Outputs: outputs,
	}
}
