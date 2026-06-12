package einoadapter

import (
	"context"
	"errors"
	"fmt"
	"io"
	"testing"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation/runtime"
	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/multimodal"
)

func TestMessageConversionPreservesMultimodalParts(t *testing.T) {
	source := multimodal.Message{
		Role: multimodal.RoleUser,
		Parts: []multimodal.Part{
			{
				Modality: multimodal.ModalityText,
				Text:     "describe this",
			},
			{
				Modality: multimodal.ModalityImage,
				MIMEType: "image/png",
				Data:     []byte("image-bytes"),
			},
		},
	}

	einoMessage, err := ToEinoMessage(source)
	if err != nil {
		t.Fatalf("ToEinoMessage() error = %v", err)
	}
	if einoMessage.Content != "" {
		t.Fatalf("ToEinoMessage() Content = %q, want multimodal parts", einoMessage.Content)
	}
	if got := len(einoMessage.UserInputMultiContent); got != 2 {
		t.Fatalf("ToEinoMessage() parts = %d, want 2", got)
	}
	image := einoMessage.UserInputMultiContent[1].Image
	if image == nil || image.Base64Data == nil {
		t.Fatalf("ToEinoMessage() image base64 missing")
	}

	roundTrip, err := MessageFromEino(einoMessage)
	if err != nil {
		t.Fatalf("MessageFromEino() error = %v", err)
	}
	if got := string(roundTrip.Parts[1].Data); got != "image-bytes" {
		t.Fatalf("MessageFromEino() image data = %q, want image-bytes", got)
	}
}

func TestToolsToEinoBuildsParameterSchema(t *testing.T) {
	tools, err := ToolsToEino([]multimodal.Tool{
		{
			Name:        "replace_selection",
			Description: "Replace the selected text.",
			Parameters: map[string]multimodal.ToolParameter{
				"text": {
					Type:        multimodal.ToolParameterString,
					Description: "Replacement text.",
					Required:    true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("ToolsToEino() error = %v", err)
	}
	if len(tools) != 1 {
		t.Fatalf("ToolsToEino() count = %d, want 1", len(tools))
	}

	jsonSchema, err := tools[0].ParamsOneOf.ToJSONSchema()
	if err != nil {
		t.Fatalf("ParamsOneOf.ToJSONSchema() error = %v", err)
	}
	if len(jsonSchema.Required) != 1 || jsonSchema.Required[0] != "text" {
		t.Fatalf("required fields = %v, want [text]", jsonSchema.Required)
	}
}

func TestChatModelProviderGenerate(t *testing.T) {
	temperature := float32(0.2)
	fake := &fakeChatModel{
		response: &schema.Message{
			Role:    schema.Assistant,
			Content: "done",
			ResponseMeta: &schema.ResponseMeta{
				FinishReason: "stop",
				Usage: &schema.TokenUsage{
					PromptTokens:     10,
					CompletionTokens: 5,
					TotalTokens:      15,
				},
			},
		},
	}
	provider, err := NewChatModelProvider("fake", fake)
	if err != nil {
		t.Fatalf("NewChatModelProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), multimodal.GenerateRequest{
		Messages: []multimodal.Message{
			{
				Role: multimodal.RoleUser,
				Parts: []multimodal.Part{
					{Modality: multimodal.ModalityText, Text: "go"},
				},
			},
		},
		Options: multimodal.GenerateOptions{
			Model:       "test-model",
			Temperature: &temperature,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if fake.messages[0].Role != schema.User || fake.messages[0].Content != "go" {
		t.Fatalf("Generate() input = %#v", fake.messages[0])
	}
	options := model.GetCommonOptions(nil, fake.options...)
	if options.Model == nil || *options.Model != "test-model" {
		t.Fatalf("Generate() model option = %v, want test-model", options.Model)
	}
	if got := response.Messages[0].Parts[0].Text; got != "done" {
		t.Fatalf("Generate() response text = %q, want done", got)
	}
	if response.Usage.TotalTokens != 15 {
		t.Fatalf("Generate() total tokens = %d, want 15", response.Usage.TotalTokens)
	}
}

func TestChatModelProviderRunsThroughGenerationTextRuntime(t *testing.T) {
	fake := &fakeChatModel{
		response: &schema.Message{
			Role:    schema.Assistant,
			Content: "done through eino",
			ResponseMeta: &schema.ResponseMeta{
				Usage: &schema.TokenUsage{TotalTokens: 7},
			},
		},
	}
	multimodalProvider, err := NewChatModelProvider("fake-eino", fake)
	if err != nil {
		t.Fatalf("NewChatModelProvider() error = %v", err)
	}
	generationProvider, err := runtime.NewMultimodalTextProvider(multimodalProvider)
	if err != nil {
		t.Fatalf("NewMultimodalTextProvider() error = %v", err)
	}

	response, err := generationProvider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindText,
		RouteID: generation.RouteDMXGPT41MiniText,
		Model:   "gpt-4.1-mini",
		Prompt:  "go",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if fake.messages[0].Role != schema.User || fake.messages[0].Content != "go" {
		t.Fatalf("Generate() input = %#v", fake.messages[0])
	}
	if response.Text != "done through eino" || response.Usage.TotalTokens != 7 {
		t.Fatalf("response = %#v", response)
	}
}

func ExampleNewChatModelProvider() {
	fake := &fakeChatModel{
		response: &schema.Message{
			Role:    schema.Assistant,
			Content: "draft ready",
		},
	}
	multimodalProvider, _ := NewChatModelProvider("example-eino", fake)
	generationProvider, _ := runtime.NewMultimodalTextProvider(multimodalProvider)

	response, _ := generationProvider.Generate(context.Background(), generation.Request{
		Kind:   generation.KindText,
		Model:  "gpt-4.1-mini",
		Prompt: "Write a short draft.",
	})
	fmt.Println(response.Text)

	// Output: draft ready
}

func TestChatModelProviderStream(t *testing.T) {
	fake := &fakeChatModel{
		stream: []*schema.Message{
			{Role: schema.Assistant, Content: "Hel"},
			{Role: schema.Assistant, Content: "lo"},
		},
	}
	provider, err := NewChatModelProvider("fake", fake)
	if err != nil {
		t.Fatalf("NewChatModelProvider() error = %v", err)
	}

	reader, err := provider.Stream(context.Background(), multimodal.GenerateRequest{
		Messages: []multimodal.Message{
			{
				Role: multimodal.RoleUser,
				Parts: []multimodal.Part{
					{Modality: multimodal.ModalityText, Text: "go"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	defer reader.Close()

	event, err := reader.Recv()
	if err != nil {
		t.Fatalf("Recv() first error = %v", err)
	}
	if event.Type != multimodal.StreamEventMessageDelta || event.Delta != "Hel" {
		t.Fatalf("Recv() first = %#v", event)
	}

	event, err = reader.Recv()
	if err != nil {
		t.Fatalf("Recv() second error = %v", err)
	}
	if event.Delta != "lo" {
		t.Fatalf("Recv() second delta = %q, want lo", event.Delta)
	}

	event, err = reader.Recv()
	if err != nil {
		t.Fatalf("Recv() done error = %v", err)
	}
	if event.Type != multimodal.StreamEventDone {
		t.Fatalf("Recv() done type = %q, want done", event.Type)
	}

	_, err = reader.Recv()
	if !errors.Is(err, io.EOF) {
		t.Fatalf("Recv() after done error = %v, want EOF", err)
	}
}

type fakeChatModel struct {
	messages []*schema.Message
	options  []model.Option
	response *schema.Message
	stream   []*schema.Message
}

func (fake *fakeChatModel) Generate(
	_ context.Context,
	input []*schema.Message,
	options ...model.Option,
) (*schema.Message, error) {
	fake.messages = input
	fake.options = options

	return fake.response, nil
}

func (fake *fakeChatModel) Stream(
	_ context.Context,
	input []*schema.Message,
	options ...model.Option,
) (*schema.StreamReader[*schema.Message], error) {
	fake.messages = input
	fake.options = options

	return schema.StreamReaderFromArray(fake.stream), nil
}
