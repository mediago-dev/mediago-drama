package prompt

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildACPPromptSnapshots(t *testing.T) {
	tests := []struct {
		name    string
		request AgentRunRequest
	}{
		{
			name: "no_project",
			request: AgentRunRequest{
				Prompt: "你好",
			},
		},
		{
			name: "project_no_document",
			request: AgentRunRequest{
				ProjectID: "project-1",
			},
		},
		{
			name: "document_no_scoped_edit",
			request: AgentRunRequest{
				ProjectID: "project-1",
				Prompt:    "扩写开场",
				Document: &AgentDocumentContext{
					ID:       "doc-1",
					Title:    "第一集",
					Category: "screenplay",
					Content:  "# 第一集\n\n开场。",
				},
			},
		},
		{
			name: "scoped_edit_active",
			request: AgentRunRequest{
				ProjectID:     "project-1",
				SelectionText: "旧台词",
				Document: &AgentDocumentContext{
					ID:      "doc-1",
					Title:   "对白",
					Content: "## 场景\n\n旧台词\n",
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertPromptSnapshot(t, test.name, BuildACPPrompt(test.request, PromptBuildOptions{}))
		})
	}
}

func assertPromptSnapshot(t *testing.T, name string, got string) {
	t.Helper()

	path := filepath.Join("testdata", name+".golden")
	if os.Getenv("UPDATE_PROMPT_GOLDENS") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("MkdirAll() error = %v", err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatalf("WriteFile() error = %v", err)
		}
	}

	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", path, err)
	}
	if got != string(want) {
		t.Fatalf("prompt snapshot %q mismatch\n--- got ---\n%s\n--- want ---\n%s", name, got, want)
	}
}
