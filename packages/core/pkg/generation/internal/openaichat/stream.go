package openaichat

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
)

const scannerMaxTokenSize = 1024 * 1024

// NewStream wraps an OpenAI-compatible chat-completions SSE body.
func NewStream(body io.ReadCloser) generation.TextStream {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), scannerMaxTokenSize)
	return &stream{body: body, scanner: scanner}
}

type stream struct {
	body    io.ReadCloser
	scanner *bufio.Scanner
	done    bool
}

func (reader *stream) Recv() (generation.TextStreamEvent, error) {
	if reader == nil || reader.scanner == nil || reader.done {
		return generation.TextStreamEvent{}, io.EOF
	}

	for reader.scanner.Scan() {
		line := strings.TrimSpace(reader.scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}

		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			reader.done = true
			return generation.TextStreamEvent{}, io.EOF
		}

		var chunk chatCompletionChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return generation.TextStreamEvent{}, err
		}

		event := generation.TextStreamEvent{
			Delta: chunk.deltaText(),
			Usage: chunk.usage(),
			Done:  chunk.done(),
		}
		if event.Delta == "" && event.Usage == nil && !event.Done {
			continue
		}
		if event.Done {
			reader.done = true
		}
		return event, nil
	}
	if err := reader.scanner.Err(); err != nil {
		return generation.TextStreamEvent{}, err
	}

	reader.done = true
	return generation.TextStreamEvent{}, io.EOF
}

func (reader *stream) Close() error {
	if reader == nil || reader.body == nil {
		return nil
	}

	return reader.body.Close()
}

type chatCompletionChunk struct {
	Choices []struct {
		Delta struct {
			Content any `json:"content"`
		} `json:"delta"`
		FinishReason any `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens            int           `json:"prompt_tokens"`
		CompletionTokens        int           `json:"completion_tokens"`
		TotalTokens             int           `json:"total_tokens"`
		PromptTokensDetails     *tokenDetails `json:"prompt_tokens_details"`
		CompletionTokensDetails *tokenDetails `json:"completion_tokens_details"`
	} `json:"usage"`
}

type tokenDetails struct {
	CachedTokens    int `json:"cached_tokens"`
	ReasoningTokens int `json:"reasoning_tokens"`
}

func (chunk chatCompletionChunk) deltaText() string {
	var builder strings.Builder
	for _, choice := range chunk.Choices {
		switch content := choice.Delta.Content.(type) {
		case string:
			builder.WriteString(content)
		case []any:
			for _, part := range content {
				if text, ok := part.(string); ok {
					builder.WriteString(text)
				}
			}
		}
	}

	return builder.String()
}

func (chunk chatCompletionChunk) usage() *generation.Usage {
	if chunk.Usage == nil {
		return nil
	}

	usage := generation.Usage{
		InputTokens:  chunk.Usage.PromptTokens,
		OutputTokens: chunk.Usage.CompletionTokens,
		TotalTokens:  chunk.Usage.TotalTokens,
	}
	if chunk.Usage.PromptTokensDetails != nil {
		usage.CachedTokens = chunk.Usage.PromptTokensDetails.CachedTokens
	}
	if chunk.Usage.CompletionTokensDetails != nil {
		usage.ReasoningTokens = chunk.Usage.CompletionTokensDetails.ReasoningTokens
	}

	return &usage
}

func (chunk chatCompletionChunk) done() bool {
	if len(chunk.Choices) == 0 && chunk.Usage != nil {
		return true
	}

	return false
}
