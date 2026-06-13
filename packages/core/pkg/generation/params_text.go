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
		Max:   paramFloat(32768),
	},
}
