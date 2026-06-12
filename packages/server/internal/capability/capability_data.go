package capability

import coregeneration "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"

type capabilitySpec struct {
	Capability    AtomicCapability
	RelatedRoutes func() []string
}

var capabilitySpecs = []capabilitySpec{
	{
		Capability: AtomicCapability{
			ID:          "image.generate",
			Name:        "图片生成",
			Description: "根据提示词和参考图生成图片素材。",
			Kind:        string(coregeneration.KindImage),
			Category:    CategoryGeneration,
			Inputs:      []IOKind{IOKindText, IOKindImage},
			Outputs:     []IOKind{IOKindImage},
			Status:      StatusAvailable,
			Icon:        "Image",
			Surface:     "generation",
		},
		RelatedRoutes: routesByKind(coregeneration.KindImage),
	},
	{
		Capability: AtomicCapability{
			ID:          "video.generate",
			Name:        "视频生成",
			Description: "根据提示词和参考素材生成视频片段。",
			Kind:        string(coregeneration.KindVideo),
			Category:    CategoryGeneration,
			Inputs:      []IOKind{IOKindText, IOKindImage, IOKindVideo},
			Outputs:     []IOKind{IOKindVideo},
			Status:      StatusAvailable,
			Icon:        "Film",
			Surface:     "generation",
		},
		RelatedRoutes: routesByKind(coregeneration.KindVideo),
	},
	{
		Capability: AtomicCapability{
			ID:          "text.generate",
			Name:        "文本生成",
			Description: "生成、改写和续写创作文本。",
			Kind:        string(coregeneration.KindText),
			Category:    CategoryGeneration,
			Inputs:      []IOKind{IOKindText},
			Outputs:     []IOKind{IOKindText},
			Status:      StatusAvailable,
			Icon:        "FileText",
			Surface:     "generation",
		},
		RelatedRoutes: routesByKind(coregeneration.KindText),
	},
}

func routesByKind(kind coregeneration.Kind) func() []string {
	return func() []string {
		ids := []string{}
		for _, route := range coregeneration.Routes() {
			if route.Kind == kind {
				ids = append(ids, route.ID)
			}
		}
		return ids
	}
}
