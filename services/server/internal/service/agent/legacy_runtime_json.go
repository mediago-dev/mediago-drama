package agent

import (
	"encoding/json"
	"strings"
)

// legacyRuntimePayload converts stored pre-migration event envelopes without changing user text.
func legacyRuntimePayload(raw []byte) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	if old, ok := fields["acp"]; ok {
		if _, exists := fields["runtime"]; !exists {
			fields["runtime"] = old
		}
		delete(fields, "acp")
	}
	var kind string
	if json.Unmarshal(fields["type"], &kind) == nil && strings.HasPrefix(kind, "agent.acp") {
		fields["type"], _ = json.Marshal("agent.runtime" + strings.TrimPrefix(kind, "agent.acp"))
	}
	if metadata := fields["metadata"]; len(metadata) > 0 && string(metadata) != "null" {
		var values map[string]json.RawMessage
		if json.Unmarshal(metadata, &values) == nil {
			if old, ok := values["acp"]; ok {
				if _, exists := values["runtime"]; !exists {
					values["runtime"] = old
				}
				delete(values, "acp")
				fields["metadata"], _ = json.Marshal(values)
			}
		}
	}
	return json.Marshal(fields)
}

// UnmarshalJSON preserves historical tool events while decoding the current envelope.
func (event *AgentEvent) UnmarshalJSON(raw []byte) error {
	type plain AgentEvent
	normalized, err := legacyRuntimePayload(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(normalized, (*plain)(event))
}

// UnmarshalJSON preserves historical chat metadata after the runtime migration.
func (message *AgentChatMessageRecord) UnmarshalJSON(raw []byte) error {
	type plain AgentChatMessageRecord
	normalized, err := legacyRuntimePayload(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(normalized, (*plain)(message))
}
