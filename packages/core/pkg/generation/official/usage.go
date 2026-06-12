package official

import "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"

type tokenUsage struct {
	InputTokens         int `json:"input_tokens"`
	OutputTokens        int `json:"output_tokens"`
	TotalTokens         int `json:"total_tokens"`
	PromptTokens        int `json:"prompt_tokens"`
	CompletionTokens    int `json:"completion_tokens"`
	PromptTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
	OutputTokensDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"output_tokens_details"`
}

func (usage tokenUsage) toGenerationUsage() generation.Usage {
	inputTokens := usage.InputTokens
	if inputTokens == 0 {
		inputTokens = usage.PromptTokens
	}
	outputTokens := usage.OutputTokens
	if outputTokens == 0 {
		outputTokens = usage.CompletionTokens
	}

	return generation.Usage{
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		TotalTokens:     usage.TotalTokens,
		ReasoningTokens: usage.OutputTokensDetails.ReasoningTokens,
		CachedTokens:    usage.PromptTokensDetails.CachedTokens,
	}
}
