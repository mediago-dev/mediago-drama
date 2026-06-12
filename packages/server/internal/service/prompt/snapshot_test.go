package prompt

import (
	"os"
	"path/filepath"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/model"
)

func TestBuildACPPromptSnapshots(t *testing.T) {
	overview := model.DefaultProjectOverviewMarkdown("示例项目", "", ProjectBrief{
		Medium: "2D 数码插画",
		Genre:  "沙雕喜剧",
		Pacing: "每集 60 秒",
	})

	tests := []struct {
		name    string
		request AgentRunRequest
		options PromptBuildOptions
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
				Documents: []AgentDocumentContext{
					{ID: model.OverviewDocumentID, Title: "项目概览", Content: overview},
				},
			},
			options: PromptBuildOptions{
				OverviewMarkdown: overview,
			},
		},
		{
			name: "document_no_scoped_edit",
			request: AgentRunRequest{
				ProjectID: "project-1",
				Prompt:    "扩写开场",
				Document: &AgentDocumentContext{
					ID:       "doc-1",
					ParentID: model.OverviewDocumentID,
					Title:    "第一集",
					Category: "screenplay",
					Content:  "# 第一集\n\n开场。",
				},
			},
			options: PromptBuildOptions{
				OverviewMarkdown: overview,
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
			options: PromptBuildOptions{
				ScopedEdit: AgentScopedEditContext{
					Active:        true,
					AnchorText:    "旧台词",
					BlockMarkdown: "## 场景\n\n旧台词\n",
					Instruction:   "根据用户请求优化选中文本所在的 Markdown 块，只改这一块。",
					SelectionText: "旧台词",
					Comments: []mediamcp.DocumentComment{
						{ID: "comment-1", AnchorText: "旧台词", Body: "让冲突更明确。"},
					},
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertPromptSnapshot(t, test.name, BuildACPPrompt(test.request, test.options))
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
