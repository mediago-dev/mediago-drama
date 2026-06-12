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

func jimengSeedreamParams() []ParamSpec {
	return []ParamSpec{
		selectParam("ratio", "Ratio", "1:1", []ParamOption{
			{Label: "1:1", Value: "1:1"},
			{Label: "16:9", Value: "16:9"},
			{Label: "9:16", Value: "9:16"},
			{Label: "4:3", Value: "4:3"},
			{Label: "3:4", Value: "3:4"},
			{Label: "21:9", Value: "21:9"},
		}),
		selectParam("resolutionType", "Resolution", "2k", []ParamOption{
			{Label: "2K", Value: "2k"},
			{Label: "4K", Value: "4k"},
		}),
		withHelp(optionalNumberParam("poll", "Poll seconds", 30, 600), "Seconds for the CLI to wait before returning an intermediate task state."),
	}
}
