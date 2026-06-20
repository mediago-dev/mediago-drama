package generation

var audioParamGroups = []ParamGroupSpec{
	{ID: ParamGroupVoice, Label: "音色"},
	{ID: ParamGroupAudio, Label: "音频"},
	{ID: ParamGroupOther, Label: "其他"},
}

var audioParamRegistry = map[ParamID]CanonicalParamSpec{
	ParamVoiceID: {
		ID:      ParamVoiceID,
		Label:   "音色",
		Type:    "select",
		Group:   ParamGroupVoice,
		Options: minimaxSystemVoiceOptions(),
		Help:    "MiniMax 国内系统音色。",
	},
	ParamSpeed: {
		ID:    ParamSpeed,
		Label: "语速",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(0.5),
		Max:   paramFloat(2),
	},
	ParamVolume: {
		ID:    ParamVolume,
		Label: "音量",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(0),
		Max:   paramFloat(10),
	},
	ParamPitch: {
		ID:    ParamPitch,
		Label: "音高",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(-12),
		Max:   paramFloat(12),
	},
	ParamOutputFormat: {
		ID:      ParamOutputFormat,
		Label:   "格式",
		Type:    "select",
		Group:   ParamGroupAudio,
		Options: audioFormatOptions(),
	},
	ParamSampleRate: {
		ID:    ParamSampleRate,
		Label: "采样率",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(8000),
		Max:   paramFloat(48000),
	},
	ParamBitrate: {
		ID:    ParamBitrate,
		Label: "比特率",
		Type:  "number",
		Group: ParamGroupOther,
		Min:   paramFloat(32000),
		Max:   paramFloat(320000),
	},
}

func minimaxSpeechParams() RouteParamConfig {
	params := []RouteParam{
		selectRouteParam(ParamVoiceID, defaultMiniMaxVoiceID, minimaxSystemVoiceOptions()),
		numberRouteParam(ParamSpeed, 1, 0.5, 2),
		numberRouteParam(ParamVolume, 1, 0, 10),
		numberRouteParam(ParamPitch, 0, -12, 12),
		selectRouteParam(ParamOutputFormat, "mp3", audioFormatOptions()),
		numberRouteParam(ParamSampleRate, 32000, 8000, 48000),
		numberRouteParam(ParamBitrate, 128000, 32000, 320000),
	}

	return routeParamConfig(params, ParamTranslation{
		Moves: []ParamMove{
			{From: ParamVoiceID, To: "voice_id"},
			{From: ParamSpeed},
			{From: ParamVolume, To: "vol"},
			{From: ParamPitch},
			{From: ParamOutputFormat, To: "format"},
			{From: ParamSampleRate, To: "sample_rate"},
			{From: ParamBitrate},
		},
	})
}

func audioFormatOptions() []ParamOption {
	return []ParamOption{
		{Label: "MP3", Value: "mp3"},
		{Label: "WAV", Value: "wav"},
		{Label: "FLAC", Value: "flac"},
	}
}
