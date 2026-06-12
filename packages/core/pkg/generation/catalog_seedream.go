package generation

func seedreamParams() []ParamSpec {
	return []ParamSpec{
		withHelp(selectParam("size", "Size", "2K", []ParamOption{
			{Label: "2K", Value: "2K"},
			{Label: "3K", Value: "3K"},
			{Label: "2048x2048", Value: "2048x2048"},
			{Label: "16:9 2K", Value: "2848x1600"},
			{Label: "9:16 2K", Value: "1600x2848"},
		}), "Seedream accepts named quality sizes and exact pixel sizes."),
		selectParam("outputFormat", "Output format", "png", []ParamOption{
			{Label: "PNG", Value: "png"},
			{Label: "JPEG", Value: "jpeg"},
		}),
		boolParam("watermark", "Watermark", false),
		numberParam("n", "Images", 1, 1, 4),
	}
}
