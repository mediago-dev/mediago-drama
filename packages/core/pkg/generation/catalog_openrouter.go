package generation

const (
	openRouterImageDocs = "https://openrouter.ai/docs/guides/overview/multimodal/image-generation"
	openRouterVideoDocs = "https://openrouter.ai/docs/guides/overview/multimodal/video-generation"
)

func openRouterImageParams() []ParamSpec {
	return []ParamSpec{
		selectParam("aspectRatio", "Aspect ratio", "1:1", []ParamOption{
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
		}),
		selectParam("imageSize", "Image size", "1K", []ParamOption{
			{Label: "1K", Value: "1K"},
			{Label: "2K", Value: "2K"},
			{Label: "4K", Value: "4K"},
		}),
	}
}

func openRouterVideoParams() []ParamSpec {
	return []ParamSpec{
		selectParam("aspectRatio", "Aspect ratio", "16:9", []ParamOption{
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
			{Label: "1:1", Value: "1:1"},
			{Label: "4:3", Value: "4:3"},
			{Label: "3:4", Value: "3:4"},
			{Label: "21:9", Value: "21:9"},
		}),
		selectParam("resolution", "Resolution", "480p", []ParamOption{
			{Label: "480p", Value: "480p"},
			{Label: "720p", Value: "720p"},
			{Label: "1080p", Value: "1080p"},
		}),
		numberParam("duration", "Duration", 3, 3, 15),
		textParam("negativePrompt", "Negative prompt", ""),
		boolParam("generateAudio", "Generate audio", false),
	}
}
