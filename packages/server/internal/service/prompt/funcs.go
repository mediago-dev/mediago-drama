package prompt

import (
	"fmt"
	"log/slog"
	"strings"
	"text/template"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/textutil"
)

var promptStaticFuncs = template.FuncMap{
	"ensureTrailingNewline": ensureTrailingNewline,
	"inc": func(value int) int {
		return value + 1
	},
	"mdFence":              mdFence,
	"overviewProjectBrief": renderOverviewProjectBriefPrompt,
	"truncate":             parsePromptTemplateTruncate,
}

func renderOverviewProjectBriefPrompt(markdown string) string {
	return RenderOverviewProjectBriefPrompt(markdown)
}

func promptDynamicFuncs(sectionID string) template.FuncMap {
	return template.FuncMap{
		"truncate": func(content string, maxBytes int) string {
			return truncatePromptContent(sectionID, content, maxBytes)
		},
	}
}

func parsePromptTemplateTruncate(content string, _ int) string {
	return content
}

func mdFence(content string) string {
	longest := 0
	current := 0
	for index := 0; index < len(content); index++ {
		if content[index] == '`' {
			current++
			if current > longest {
				longest = current
			}
			continue
		}
		current = 0
	}
	if longest < 2 {
		return "```"
	}
	return strings.Repeat("`", longest+1)
}

func truncatePromptContent(sectionID string, content string, maxBytes int) string {
	truncated, omitted := textutil.TruncateUTF8(content, maxBytes)
	if omitted == 0 {
		return content
	}
	slog.Warn("prompt content truncated", "section", sectionID, "bytes", len(content), "max", maxBytes)
	return truncated + fmt.Sprintf("\n\n...(已截断 %d 字节)", omitted)
}

func ensureTrailingNewline(content string) string {
	if strings.HasSuffix(content, "\n") {
		return content
	}
	return content + "\n"
}
