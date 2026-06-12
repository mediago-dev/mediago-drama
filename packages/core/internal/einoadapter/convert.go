package einoadapter

import (
	"encoding/base64"
	"fmt"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/multimodal"
)

// ToEinoMessages converts core messages into Eino schema messages.
func ToEinoMessages(messages []multimodal.Message) ([]*schema.Message, error) {
	result := make([]*schema.Message, len(messages))
	for index, message := range messages {
		converted, err := ToEinoMessage(message)
		if err != nil {
			return nil, fmt.Errorf("message %d: %w", index, err)
		}

		result[index] = converted
	}

	return result, nil
}

// ToEinoMessage converts one core message into an Eino schema message.
func ToEinoMessage(message multimodal.Message) (*schema.Message, error) {
	role, err := roleToEino(message.Role)
	if err != nil {
		return nil, err
	}

	result := &schema.Message{
		Role:             role,
		Name:             message.Name,
		ToolCallID:       message.ToolCallID,
		ToolName:         message.ToolName,
		ToolCalls:        toolCallsToEino(message.ToolCalls),
		ReasoningContent: message.Reasoning,
		Extra:            message.Metadata,
	}

	if len(message.Parts) == 1 && message.Parts[0].Modality == multimodal.ModalityText {
		result.Content = message.Parts[0].Text
		return result, nil
	}

	switch message.Role {
	case multimodal.RoleAssistant:
		parts, err := outputPartsToEino(message.Parts)
		if err != nil {
			return nil, err
		}
		result.AssistantGenMultiContent = parts
	default:
		parts, err := inputPartsToEino(message.Parts)
		if err != nil {
			return nil, err
		}
		result.UserInputMultiContent = parts
	}

	return result, nil
}

// GenerateResponseFromEino converts one Eino response message into a core response.
func GenerateResponseFromEino(message *schema.Message) (multimodal.GenerateResponse, error) {
	converted, err := MessageFromEino(message)
	if err != nil {
		return multimodal.GenerateResponse{}, err
	}

	response := multimodal.GenerateResponse{
		Messages: []multimodal.Message{converted},
	}
	if message != nil && message.ResponseMeta != nil {
		response.Usage = usageFromEino(message.ResponseMeta.Usage)
		response.Metadata = map[string]any{
			"finish_reason": message.ResponseMeta.FinishReason,
		}
	}

	return response, nil
}

// StreamEventFromEino converts an Eino stream chunk into a normalized stream event.
func StreamEventFromEino(message *schema.Message) (multimodal.StreamEvent, error) {
	converted, err := MessageFromEino(message)
	if err != nil {
		return multimodal.StreamEvent{}, err
	}

	event := multimodal.StreamEvent{
		Type:    multimodal.StreamEventMessageDelta,
		Message: &converted,
		Delta:   firstText(converted.Parts),
	}
	if message != nil && message.ResponseMeta != nil {
		usage := usageFromEino(message.ResponseMeta.Usage)
		event.Usage = &usage
	}
	if len(converted.ToolCalls) > 0 {
		event.Type = multimodal.StreamEventToolCall
		event.ToolCall = &converted.ToolCalls[0]
	}

	return event, nil
}

// MessageFromEino converts an Eino schema message into a core message.
func MessageFromEino(message *schema.Message) (multimodal.Message, error) {
	if message == nil {
		return multimodal.Message{}, fmt.Errorf("eino message is nil")
	}

	role, err := roleFromEino(message.Role)
	if err != nil {
		return multimodal.Message{}, err
	}

	result := multimodal.Message{
		Role:       role,
		Name:       message.Name,
		ToolCalls:  toolCallsFromEino(message.ToolCalls),
		ToolCallID: message.ToolCallID,
		ToolName:   message.ToolName,
		Reasoning:  message.ReasoningContent,
		Metadata:   message.Extra,
	}

	switch {
	case len(message.AssistantGenMultiContent) > 0:
		result.Parts, err = outputPartsFromEino(message.AssistantGenMultiContent)
	case len(message.UserInputMultiContent) > 0:
		result.Parts, err = inputPartsFromEino(message.UserInputMultiContent)
	case len(message.MultiContent) > 0:
		result.Parts, err = deprecatedPartsFromEino(message.MultiContent)
	case message.Content != "":
		result.Parts = []multimodal.Part{
			{
				Modality: multimodal.ModalityText,
				Text:     message.Content,
			},
		}
	}
	if err != nil {
		return multimodal.Message{}, err
	}

	return result, nil
}

// OptionsToEino converts common generation options into Eino model options.
func OptionsToEino(options multimodal.GenerateOptions) []model.Option {
	result := make([]model.Option, 0, 5)
	if options.Model != "" {
		result = append(result, model.WithModel(options.Model))
	}
	if options.Temperature != nil {
		result = append(result, model.WithTemperature(*options.Temperature))
	}
	if options.MaxTokens != nil {
		result = append(result, model.WithMaxTokens(*options.MaxTokens))
	}
	if options.TopP != nil {
		result = append(result, model.WithTopP(*options.TopP))
	}
	if len(options.Stop) > 0 {
		result = append(result, model.WithStop(options.Stop))
	}
	if toolChoice := toolChoiceToEino(options.ToolChoice); toolChoice != "" {
		result = append(result, model.WithToolChoice(toolChoice))
	}

	return result
}

// ToolsToEino converts core tool descriptions into Eino tool descriptors.
func ToolsToEino(tools []multimodal.Tool) ([]*schema.ToolInfo, error) {
	result := make([]*schema.ToolInfo, 0, len(tools))
	for index, tool := range tools {
		if tool.Name == "" {
			return nil, fmt.Errorf("tool %d name is required", index)
		}

		info := &schema.ToolInfo{
			Name:  tool.Name,
			Desc:  tool.Description,
			Extra: tool.Metadata,
		}
		if len(tool.Parameters) > 0 {
			info.ParamsOneOf = schema.NewParamsOneOfByParams(parametersToEino(tool.Parameters))
		}

		result = append(result, info)
	}

	return result, nil
}

func roleToEino(role multimodal.Role) (schema.RoleType, error) {
	switch role {
	case multimodal.RoleSystem:
		return schema.System, nil
	case multimodal.RoleUser:
		return schema.User, nil
	case multimodal.RoleAssistant:
		return schema.Assistant, nil
	case multimodal.RoleTool:
		return schema.Tool, nil
	default:
		return "", fmt.Errorf("role %q: %w", role, multimodal.ErrUnsupportedRole)
	}
}

func roleFromEino(role schema.RoleType) (multimodal.Role, error) {
	switch role {
	case schema.System:
		return multimodal.RoleSystem, nil
	case schema.User:
		return multimodal.RoleUser, nil
	case schema.Assistant:
		return multimodal.RoleAssistant, nil
	case schema.Tool:
		return multimodal.RoleTool, nil
	default:
		return "", fmt.Errorf("role %q: %w", role, multimodal.ErrUnsupportedRole)
	}
}

func inputPartsToEino(parts []multimodal.Part) ([]schema.MessageInputPart, error) {
	result := make([]schema.MessageInputPart, len(parts))
	for index, part := range parts {
		converted, err := inputPartToEino(part)
		if err != nil {
			return nil, fmt.Errorf("part %d: %w", index, err)
		}
		result[index] = converted
	}

	return result, nil
}

func inputPartToEino(part multimodal.Part) (schema.MessageInputPart, error) {
	switch part.Modality {
	case multimodal.ModalityText:
		return schema.MessageInputPart{
			Type:  schema.ChatMessagePartTypeText,
			Text:  part.Text,
			Extra: part.Metadata,
		}, nil
	case multimodal.ModalityImage:
		return schema.MessageInputPart{
			Type:  schema.ChatMessagePartTypeImageURL,
			Image: &schema.MessageInputImage{MessagePartCommon: commonToEino(part)},
			Extra: part.Metadata,
		}, nil
	case multimodal.ModalityAudio:
		return schema.MessageInputPart{
			Type:  schema.ChatMessagePartTypeAudioURL,
			Audio: &schema.MessageInputAudio{MessagePartCommon: commonToEino(part)},
			Extra: part.Metadata,
		}, nil
	case multimodal.ModalityVideo:
		return schema.MessageInputPart{
			Type:  schema.ChatMessagePartTypeVideoURL,
			Video: &schema.MessageInputVideo{MessagePartCommon: commonToEino(part)},
			Extra: part.Metadata,
		}, nil
	case multimodal.ModalityFile:
		return schema.MessageInputPart{
			Type:  schema.ChatMessagePartTypeFileURL,
			File:  &schema.MessageInputFile{MessagePartCommon: commonToEino(part), Name: part.Name},
			Extra: part.Metadata,
		}, nil
	default:
		return schema.MessageInputPart{}, fmt.Errorf("modality %q: %w", part.Modality, multimodal.ErrUnsupportedModality)
	}
}

func outputPartsToEino(parts []multimodal.Part) ([]schema.MessageOutputPart, error) {
	result := make([]schema.MessageOutputPart, len(parts))
	for index, part := range parts {
		converted, err := outputPartToEino(part)
		if err != nil {
			return nil, fmt.Errorf("part %d: %w", index, err)
		}
		result[index] = converted
	}

	return result, nil
}

func outputPartToEino(part multimodal.Part) (schema.MessageOutputPart, error) {
	switch part.Modality {
	case multimodal.ModalityText:
		return schema.MessageOutputPart{
			Type:  schema.ChatMessagePartTypeText,
			Text:  part.Text,
			Extra: part.Metadata,
		}, nil
	case multimodal.ModalityImage:
		return schema.MessageOutputPart{
			Type:  schema.ChatMessagePartTypeImageURL,
			Image: &schema.MessageOutputImage{MessagePartCommon: commonToEino(part)},
			Extra: part.Metadata,
		}, nil
	case multimodal.ModalityAudio:
		return schema.MessageOutputPart{
			Type:  schema.ChatMessagePartTypeAudioURL,
			Audio: &schema.MessageOutputAudio{MessagePartCommon: commonToEino(part)},
			Extra: part.Metadata,
		}, nil
	case multimodal.ModalityVideo:
		return schema.MessageOutputPart{
			Type:  schema.ChatMessagePartTypeVideoURL,
			Video: &schema.MessageOutputVideo{MessagePartCommon: commonToEino(part)},
			Extra: part.Metadata,
		}, nil
	default:
		return schema.MessageOutputPart{}, fmt.Errorf("modality %q: %w", part.Modality, multimodal.ErrUnsupportedModality)
	}
}

func commonToEino(part multimodal.Part) schema.MessagePartCommon {
	common := schema.MessagePartCommon{
		MIMEType: part.MIMEType,
	}
	if part.URI != "" {
		common.URL = &part.URI
	}
	if len(part.Data) > 0 {
		encoded := base64.StdEncoding.EncodeToString(part.Data)
		common.Base64Data = &encoded
	}

	return common
}

func inputPartsFromEino(parts []schema.MessageInputPart) ([]multimodal.Part, error) {
	result := make([]multimodal.Part, len(parts))
	for index, part := range parts {
		converted, err := inputPartFromEino(part)
		if err != nil {
			return nil, fmt.Errorf("part %d: %w", index, err)
		}
		result[index] = converted
	}

	return result, nil
}

func inputPartFromEino(part schema.MessageInputPart) (multimodal.Part, error) {
	switch part.Type {
	case schema.ChatMessagePartTypeText:
		return multimodal.Part{Modality: multimodal.ModalityText, Text: part.Text, Metadata: part.Extra}, nil
	case schema.ChatMessagePartTypeImageURL:
		if part.Image == nil {
			return multimodal.Part{}, fmt.Errorf("image part is nil: %w", multimodal.ErrEmptyPart)
		}
		return partFromCommon(multimodal.ModalityImage, part.Image.MessagePartCommon, "", part.Extra)
	case schema.ChatMessagePartTypeAudioURL:
		if part.Audio == nil {
			return multimodal.Part{}, fmt.Errorf("audio part is nil: %w", multimodal.ErrEmptyPart)
		}
		return partFromCommon(multimodal.ModalityAudio, part.Audio.MessagePartCommon, "", part.Extra)
	case schema.ChatMessagePartTypeVideoURL:
		if part.Video == nil {
			return multimodal.Part{}, fmt.Errorf("video part is nil: %w", multimodal.ErrEmptyPart)
		}
		return partFromCommon(multimodal.ModalityVideo, part.Video.MessagePartCommon, "", part.Extra)
	case schema.ChatMessagePartTypeFileURL:
		if part.File == nil {
			return multimodal.Part{}, fmt.Errorf("file part is nil: %w", multimodal.ErrEmptyPart)
		}
		return partFromCommon(multimodal.ModalityFile, part.File.MessagePartCommon, part.File.Name, part.Extra)
	default:
		return multimodal.Part{}, fmt.Errorf("part type %q: %w", part.Type, multimodal.ErrUnsupportedModality)
	}
}

func outputPartsFromEino(parts []schema.MessageOutputPart) ([]multimodal.Part, error) {
	result := make([]multimodal.Part, len(parts))
	for index, part := range parts {
		converted, err := outputPartFromEino(part)
		if err != nil {
			return nil, fmt.Errorf("part %d: %w", index, err)
		}
		result[index] = converted
	}

	return result, nil
}

func outputPartFromEino(part schema.MessageOutputPart) (multimodal.Part, error) {
	switch part.Type {
	case schema.ChatMessagePartTypeText:
		return multimodal.Part{Modality: multimodal.ModalityText, Text: part.Text, Metadata: part.Extra}, nil
	case schema.ChatMessagePartTypeImageURL:
		if part.Image == nil {
			return multimodal.Part{}, fmt.Errorf("image part is nil: %w", multimodal.ErrEmptyPart)
		}
		return partFromCommon(multimodal.ModalityImage, part.Image.MessagePartCommon, "", part.Extra)
	case schema.ChatMessagePartTypeAudioURL:
		if part.Audio == nil {
			return multimodal.Part{}, fmt.Errorf("audio part is nil: %w", multimodal.ErrEmptyPart)
		}
		return partFromCommon(multimodal.ModalityAudio, part.Audio.MessagePartCommon, "", part.Extra)
	case schema.ChatMessagePartTypeVideoURL:
		if part.Video == nil {
			return multimodal.Part{}, fmt.Errorf("video part is nil: %w", multimodal.ErrEmptyPart)
		}
		return partFromCommon(multimodal.ModalityVideo, part.Video.MessagePartCommon, "", part.Extra)
	case schema.ChatMessagePartTypeReasoning:
		if part.Reasoning == nil {
			return multimodal.Part{}, fmt.Errorf("reasoning part is nil: %w", multimodal.ErrEmptyPart)
		}
		return multimodal.Part{Modality: multimodal.ModalityText, Text: part.Reasoning.Text, Metadata: part.Extra}, nil
	default:
		return multimodal.Part{}, fmt.Errorf("part type %q: %w", part.Type, multimodal.ErrUnsupportedModality)
	}
}

func deprecatedPartsFromEino(parts []schema.ChatMessagePart) ([]multimodal.Part, error) {
	result := make([]multimodal.Part, len(parts))
	for index, part := range parts {
		switch part.Type {
		case schema.ChatMessagePartTypeText:
			result[index] = multimodal.Part{Modality: multimodal.ModalityText, Text: part.Text}
		case schema.ChatMessagePartTypeImageURL:
			if part.ImageURL == nil {
				return nil, fmt.Errorf("part %d image is nil: %w", index, multimodal.ErrEmptyPart)
			}
			result[index] = deprecatedMediaPart(multimodal.ModalityImage, part.ImageURL.URL, part.ImageURL.URI, part.ImageURL.MIMEType)
		case schema.ChatMessagePartTypeAudioURL:
			if part.AudioURL == nil {
				return nil, fmt.Errorf("part %d audio is nil: %w", index, multimodal.ErrEmptyPart)
			}
			result[index] = deprecatedMediaPart(multimodal.ModalityAudio, part.AudioURL.URL, part.AudioURL.URI, part.AudioURL.MIMEType)
		case schema.ChatMessagePartTypeVideoURL:
			if part.VideoURL == nil {
				return nil, fmt.Errorf("part %d video is nil: %w", index, multimodal.ErrEmptyPart)
			}
			result[index] = deprecatedMediaPart(multimodal.ModalityVideo, part.VideoURL.URL, part.VideoURL.URI, part.VideoURL.MIMEType)
		case schema.ChatMessagePartTypeFileURL:
			if part.FileURL == nil {
				return nil, fmt.Errorf("part %d file is nil: %w", index, multimodal.ErrEmptyPart)
			}
			result[index] = deprecatedMediaPart(multimodal.ModalityFile, part.FileURL.URL, part.FileURL.URI, part.FileURL.MIMEType)
			result[index].Name = part.FileURL.Name
		default:
			return nil, fmt.Errorf("part %d type %q: %w", index, part.Type, multimodal.ErrUnsupportedModality)
		}
	}

	return result, nil
}

func deprecatedMediaPart(modality multimodal.Modality, url string, uri string, mimeType string) multimodal.Part {
	if uri == "" {
		uri = url
	}

	return multimodal.Part{
		Modality: modality,
		URI:      uri,
		MIMEType: mimeType,
	}
}

func partFromCommon(
	modality multimodal.Modality,
	common schema.MessagePartCommon,
	name string,
	metadata map[string]any,
) (multimodal.Part, error) {
	part := multimodal.Part{
		Modality: modality,
		MIMEType: common.MIMEType,
		Name:     name,
		Metadata: metadata,
	}
	if common.URL != nil {
		part.URI = *common.URL
	}
	if common.Base64Data != nil && *common.Base64Data != "" {
		decoded, err := base64.StdEncoding.DecodeString(*common.Base64Data)
		if err != nil {
			return multimodal.Part{}, err
		}
		part.Data = decoded
	}

	return part, nil
}

func toolCallsToEino(calls []multimodal.ToolCall) []schema.ToolCall {
	result := make([]schema.ToolCall, len(calls))
	for index, call := range calls {
		callType := call.Type
		if callType == "" {
			callType = "function"
		}
		result[index] = schema.ToolCall{
			Index: call.Index,
			ID:    call.ID,
			Type:  callType,
			Function: schema.FunctionCall{
				Name:      call.Name,
				Arguments: call.Arguments,
			},
			Extra: call.Metadata,
		}
	}

	return result
}

func toolCallsFromEino(calls []schema.ToolCall) []multimodal.ToolCall {
	result := make([]multimodal.ToolCall, len(calls))
	for index, call := range calls {
		result[index] = multimodal.ToolCall{
			ID:        call.ID,
			Type:      call.Type,
			Name:      call.Function.Name,
			Arguments: call.Function.Arguments,
			Index:     call.Index,
			Metadata:  call.Extra,
		}
	}

	return result
}

func parametersToEino(parameters map[string]multimodal.ToolParameter) map[string]*schema.ParameterInfo {
	result := make(map[string]*schema.ParameterInfo, len(parameters))
	for name, parameter := range parameters {
		result[name] = parameterToEino(parameter)
	}

	return result
}

func parameterToEino(parameter multimodal.ToolParameter) *schema.ParameterInfo {
	result := &schema.ParameterInfo{
		Type:     schema.DataType(parameter.Type),
		Desc:     parameter.Description,
		Required: parameter.Required,
		Enum:     parameter.Enum,
	}
	if parameter.Items != nil {
		result.ElemInfo = parameterToEino(*parameter.Items)
	}
	if len(parameter.Properties) > 0 {
		result.SubParams = parametersToEino(parameter.Properties)
	}

	return result
}

func toolChoiceToEino(choice multimodal.ToolChoice) schema.ToolChoice {
	switch choice {
	case multimodal.ToolChoiceAllowed:
		return schema.ToolChoiceAllowed
	case multimodal.ToolChoiceForbidden:
		return schema.ToolChoiceForbidden
	case multimodal.ToolChoiceForced:
		return schema.ToolChoiceForced
	default:
		return ""
	}
}

func usageFromEino(usage *schema.TokenUsage) multimodal.Usage {
	if usage == nil {
		return multimodal.Usage{}
	}

	return multimodal.Usage{
		InputTokens:     usage.PromptTokens,
		OutputTokens:    usage.CompletionTokens,
		TotalTokens:     usage.TotalTokens,
		ReasoningTokens: usage.CompletionTokensDetails.ReasoningTokens,
		CachedTokens:    usage.PromptTokenDetails.CachedTokens,
	}
}

func firstText(parts []multimodal.Part) string {
	for _, part := range parts {
		if part.Modality == multimodal.ModalityText {
			return part.Text
		}
	}

	return ""
}
