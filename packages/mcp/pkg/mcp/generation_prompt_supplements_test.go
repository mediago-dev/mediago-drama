package mcp

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestGenerationMessageInputPromptSupplementsJSONRoundTrip(t *testing.T) {
	input := GenerationMessageInput{
		Prompt: "生成角色定妆图",
		PromptSupplements: []GenerationPromptSupplementInput{
			{
				ReferenceID:     "pack-style",
				ReferenceName:   "电影质感",
				ReferencePrompt: "cinematic lighting",
			},
		},
	}

	data, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	var decoded GenerationMessageInput
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if !reflect.DeepEqual(decoded.PromptSupplements, input.PromptSupplements) {
		t.Fatalf("prompt supplements = %#v, want %#v", decoded.PromptSupplements, input.PromptSupplements)
	}
}
