package documents

import (
	"fmt"
	"strings"
)

// StreamDocumentEditInput is the legacy stream_document_edit operation shape.
type StreamDocumentEditInput struct {
	StreamID         string  `json:"streamId,omitempty" jsonschema:"同一流的稳定 ID；省略时服务器生成。"`
	DocumentID       string  `json:"documentId,omitempty" jsonschema:"目标文档 ID。create 可省略，服务器会创建新文档。"`
	Mode             string  `json:"mode" jsonschema:"编辑模式：create、append、replace_block 或 replace_document。"`
	AnchorText       string  `json:"anchorText,omitempty" jsonschema:"replace_block 模式下用于定位 Markdown 块的锚定文本。"`
	Title            string  `json:"title,omitempty" jsonschema:"create 模式的新文档标题，或可选展示标题。"`
	Category         string  `json:"category,omitempty" jsonschema:"create 模式的新文档类型：screenplay、character、scene、prop、storyboard 或 source-material。"`
	ParentDocumentID *string `json:"parentDocumentId,omitempty" jsonschema:"create 模式下的新文档父 ID；空字符串表示根级。"`
	Chunk            string  `json:"chunk,omitempty" jsonschema:"本次流式写入的一小段 Markdown。"`
	Finalize         bool    `json:"finalize,omitempty" jsonschema:"设为 true 表示本轮流式写入完成。"`
	Summary          string  `json:"summary,omitempty" jsonschema:"可选操作摘要。"`
	ExpectedVersion  *int    `json:"expectedVersion,omitempty" jsonschema:"新流第一次写入时的乐观锁版本。"`
}

// NormalizeStreamDocumentEditInput trims stream edit input fields.
func NormalizeStreamDocumentEditInput(input StreamDocumentEditInput) StreamDocumentEditInput {
	input.StreamID = strings.TrimSpace(input.StreamID)
	input.DocumentID = strings.TrimSpace(input.DocumentID)
	input.Mode = strings.TrimSpace(input.Mode)
	input.AnchorText = strings.TrimSpace(input.AnchorText)
	input.Title = strings.TrimSpace(input.Title)
	input.Category = strings.TrimSpace(input.Category)
	input.Summary = strings.TrimSpace(input.Summary)
	if input.ParentDocumentID != nil {
		trimmed := strings.TrimSpace(*input.ParentDocumentID)
		input.ParentDocumentID = &trimmed
	}
	return input
}

// ValidateStreamDocumentEditInput validates common stream edit input rules.
func ValidateStreamDocumentEditInput(input StreamDocumentEditInput) error {
	if input.Mode == "" {
		return fmt.Errorf("mode is required")
	}
	if input.Chunk == "" && !input.Finalize {
		return fmt.Errorf("chunk is required unless finalize is true")
	}
	return nil
}

// StreamEditEventMode maps stream edit modes to document edit event modes.
func StreamEditEventMode(mode string) string {
	switch mode {
	case "replace_block", "replace_document", "create":
		return "replace"
	default:
		return mode
	}
}
