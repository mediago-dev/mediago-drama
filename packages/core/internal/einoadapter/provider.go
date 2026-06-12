package einoadapter

import (
	"context"
	"errors"
	"io"

	"github.com/cloudwego/eino/components/model"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/multimodal"
)

// ChatModelProvider adapts an Eino chat model to the core multimodal provider contract.
type ChatModelProvider struct {
	name  string
	model model.BaseChatModel
}

// NewChatModelProvider creates a core provider backed by an Eino chat model.
func NewChatModelProvider(name string, chatModel model.BaseChatModel) (*ChatModelProvider, error) {
	if name == "" {
		name = "eino"
	}
	if chatModel == nil {
		return nil, errors.New("eino chat model is nil")
	}

	return &ChatModelProvider{
		name:  name,
		model: chatModel,
	}, nil
}

// Name returns the provider name.
func (provider *ChatModelProvider) Name() string {
	return provider.name
}

// Generate sends a non-streaming request to the underlying Eino chat model.
func (provider *ChatModelProvider) Generate(
	ctx context.Context,
	request multimodal.GenerateRequest,
) (multimodal.GenerateResponse, error) {
	if err := multimodal.ValidateRequest(request); err != nil {
		return multimodal.GenerateResponse{}, provider.wrapError(multimodal.ErrorKindInvalidRequest, err)
	}

	messages, err := ToEinoMessages(request.Messages)
	if err != nil {
		return multimodal.GenerateResponse{}, provider.wrapError(multimodal.ErrorKindInvalidRequest, err)
	}

	chatModel, options, err := provider.modelWithOptions(request)
	if err != nil {
		return multimodal.GenerateResponse{}, provider.wrapError(multimodal.ErrorKindInvalidRequest, err)
	}

	message, err := chatModel.Generate(ctx, messages, options...)
	if err != nil {
		return multimodal.GenerateResponse{}, provider.wrapError(multimodal.ErrorKindUnknown, err)
	}

	return GenerateResponseFromEino(message)
}

// Stream sends a streaming request to the underlying Eino chat model.
func (provider *ChatModelProvider) Stream(
	ctx context.Context,
	request multimodal.GenerateRequest,
) (*multimodal.StreamReader, error) {
	if err := multimodal.ValidateRequest(request); err != nil {
		return nil, provider.wrapError(multimodal.ErrorKindInvalidRequest, err)
	}

	messages, err := ToEinoMessages(request.Messages)
	if err != nil {
		return nil, provider.wrapError(multimodal.ErrorKindInvalidRequest, err)
	}

	chatModel, options, err := provider.modelWithOptions(request)
	if err != nil {
		return nil, provider.wrapError(multimodal.ErrorKindInvalidRequest, err)
	}

	reader, err := chatModel.Stream(ctx, messages, options...)
	if err != nil {
		return nil, provider.wrapError(multimodal.ErrorKindUnknown, err)
	}

	doneSent := false
	return multimodal.NewStreamReader(func() (multimodal.StreamEvent, error) {
		chunk, recvErr := reader.Recv()
		if errors.Is(recvErr, io.EOF) {
			if doneSent {
				return multimodal.StreamEvent{}, io.EOF
			}

			doneSent = true
			return multimodal.StreamEvent{Type: multimodal.StreamEventDone}, nil
		}
		if recvErr != nil {
			return multimodal.StreamEvent{}, provider.wrapError(multimodal.ErrorKindUnknown, recvErr)
		}

		return StreamEventFromEino(chunk)
	}, func() error {
		reader.Close()
		return nil
	}), nil
}

func (provider *ChatModelProvider) modelWithOptions(
	request multimodal.GenerateRequest,
) (model.BaseChatModel, []model.Option, error) {
	tools, err := ToolsToEino(request.Tools)
	if err != nil {
		return nil, nil, err
	}

	chatModel := provider.model
	if len(tools) > 0 {
		if toolCallingModel, ok := provider.model.(model.ToolCallingChatModel); ok {
			withTools, err := toolCallingModel.WithTools(tools)
			if err != nil {
				return nil, nil, err
			}
			chatModel = withTools
		}
	}

	options := OptionsToEino(request.Options)
	if len(tools) > 0 {
		if _, ok := provider.model.(model.ToolCallingChatModel); !ok {
			options = append(options, model.WithTools(tools))
		}
	}

	return chatModel, options, nil
}

func (provider *ChatModelProvider) wrapError(kind multimodal.ErrorKind, err error) error {
	return &multimodal.ProviderError{
		Kind:     kind,
		Provider: provider.name,
		Err:      err,
	}
}
