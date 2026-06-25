package document

import (
	"strings"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestProjectBriefRenderUsesUnsetValues(t *testing.T) {
	rendered := (ProjectBrief{}).Render()

	for _, line := range []string{
		"| 媒介 | [未设定] |",
		"| 类型 | [未设定] |",
		"| 节奏 | [未设定] |",
		"| 受众 | [未设定] |",
		"| 基调 | [未设定] |",
		"| 参考 | [未设定] |",
		"| 其他约束 | [未设定] |",
	} {
		if !strings.Contains(rendered, line) {
			t.Fatalf("rendered = %q, want line %q", rendered, line)
		}
	}
	if strings.Contains(rendered, "| 风格 |") {
		t.Fatalf("rendered = %q, should not include project style", rendered)
	}
}

func TestProjectBriefRenderPreservesSetFields(t *testing.T) {
	rendered := (ProjectBrief{
		Medium:   "2D 数码插画",
		Genre:    "沙雕喜剧",
		Audience: "Z 世代女性",
	}).Render()

	for _, line := range []string{
		"| 媒介 | 2D 数码插画 |",
		"| 类型 | 沙雕喜剧 |",
		"| 受众 | Z 世代女性 |",
		"| 节奏 | [未设定] |",
		"| 基调 | [未设定] |",
		"| 参考 | [未设定] |",
		"| 其他约束 | [未设定] |",
	} {
		if !strings.Contains(rendered, line) {
			t.Fatalf("rendered = %q, want line %q", rendered, line)
		}
	}
}

func TestProjectBriefApplyUsesMask(t *testing.T) {
	current := ProjectBrief{Medium: "短剧", Genre: "悬疑", Tone: "冷峻"}
	next := current.Apply(ProjectBrief{Genre: "喜剧", Notes: "低成本"}, ProjectBriefUpdateMask{
		Genre: true,
		Notes: true,
	})

	if next.Medium != "短剧" ||
		next.Genre != "喜剧" ||
		next.Tone != "冷峻" ||
		next.Notes != "低成本" {
		t.Fatalf("next = %#v, want masked update", next)
	}
}

func TestWorkspaceStateServiceSaveProjectBriefPatchInput(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "brief-patch"
	requireTestProject(t, store, projectID)
	genre := "悬疑"
	result, err := store.SaveProjectBriefPatchInput(projectID, mediamcp.ProjectBriefPatchInput{Genre: &genre})
	if err != nil {
		t.Fatalf("SaveProjectBriefPatchInput returned error: %v", err)
	}
	if !result.Changed || result.Brief.Genre != "悬疑" || result.Brief.UpdatedAt == "" {
		t.Fatalf("result = %#v, want changed brief", result)
	}

	empty, err := store.SaveProjectBriefPatchInput(projectID, mediamcp.ProjectBriefPatchInput{})
	if err != nil {
		t.Fatalf("empty SaveProjectBriefPatchInput returned error: %v", err)
	}
	if empty.Changed || empty.Brief.Genre != "悬疑" {
		t.Fatalf("empty result = %#v, want unchanged brief", empty)
	}
	state, err := store.load(projectID)
	if err != nil {
		t.Fatalf("loading project state: %v", err)
	}
	if WorkspaceDocumentsContainID(state.Documents, OverviewDocumentID) {
		t.Fatalf("documents = %+v, should not create overview document", state.Documents)
	}
}

func TestReplaceOverviewProjectBriefSection(t *testing.T) {
	markdown := "# 项目\n\n## Project Brief\n\n旧内容\n\n## 剧本\n\n正文\n"
	next := ReplaceOverviewProjectBriefSection(markdown, "- **类型**：悬疑")
	if !strings.Contains(next, "- **类型**：悬疑") || strings.Contains(next, "旧内容") {
		t.Fatalf("next = %q, want brief section replaced", next)
	}
	if !strings.Contains(next, "## 剧本\n\n正文") {
		t.Fatalf("next = %q, want following section preserved", next)
	}
}
