package official

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

const defaultMiniMaxVoiceID = "Chinese (Mandarin)_Warm_Bestie"

type miniMaxSpeechRequest struct {
	Model         string                    `json:"model"`
	Text          string                    `json:"text"`
	Stream        bool                      `json:"stream"`
	LanguageBoost string                    `json:"language_boost,omitempty"`
	OutputFormat  string                    `json:"output_format"`
	VoiceSetting  miniMaxSpeechVoiceSetting `json:"voice_setting"`
	AudioSetting  miniMaxSpeechAudioSetting `json:"audio_setting"`
}

type miniMaxSpeechVoiceSetting struct {
	VoiceID string  `json:"voice_id"`
	Speed   float64 `json:"speed"`
	Volume  float64 `json:"vol"`
	Pitch   float64 `json:"pitch"`
}

type miniMaxSpeechAudioSetting struct {
	SampleRate int    `json:"sample_rate"`
	Bitrate    int    `json:"bitrate"`
	Format     string `json:"format"`
	Channel    int    `json:"channel"`
}

type miniMaxSpeechResponse struct {
	Data *struct {
		Audio  string `json:"audio"`
		Status int    `json:"status"`
	} `json:"data"`
	ExtraInfo struct {
		AudioLength     int    `json:"audio_length"`
		AudioSampleRate int    `json:"audio_sample_rate"`
		AudioSize       int    `json:"audio_size"`
		Bitrate         int    `json:"bitrate"`
		WordCount       int    `json:"word_count"`
		UsageCharacters int    `json:"usage_characters"`
		AudioFormat     string `json:"audio_format"`
		AudioChannel    int    `json:"audio_channel"`
	} `json:"extra_info"`
	TraceID  string `json:"trace_id"`
	BaseResp struct {
		StatusCode int    `json:"status_code"`
		StatusMsg  string `json:"status_msg"`
	} `json:"base_resp"`
}

func (provider *Provider) generateMiniMaxSpeech(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := miniMaxSpeechPayload(request)
	result := miniMaxSpeechResponse{}
	if err := provider.postJSON(ctx, provider.miniMaxBaseURL+"/v1/t2a_v2", provider.bearerAuthorization(), payload, &result); err != nil {
		return generation.Response{}, err
	}
	if result.BaseResp.StatusCode != 0 {
		message := strings.TrimSpace(result.BaseResp.StatusMsg)
		if message == "" {
			message = "provider returned a non-success status"
		}
		return generation.Response{}, fmt.Errorf("minimax speech generation failed: %s", message)
	}
	if result.Data == nil || strings.TrimSpace(result.Data.Audio) == "" {
		return generation.Response{}, fmt.Errorf("minimax speech generation returned no audio")
	}

	audioBytes, err := hex.DecodeString(strings.TrimSpace(result.Data.Audio))
	if err != nil {
		return generation.Response{}, fmt.Errorf("decoding minimax audio: %w", err)
	}
	format := strings.ToLower(strings.TrimSpace(result.ExtraInfo.AudioFormat))
	if format == "" {
		format = payload.AudioSetting.Format
	}

	return generation.Response{
		ID:     firstNonEmpty(result.TraceID, request.RouteID),
		Status: "completed",
		Model:  request.Model,
		Assets: []generation.Asset{
			{
				Kind:     generation.KindAudio,
				Base64:   base64.StdEncoding.EncodeToString(audioBytes),
				MIMEType: miniMaxAudioMIMEType(format),
				Metadata: map[string]any{
					"audio_length":      result.ExtraInfo.AudioLength,
					"audio_sample_rate": result.ExtraInfo.AudioSampleRate,
					"audio_size":        result.ExtraInfo.AudioSize,
					"bitrate":           result.ExtraInfo.Bitrate,
					"word_count":        result.ExtraInfo.WordCount,
					"usage_characters":  result.ExtraInfo.UsageCharacters,
					"audio_channel":     result.ExtraInfo.AudioChannel,
					"trace_id":          result.TraceID,
				},
			},
		},
		Usage: generation.Usage{
			InputTokens: result.ExtraInfo.UsageCharacters,
			TotalTokens: result.ExtraInfo.UsageCharacters,
		},
		Metadata: map[string]any{
			"trace_id": result.TraceID,
		},
	}, nil
}

func miniMaxSpeechPayload(request generation.Request) miniMaxSpeechRequest {
	params := request.Params
	format := strings.ToLower(adapterutil.ValueOrDefault(paramString(params, "format"), "mp3"))
	return miniMaxSpeechRequest{
		Model:         request.Model,
		Text:          request.Prompt,
		Stream:        false,
		LanguageBoost: "auto",
		OutputFormat:  "hex",
		VoiceSetting: miniMaxSpeechVoiceSetting{
			VoiceID: adapterutil.ValueOrDefault(paramString(params, "voice_id"), defaultMiniMaxVoiceID),
			Speed:   paramFloat(params, "speed", 1),
			Volume:  paramFloat(params, "vol", 1),
			Pitch:   paramFloat(params, "pitch", 0),
		},
		AudioSetting: miniMaxSpeechAudioSetting{
			SampleRate: paramInt(params, "sample_rate", 32000),
			Bitrate:    paramInt(params, "bitrate", 128000),
			Format:     format,
			Channel:    1,
		},
	}
}

func miniMaxAudioMIMEType(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "wav":
		return "audio/wav"
	case "flac":
		return "audio/flac"
	default:
		return "audio/mpeg"
	}
}

func paramFloat(params map[string]any, key string, fallback float64) float64 {
	value, ok := adapterutil.FloatValue(params[key])
	if !ok {
		return fallback
	}
	return value
}
