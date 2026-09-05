package generation

var textParamGroups = []ParamGroupSpec{
	{ID: ParamGroupOther, Label: "其他"},
}

var textParamRegistry = map[ParamID]CanonicalParamSpec{
	ParamTemperature: {
		ID:    ParamTemperature,
		Label: "Temperature",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(0),
		Max:   paramFloat(2),
	},
	ParamMaxTokens: {
		ID:    ParamMaxTokens,
		Label: "Max tokens",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(1),
		Max:   paramFloat(128000),
	},
	ParamReasoningEffort: {
		ID:      ParamReasoningEffort,
		Label:   "推理强度",
		Type:    "select",
		Group:   ParamGroupOther,
		Options: reasoningEffortOptions(),
	},
}

func reasoningEffortOptions() []ParamOption {
	return []ParamOption{
		{Label: "不推理", Value: "none"},
		{Label: "低", Value: "low"},
		{Label: "中（推荐）", Value: "medium"},
		{Label: "高", Value: "high"},
		{Label: "超高", Value: "xhigh"},
		{Label: "最大", Value: "max"},
	}
}
