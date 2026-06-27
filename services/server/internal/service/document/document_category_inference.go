package document

import (
	"path/filepath"
	"strings"
)

type documentCategoryInferenceRule struct {
	category string
	keywords []string
	tokens   []string
}

var documentCategoryInferenceRules = []documentCategoryInferenceRule{
	{
		category: "storyboard",
		keywords: []string{
			"分镜脚本",
			"分镜文档",
			"分镜设定",
			"分镜清单",
			"分镜表",
			"分镜",
			"镜头脚本",
			"镜头清单",
			"storyboard",
			"shot list",
		},
		tokens: []string{"分镜"},
	},
	{
		category: "character",
		keywords: []string{
			"角色设定",
			"角色档案",
			"角色文档",
			"角色清单",
			"角色表",
			"人物设定",
			"人物档案",
			"人物文档",
			"人物清单",
			"人物表",
			"character bible",
			"characters",
			"character",
		},
		tokens: []string{"角色", "人物"},
	},
	{
		category: "scene",
		keywords: []string{
			"场景设定",
			"场景档案",
			"场景文档",
			"场景清单",
			"场景提取",
			"场景表",
			"地点设定",
			"地点清单",
			"scene bible",
			"scenes",
			"scene",
		},
		tokens: []string{"场景", "地点"},
	},
	{
		category: "prop",
		keywords: []string{
			"道具设定",
			"道具档案",
			"道具文档",
			"道具清单",
			"道具提取",
			"道具表",
			"prop bible",
			"props",
			"prop",
		},
		tokens: []string{"道具"},
	},
	{
		category: "screenplay",
		keywords: []string{
			"动漫剧本",
			"短剧剧本",
			"影视剧本",
			"分集剧本",
			"剧本",
			"screenplay",
			"script",
		},
		tokens: []string{"剧本"},
	},
}

var referenceDocumentHintKeywords = []string{
	"参考",
	"资料",
	"素材",
	"原文",
	"原始",
	"小说",
	"source",
	"reference",
	"material",
}

func inferBusinessDocumentCategoryFromHints(hints ...string) string {
	text := joinedDocumentCategoryHints(hints...)
	if text == "" {
		return ""
	}
	for _, rule := range documentCategoryInferenceRules {
		for _, keyword := range rule.keywords {
			if strings.Contains(text, keyword) {
				return rule.category
			}
		}
	}
	for _, rule := range documentCategoryInferenceRules {
		for _, token := range rule.tokens {
			if documentCategoryHintHasToken(text, token) {
				return rule.category
			}
		}
	}
	return ""
}

func hasReferenceDocumentHint(hints ...string) bool {
	text := joinedDocumentCategoryHints(hints...)
	if text == "" {
		return false
	}
	for _, keyword := range referenceDocumentHintKeywords {
		if strings.Contains(text, keyword) {
			return true
		}
	}
	return false
}

func joinedDocumentCategoryHints(hints ...string) string {
	parts := make([]string, 0, len(hints))
	for _, hint := range hints {
		if normalized := normalizeDocumentCategoryHint(hint); normalized != "" {
			parts = append(parts, normalized)
		}
	}
	return strings.Join(parts, " ")
}

func normalizeDocumentCategoryHint(hint string) string {
	hint = strings.ToLower(strings.TrimSpace(hint))
	if hint == "" {
		return ""
	}
	ext := filepath.Ext(hint)
	if ext != "" {
		hint = strings.TrimSuffix(hint, ext)
	}
	replacer := strings.NewReplacer(
		"\\", " ",
		"/", " ",
		"_", " ",
		"-", " ",
		"·", " ",
		"｜", " ",
		"|", " ",
		":", " ",
		"：", " ",
		"(", " ",
		")", " ",
		"（", " ",
		"）", " ",
	)
	return strings.Join(strings.Fields(replacer.Replace(hint)), " ")
}

func documentCategoryHintHasToken(text string, token string) bool {
	for _, field := range strings.Fields(text) {
		if field == token {
			return true
		}
	}
	return false
}
