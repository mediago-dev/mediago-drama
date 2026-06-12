package generation

func officialGPTImageParams() []ParamSpec {
	params := gptImageParams()
	params = append(params, selectParam("background", "Background", "auto", []ParamOption{
		{Label: "Auto", Value: "auto"},
		{Label: "Opaque", Value: "opaque"},
	}))
	return params
}

func dmxGPTImageParams() []ParamSpec {
	return gptImageParams()
}

func gptImageParams() []ParamSpec {
	return []ParamSpec{
		selectParam("size", "Size", "1024x1024", []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "1024x1024", Value: "1024x1024"},
			{Label: "1536x1024", Value: "1536x1024"},
			{Label: "1024x1536", Value: "1024x1536"},
			{Label: "2048x2048", Value: "2048x2048"},
			{Label: "2048x1152", Value: "2048x1152"},
			{Label: "3840x2160", Value: "3840x2160"},
			{Label: "2160x3840", Value: "2160x3840"},
		}),
		selectParam("quality", "Quality", "low", []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "High", Value: "high"},
			{Label: "Medium", Value: "medium"},
			{Label: "Low", Value: "low"},
		}),
		selectParam("outputFormat", "Output format", "jpeg", []ParamOption{
			{Label: "PNG", Value: "png"},
			{Label: "JPEG", Value: "jpeg"},
			{Label: "WEBP", Value: "webp"},
		}),
		selectParam("moderation", "Moderation", "auto", []ParamOption{
			{Label: "Auto", Value: "auto"},
			{Label: "Low", Value: "low"},
		}),
		withHelp(numberParam("outputCompression", "Output compression", 100, 0, 100), "Only applies to JPEG and WEBP output."),
		numberParam("n", "Images", 1, 1, 10),
	}
}
