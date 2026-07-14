package acp

import (
	"encoding/json"
	"strings"
)

// ParseACPFinalResponse parses the final ACP message and optional structured payload.
func ParseACPFinalResponse(raw string, request AgentRunRequest) AgentFinalResponse {
	text := strings.TrimSpace(raw)
	if text == "" {
		return AgentFinalResponse{}
	}
	if friendly := friendlyACPProviderErrorMessage(text); friendly != "" {
		return AgentFinalResponse{Message: friendly}
	}

	prefix, object := SplitACPResponseObject(text)
	if object == "" {
		return AgentFinalResponse{Message: text}
	}

	var response AgentFinalResponse
	if err := json.Unmarshal([]byte(object), &response); err != nil {
		return AgentFinalResponse{Message: text}
	}
	if response.Message == "" {
		response.Message = strings.TrimSpace(prefix)
	}
	if response.Message == "" {
		response.Message = "ACP Agent 已准备好回复。"
	}
	if response.ProposedDocument != nil {
		if request.Document != nil {
			response.ProposedDocument.DocumentID = request.Document.ID
		}
		if response.ProposedDocument.DocumentID == "" &&
			response.ProposedDocument.Title == "" &&
			response.ProposedDocument.Content == "" {
			response.ProposedDocument = nil
		}
	}
	response.A2UI = NormalizeAgentA2UIPayload(response.A2UI)

	return response
}

func parseACPFinalResponseForItem(raw string, itemText string, request AgentRunRequest) AgentFinalResponse {
	response := ParseACPFinalResponse(raw, request)
	itemText = strings.TrimSpace(itemText)
	if itemText == "" {
		response.Message = ""
		return response
	}

	itemResponse := ParseACPFinalResponse(itemText, request)
	response.Message = itemResponse.Message
	if itemResponse.ProposedDocument != nil {
		response.ProposedDocument = itemResponse.ProposedDocument
	}
	if itemResponse.A2UI != nil {
		response.A2UI = itemResponse.A2UI
	}
	return response
}

// SplitACPResponseObject extracts a trailing structured JSON object from ACP text.
func SplitACPResponseObject(text string) (string, string) {
	trimmed := strings.TrimSpace(text)
	end := strings.LastIndex(trimmed, "}")
	if end < 0 {
		return trimmed, ""
	}

	for start := strings.LastIndex(trimmed[:end+1], "{"); start >= 0; {
		object := strings.TrimSpace(trimmed[start : end+1])
		var response AgentFinalResponse
		if err := json.Unmarshal([]byte(object), &response); err == nil &&
			(response.Message != "" ||
				response.ProposedDocument != nil ||
				NormalizeAgentA2UIPayload(response.A2UI) != nil) {
			prefix := strings.TrimSpace(trimmed[:start])
			if strings.HasSuffix(prefix, "```json") || strings.HasSuffix(prefix, "```") {
				lines := strings.Split(prefix, "\n")
				if len(lines) > 0 {
					prefix = strings.TrimSpace(strings.Join(lines[:len(lines)-1], "\n"))
				}
			}
			return prefix, object
		}
		nextEnd := start - 1
		if nextEnd < 0 {
			break
		}
		start = strings.LastIndex(trimmed[:nextEnd+1], "{")
	}

	return trimmed, ""
}

// NormalizeAgentA2UIPayload cleans a model-returned A2UI payload.
func NormalizeAgentA2UIPayload(payload *AgentA2UIPayload) *AgentA2UIPayload {
	if payload == nil {
		return nil
	}
	payload.Version = strings.TrimSpace(payload.Version)
	if payload.Version == "" {
		payload.Version = "v0.9"
	}
	payload.SurfaceID = strings.TrimSpace(payload.SurfaceID)
	if strings.TrimSpace(string(payload.Messages)) == "" ||
		strings.TrimSpace(string(payload.Messages)) == "null" {
		return nil
	}
	return payload
}
