package prompt

import (
	"strings"
	"testing"
)

func TestCreateReferenceSectionBlockIDMatchesFrontendHash(t *testing.T) {
	tests := []struct {
		name       string
		documentID string
		level      int
		occurrence int
		title      string
		want       string
	}{
		{
			name:       "character",
			documentID: "doc-1",
			level:      1,
			occurrence: 1,
			title:      "沈阎",
			want:       "section-2zy950",
		},
		{
			name:       "scene",
			documentID: "scene-doc",
			level:      2,
			occurrence: 1,
			title:      "雨夜巷口",
			want:       "section-xeu5uu",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := createReferenceSectionBlockID(test.documentID, test.level, test.occurrence, test.title)
			if got != test.want {
				t.Fatalf("createReferenceSectionBlockID() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestBuildReferenceIndexItemsUsesStableSectionIDs(t *testing.T) {
	items := buildReferenceIndexItems(AgentRunRequest{
		Documents: []AgentDocumentContext{
			{
				ID:       "character-doc",
				Title:    "角色设定",
				Category: "character",
				Content: strings.Join([]string{
					"<!-- section-id: section_shenyan -->",
					"# 沈阎",
					"",
					"男主角设定正文不应该进入索引。",
					"",
					"# 林晚",
				}, "\n"),
			},
		},
	})

	if len(items) != 2 {
		t.Fatalf("items = %d, want 2: %#v", len(items), items)
	}
	if items[0].Title != "沈阎" || items[0].BlockID != "section_shenyan" {
		t.Fatalf("first item = %#v, want persisted section id for 沈阎", items[0])
	}
	if items[0].MentionMarkdown != "@[沈阎](mention://character-doc/section_shenyan?kind=section&category=character)" {
		t.Fatalf("mention = %q", items[0].MentionMarkdown)
	}
	if strings.Contains(items[0].MentionMarkdown, "男主角设定正文") {
		t.Fatalf("mention index leaked document body: %q", items[0].MentionMarkdown)
	}
	if items[1].Title != "林晚" || !strings.HasPrefix(items[1].BlockID, "section-") {
		t.Fatalf("second item = %#v, want fallback section id for 林晚", items[1])
	}
}

func TestBuildReferenceIndexItemsIgnoresAssetReferences(t *testing.T) {
	items := buildReferenceIndexItems(AgentRunRequest{
		References: []AgentReference{
			{
				Kind:       "asset",
				DocumentID: "asset-1",
				AssetID:    "asset-1",
				AssetKind:  "image",
				Category:   "source-material",
				Title:      "参考图.png",
				URL:        "/api/media/assets/asset-1/content",
			},
		},
	})

	if len(items) != 0 {
		t.Fatalf("items = %#v, want asset references ignored", items)
	}
}
