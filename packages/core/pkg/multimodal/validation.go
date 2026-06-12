package multimodal

import "fmt"

// ValidateRequest validates the common request shape before adapter-specific handling.
func ValidateRequest(request GenerateRequest) error {
	if len(request.Messages) == 0 {
		return ErrEmptyRequest
	}

	for messageIndex, message := range request.Messages {
		if !isSupportedRole(message.Role) {
			return fmt.Errorf("message %d role %q: %w", messageIndex, message.Role, ErrUnsupportedRole)
		}

		if len(message.Parts) == 0 && len(message.ToolCalls) == 0 {
			return fmt.Errorf("message %d: %w", messageIndex, ErrEmptyPart)
		}

		for partIndex, part := range message.Parts {
			if !isSupportedModality(part.Modality) {
				return fmt.Errorf(
					"message %d part %d modality %q: %w",
					messageIndex,
					partIndex,
					part.Modality,
					ErrUnsupportedModality,
				)
			}
			if isEmptyPart(part) {
				return fmt.Errorf("message %d part %d: %w", messageIndex, partIndex, ErrEmptyPart)
			}
		}
	}

	return nil
}

func isSupportedRole(role Role) bool {
	switch role {
	case RoleSystem, RoleUser, RoleAssistant, RoleTool:
		return true
	default:
		return false
	}
}

func isSupportedModality(modality Modality) bool {
	switch modality {
	case ModalityText, ModalityImage, ModalityAudio, ModalityVideo, ModalityFile:
		return true
	default:
		return false
	}
}

func isEmptyPart(part Part) bool {
	return part.Text == "" && part.URI == "" && len(part.Data) == 0
}
