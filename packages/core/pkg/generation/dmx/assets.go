package dmx

import (
	"regexp"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

var markdownImagePattern = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)\)`)

type imageResponseUsage struct {
	InputTokens         int                `json:"input_tokens"`
	OutputTokens        int                `json:"output_tokens"`
	TotalTokens         int                `json:"total_tokens"`
	InputTokensDetails  tokenDetails       `json:"input_tokens_details"`
	OutputTokensDetails outputTokenDetails `json:"output_tokens_details"`
}

type tokenDetails struct {
	CachedTokens int `json:"cached_tokens"`
}

type outputTokenDetails struct {
	ReasoningTokens int `json:"reasoning_tokens"`
}

func (usage imageResponseUsage) toGenerationUsage() generation.Usage {
	return generation.Usage{
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		TotalTokens:     usage.TotalTokens,
		ReasoningTokens: usage.OutputTokensDetails.ReasoningTokens,
		CachedTokens:    usage.InputTokensDetails.CachedTokens,
	}
}

func imageAssetsFromText(text string) []generation.Asset {
	matches := markdownImagePattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return []generation.Asset{}
	}

	assets := make([]generation.Asset, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		value := strings.TrimSpace(match[1])
		if value == "" {
			continue
		}
		asset := generation.Asset{Kind: generation.KindImage}
		if strings.HasPrefix(strings.ToLower(value), "data:") {
			asset.Base64 = value
		} else {
			asset.URL = value
		}
		assets = append(assets, asset)
	}

	return assets
}
