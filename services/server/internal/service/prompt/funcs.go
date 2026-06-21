package prompt

import (
	"fmt"
	"log/slog"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/textutil"
)

func truncatePromptContent(sectionID string, content string, maxBytes int) string {
	truncated, omitted := textutil.TruncateUTF8(content, maxBytes)
	if omitted == 0 {
		return content
	}
	slog.Warn("prompt content truncated", "section", sectionID, "bytes", len(content), "max", maxBytes)
	return truncated + fmt.Sprintf("\n\n...(已截断 %d 字节)", omitted)
}
