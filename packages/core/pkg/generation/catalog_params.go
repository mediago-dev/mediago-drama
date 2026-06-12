package generation

func selectParam(name string, label string, defaultValue string, options []ParamOption) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "select",
		Default: defaultValue,
		Options: options,
	}
}

func numberParam(name string, label string, defaultValue float64, minValue float64, maxValue float64) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "number",
		Default: defaultValue,
		Min:     &minValue,
		Max:     &maxValue,
	}
}

func optionalNumberParam(name string, label string, minValue float64, maxValue float64) ParamSpec {
	return ParamSpec{
		Name:  name,
		Label: label,
		Type:  "number",
		Min:   &minValue,
		Max:   &maxValue,
	}
}

func boolParam(name string, label string, defaultValue bool) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "boolean",
		Default: defaultValue,
	}
}

func textParam(name string, label string, defaultValue string) ParamSpec {
	return ParamSpec{
		Name:    name,
		Label:   label,
		Type:    "text",
		Default: defaultValue,
	}
}

func withHelp(param ParamSpec, help string) ParamSpec {
	param.Help = help
	return param
}
