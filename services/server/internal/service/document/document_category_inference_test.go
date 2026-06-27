package document

import "testing"

func TestInferBusinessDocumentCategoryFromHints(t *testing.T) {
	tests := []struct {
		name  string
		hints []string
		want  string
	}{
		{
			name:  "screenplay title",
			hints: []string{"第一集 动漫剧本.md"},
			want:  "screenplay",
		},
		{
			name:  "character title",
			hints: []string{"角色设定"},
			want:  "character",
		},
		{
			name:  "scene title",
			hints: []string{"第一集-场景设定"},
			want:  "scene",
		},
		{
			name:  "prop title",
			hints: []string{"第一集/道具清单.md"},
			want:  "prop",
		},
		{
			name:  "storyboard title",
			hints: []string{"第一集 分镜脚本"},
			want:  "storyboard",
		},
		{
			name:  "folder token",
			hints: []string{"角色/第一集.md"},
			want:  "character",
		},
		{
			name:  "plain chapter",
			hints: []string{"大纲/第一章.md"},
			want:  "",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := inferBusinessDocumentCategoryFromHints(test.hints...); got != test.want {
				t.Fatalf("inferBusinessDocumentCategoryFromHints(%q) = %q, want %q", test.hints, got, test.want)
			}
		})
	}
}

func TestHasReferenceDocumentHint(t *testing.T) {
	if !hasReferenceDocumentHint("角色设定参考资料.md") {
		t.Fatal("hasReferenceDocumentHint returned false, want true")
	}
	if hasReferenceDocumentHint("角色设定.md") {
		t.Fatal("hasReferenceDocumentHint returned true, want false")
	}
}
