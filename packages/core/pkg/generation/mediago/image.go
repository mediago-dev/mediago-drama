package mediago

import "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/catalog"

const (
	RouteSeedream5Lite = "mediago.seedream-5-lite"

	versionSeedream5Lite = "seedream-5-lite"
)

func imageRoutes() []catalog.RouteSpec {
	return []catalog.RouteSpec{
		{
			ID:                    RouteSeedream5Lite,
			FamilyID:              familySeedream,
			VersionID:             versionSeedream5Lite,
			Kind:                  kindImage,
			Label:                 "MediaGo",
			Model:                 "doubao-seedream-5-0-lite",
			Adapter:               adapterOpenRouterChatImage,
			DocURL:                openRouterImageDocs,
			SupportsReferenceURLs: false,
			Params:                chatImageParams(),
		},
	}
}

func chatImageParams() catalog.ParamConfig {
	params := []catalog.RouteParam{
		catalog.SelectParam(catalog.ParamAspectRatio, "1:1", standardImageAspectRatioOptions()),
		catalog.SelectParam(catalog.ParamResolution, "1K", resolutionOptions("1K", "2K", "4K")),
	}
	return catalog.ParamConfigFor(params, catalog.ParamTranslation{
		Moves: []catalog.ParamMove{
			{From: catalog.ParamAspectRatio},
			{From: catalog.ParamResolution, To: "imageSize"},
		},
	})
}

func resolutionOptions(values ...string) []catalog.ParamOption {
	options := make([]catalog.ParamOption, 0, len(values))
	for _, value := range values {
		options = append(options, catalog.ParamOption{Label: value, Value: value})
	}
	return options
}

func standardImageAspectRatioOptions() []catalog.ParamOption {
	return []catalog.ParamOption{
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

func sizeAllowedValues(ratios []string, resolutionOptions []catalog.ParamOption) [][]string {
	allowed := make([][]string, 0, len(ratios)*len(resolutionOptions))
	for _, ratio := range ratios {
		for _, resolution := range resolutionOptions {
			allowed = append(allowed, []string{ratio, resolution.Value})
		}
	}
	return allowed
}
