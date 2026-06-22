package generation

import (
	"fmt"
	"strings"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
)

func TestApplyGenerationDocumentContextResolvesMentionReferencesFromDocuments(t *testing.T) {
	mediaAssets := media.NewMediaAssets(t.TempDir()+"/settings.db", t.TempDir())
	asset := savePNGReferenceAsset(t, mediaAssets, 320, 180)
	workflow := NewGenerationService(nil, nil, mediaAssets)
	storySectionID := createGenerationDocumentSectionBlockID("story-doc", 2, 1, "第 01 组")
	workflow.SetDocumentResolver(fakeGenerationDocumentResolver{
		documents: map[string]mediamcp.WorkspaceDocument{
			"story-doc": {
				ID: "story-doc",
				Content: strings.Join([]string{
					"# 第一集",
					"",
					"## 第 01 组",
					"",
					"**动作：** 林书彤看向陈远。",
					"",
					"**引用资源**：角色 @[林书彤](mention://character-doc/section_lin?kind=section&category=character)",
					"",
					"## 第 02 组",
					"",
					"动作：转身。",
				}, "\n"),
			},
			"character-doc": {
				ID: "character-doc",
				Content: strings.Join([]string{
					"<!-- section-id: section_lin -->",
					"# 林书彤",
					"",
					"21 岁女大学生。",
					"",
					"![林书彤图](" + asset.URL + ")",
				}, "\n"),
			},
		},
	})

	payload := generationMessageRequest{
		ProjectID: "project-a",
		Prompt:    "视频提示词",
		DocumentContext: &GenerationDocumentContext{
			ProjectID:  "project-a",
			DocumentID: "story-doc",
			SectionID:  storySectionID,
		},
	}
	if err := workflow.applyGenerationDocumentContext(&payload); err != nil {
		t.Fatalf("applyGenerationDocumentContext() error = %v", err)
	}
	if payload.SectionID != storySectionID {
		t.Fatalf("section id = %q, want %q", payload.SectionID, storySectionID)
	}
	if payload.DocumentID != "story-doc" {
		t.Fatalf("document id = %q, want story-doc", payload.DocumentID)
	}
	if len(payload.ReferenceAssetIDs) != 1 || payload.ReferenceAssetIDs[0] != asset.ID {
		t.Fatalf("reference asset ids = %#v, want %q", payload.ReferenceAssetIDs, asset.ID)
	}

	route, ok := coregeneration.FindRoute(coregeneration.RouteJimengSeedance20Fast)
	if !ok {
		t.Fatal("jimeng seedance route is missing")
	}
	references, err := workflow.resolveGenerationReferences(route, payload)
	if err != nil {
		t.Fatalf("resolveGenerationReferences() error = %v", err)
	}
	if len(references) != 1 || !strings.HasPrefix(references[0], "data:image/png;base64,") {
		t.Fatalf("references = %#v, want one data URI reference", references)
	}
}

func TestApplyGenerationDocumentContextFillsPromptAndAssetMention(t *testing.T) {
	workflow := NewGenerationService(nil, nil, nil)
	workflow.SetDocumentResolver(fakeGenerationDocumentResolver{
		documents: map[string]mediamcp.WorkspaceDocument{
			"story-doc": {
				ID: "story-doc",
				Content: strings.Join([]string{
					"# 第一集",
					"",
					"<!-- section-id: section_story -->",
					"## 第 01 组",
					"",
					"![占位](data:image/svg+xml;base64,placeholder)",
					"",
					"动作：陈远奔跑。",
					"",
					"**引用资源**：道具 @[添狗金金卡](asset://asset-card?kind=image)",
				}, "\n"),
			},
		},
	})

	payload := generationMessageRequest{
		ProjectID: "project-a",
		DocumentContext: &GenerationDocumentContext{
			DocumentID: "story-doc",
			SectionID:  "section_story",
		},
	}
	if err := workflow.applyGenerationDocumentContext(&payload); err != nil {
		t.Fatalf("applyGenerationDocumentContext() error = %v", err)
	}
	if !strings.Contains(payload.Prompt, "动作：陈远奔跑。") {
		t.Fatalf("prompt = %q, want document section body", payload.Prompt)
	}
	if strings.Contains(payload.Prompt, "data:image/svg+xml") {
		t.Fatalf("prompt = %q, want placeholder image stripped", payload.Prompt)
	}
	if len(payload.ReferenceAssetIDs) != 1 || payload.ReferenceAssetIDs[0] != "asset-card" {
		t.Fatalf("reference asset ids = %#v, want asset-card", payload.ReferenceAssetIDs)
	}
}

func TestGenerationReferencesFromMarkdownResolvesLegacyDocumentMentionToSingleSection(t *testing.T) {
	workflow := NewGenerationService(nil, nil, nil)
	workflow.SetDocumentResolver(fakeGenerationDocumentResolver{
		documents: map[string]mediamcp.WorkspaceDocument{
			"character-doc": {
				ID: "character-doc",
				Content: strings.Join([]string{
					"# 林书彤",
					"",
					"21 岁女大学生。",
					"",
					"![林书彤图](/api/v1/media-assets/lin-image/content)",
				}, "\n"),
			},
		},
	})

	assetIDs, referenceURLs := workflow.generationReferencesFromMarkdown(
		"project-a",
		"角色 @[林书彤](mention://character-doc)",
	)

	if len(assetIDs) != 1 || assetIDs[0] != "lin-image" {
		t.Fatalf("asset ids = %#v, want lin-image", assetIDs)
	}
	if len(referenceURLs) != 0 {
		t.Fatalf("reference urls = %#v, want none", referenceURLs)
	}
}

func TestGenerationReferencesFromMarkdownKeepsNoHeadingDocumentMention(t *testing.T) {
	workflow := NewGenerationService(nil, nil, nil)
	workflow.SetDocumentResolver(fakeGenerationDocumentResolver{
		documents: map[string]mediamcp.WorkspaceDocument{
			"reference-doc": {
				ID: "reference-doc",
				Content: strings.Join([]string{
					"没有标题的参考文档。",
					"",
					"![参考图](/api/v1/media-assets/ref-image/content)",
				}, "\n"),
			},
		},
	})

	assetIDs, referenceURLs := workflow.generationReferencesFromMarkdown(
		"project-a",
		"参考 @[设定](mention://reference-doc)",
	)

	if len(assetIDs) != 1 || assetIDs[0] != "ref-image" {
		t.Fatalf("asset ids = %#v, want ref-image", assetIDs)
	}
	if len(referenceURLs) != 0 {
		t.Fatalf("reference urls = %#v, want none", referenceURLs)
	}
}

func TestLibraryAssetIDFromGenerationAssetURLSupportsLegacyMediaAssetsPath(t *testing.T) {
	if got := libraryAssetIDFromGenerationAssetURL("/api/media/assets/ref-a/content"); got != "ref-a" {
		t.Fatalf("legacy media asset id = %q, want ref-a", got)
	}
	if got := libraryAssetIDFromGenerationAssetURL("/api/v1/media-assets/ref-b/content"); got != "ref-b" {
		t.Fatalf("media asset id = %q, want ref-b", got)
	}
	if got := libraryAssetIDFromGenerationAssetURL("/api/v1/projects/project-a/media-assets/ref-c/content"); got != "ref-c" {
		t.Fatalf("project media asset id = %q, want ref-c", got)
	}
	if got := libraryAssetIDFromGenerationAssetURL("http://localhost:5173/api/v1/projects/project-a/media-assets/ref-d/content"); got != "ref-d" {
		t.Fatalf("absolute project media asset id = %q, want ref-d", got)
	}
}

func TestCreateGenerationDocumentSectionBlockIDMatchesFrontendHash(t *testing.T) {
	tests := []struct {
		name              string
		documentID        string
		headingLevel      int
		headingOccurrence int
		headingText       string
		want              string
	}{
		{
			name:              "storyboard group",
			documentID:        "story-doc",
			headingLevel:      2,
			headingOccurrence: 1,
			headingText:       "第 01 组",
			want:              "section-fpqbti",
		},
		{
			name:              "chinese role title",
			documentID:        "角色册 第一章",
			headingLevel:      1,
			headingOccurrence: 2,
			headingText:       "林书彤",
			want:              "section-mutyck",
		},
		{
			name:              "normalized whitespace",
			documentID:        "doc-1",
			headingLevel:      3,
			headingOccurrence: 1,
			headingText:       "  视频   提示词  ",
			want:              "section-uwtz0i",
		},
		{
			name:              "latin prompt title",
			documentID:        "story-doc",
			headingLevel:      2,
			headingOccurrence: 3,
			headingText:       "Chen Yuan Prompt",
			want:              "section-s0hgoo",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := createGenerationDocumentSectionBlockID(
				tt.documentID,
				tt.headingLevel,
				tt.headingOccurrence,
				tt.headingText,
			); got != tt.want {
				t.Fatalf("section block id = %q, want %q", got, tt.want)
			}
		})
	}
}

type fakeGenerationDocumentResolver struct {
	documents map[string]mediamcp.WorkspaceDocument
}

func (resolver fakeGenerationDocumentResolver) RequireWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, error) {
	document, ok := resolver.documents[documentID]
	if !ok {
		return mediamcp.WorkspaceDocument{}, fmt.Errorf("document not found: %s", documentID)
	}
	return document, nil
}
