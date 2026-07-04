package generation

// ParamID is a canonical route parameter name shared by UI, storage, and API callers.
type ParamID string

const (
	ParamAspectRatio           ParamID = "aspectRatio"
	ParamResolution            ParamID = "resolution"
	ParamDuration              ParamID = "duration"
	ParamN                     ParamID = "n"
	ParamSeed                  ParamID = "seed"
	ParamOutputFormat          ParamID = "outputFormat"
	ParamWatermark             ParamID = "watermark"
	ParamQuality               ParamID = "quality"
	ParamNegativePrompt        ParamID = "negativePrompt"
	ParamGenerateAudio         ParamID = "generateAudio"
	ParamReturnLastFrame       ParamID = "returnLastFrame"
	ParamExecutionExpiresAfter ParamID = "executionExpiresAfter"
	ParamBackground            ParamID = "background"
	ParamModeration            ParamID = "moderation"
	ParamOutputCompression     ParamID = "outputCompression"
	ParamTemperature           ParamID = "temperature"
	ParamMaxTokens             ParamID = "maxTokens"
	ParamVoiceID               ParamID = "voiceId"
	ParamSpeed                 ParamID = "speed"
	ParamVolume                ParamID = "volume"
	ParamPitch                 ParamID = "pitch"
	ParamSampleRate            ParamID = "sampleRate"
	ParamBitrate               ParamID = "bitrate"
)

type ParamGroupID string

const (
	ParamGroupSize     ParamGroupID = "size"
	ParamGroupDuration ParamGroupID = "duration"
	ParamGroupCount    ParamGroupID = "count"
	ParamGroupVoice    ParamGroupID = "voice"
	ParamGroupAudio    ParamGroupID = "audio"
	ParamGroupOther    ParamGroupID = "other"
)

type ParamGroupSpec struct {
	ID    ParamGroupID
	Label string
}

var paramRegistryByKind = map[Kind]map[ParamID]CanonicalParamSpec{
	KindAudio: audioParamRegistry,
	KindImage: imageParamRegistry,
	KindVideo: videoParamRegistry,
	KindText:  textParamRegistry,
}

var paramGroupsByKind = map[Kind][]ParamGroupSpec{
	KindAudio: audioParamGroups,
	KindImage: imageParamGroups,
	KindVideo: videoParamGroups,
	KindText:  textParamGroups,
}

func CanonicalParam(kind Kind, id ParamID) (CanonicalParamSpec, bool) {
	registry, ok := paramRegistryByKind[kind]
	if !ok {
		return CanonicalParamSpec{}, false
	}
	spec, ok := registry[id]
	if !ok {
		return CanonicalParamSpec{}, false
	}
	return cloneCanonicalParamSpec(spec), true
}

func aspectRatioParamOptions() []ParamOption {
	return []ParamOption{
		{Label: "Adaptive", Value: "adaptive"},
		{Label: "1:1", Value: "1:1"},
		{Label: "1:4", Value: "1:4"},
		{Label: "1:8", Value: "1:8"},
		{Label: "2:3", Value: "2:3"},
		{Label: "3:2", Value: "3:2"},
		{Label: "3:4", Value: "3:4"},
		{Label: "4:1", Value: "4:1"},
		{Label: "4:3", Value: "4:3"},
		{Label: "4:5", Value: "4:5"},
		{Label: "5:4", Value: "5:4"},
		{Label: "8:1", Value: "8:1"},
		{Label: "16:9", Value: "16:9"},
		{Label: "9:16", Value: "9:16"},
		{Label: "21:9", Value: "21:9"},
		{Label: "9:21", Value: "9:21"},
	}
}

func durationParamOptions() []ParamOption {
	options := []ParamOption{{Label: "Auto", Value: "-1"}}
	for duration := 3; duration <= 15; duration++ {
		value := formatNumber(float64(duration))
		options = append(options, ParamOption{Label: value + "s", Value: value})
	}
	return options
}

func paramFloat(value float64) *float64 {
	return &value
}
