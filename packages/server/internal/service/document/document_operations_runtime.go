package document

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
)

const defaultDocumentOperationTimeout = 2 * time.Minute

// DocumentOperationRunner runs document operations against a runtime.
type DocumentOperationRunner interface {
	RunDocumentOperations(context.Context, DocumentOperationsRequest) (DocumentOperationsResponse, error)
}

// MockDocumentOperationRunner is the built-in deterministic fallback runtime.
type MockDocumentOperationRunner struct{}

// RunDocumentOperations returns deterministic fallback operations.
func (MockDocumentOperationRunner) RunDocumentOperations(_ context.Context, request DocumentOperationsRequest) (DocumentOperationsResponse, error) {
	return MockDocumentOperations(request), nil
}

// DocumentOperations runs and validates document-operation responses.
type DocumentOperations struct {
	runner  DocumentOperationRunner
	timeout time.Duration
}

// NewDocumentOperations returns a document operations service.
func NewDocumentOperations(runner DocumentOperationRunner, timeout time.Duration) *DocumentOperations {
	if runner == nil {
		runner = MockDocumentOperationRunner{}
	}
	if timeout <= 0 || timeout > defaultDocumentOperationTimeout {
		timeout = defaultDocumentOperationTimeout
	}
	return &DocumentOperations{runner: runner, timeout: timeout}
}

// RunDocumentOperations runs the document-operation runtime with fallback.
func (service *DocumentOperations) RunDocumentOperations(ctx context.Context, payload DocumentOperationsRequest) DocumentOperationsResponse {
	response, err := service.runDocumentOperations(ctx, payload)
	if err != nil {
		response = MockDocumentOperations(payload)
		response.Summary = "模拟备用：" + response.Summary
		response.Message = response.Message + "（文档操作运行时暂不可用，已使用后端模拟备用运行时。）"
		response.Runtime = DocumentOperationRuntime{
			Runtime:    "mock",
			Fallback:   true,
			Validated:  true,
			Diagnostic: err.Error(),
		}
	}
	return response
}

func (service *DocumentOperations) runDocumentOperations(ctx context.Context, payload DocumentOperationsRequest) (DocumentOperationsResponse, error) {
	runCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	response, err := service.runner.RunDocumentOperations(runCtx, payload)
	if err != nil {
		return DocumentOperationsResponse{}, err
	}
	response = NormalizeDocumentOperationsResponse(response)
	if err := ValidateDocumentOperationsResponse(payload, response); err != nil {
		return DocumentOperationsResponse{}, err
	}
	if strings.TrimSpace(response.Runtime.Runtime) == "" {
		response.Runtime.Runtime = "mock"
	}
	response.Runtime.Validated = true
	return response, nil
}

func MockDocumentOperations(request DocumentOperationsRequest) DocumentOperationsResponse {
	prompt := strings.TrimSpace(request.Prompt)
	normalizedPrompt := strings.ToLower(prompt)
	now := timestamp.NowRFC3339Nano()

	if request.SelectionText != "" && (prompt == "" || shouldMockRewrite(normalizedPrompt)) {
		return DocumentOperationsResponse{
			Message: "已根据选中文本生成改写，并直接更新到当前文档。",
			Summary: "已通过后端运行时改写选中文本。",
			Runtime: DocumentOperationRuntime{
				Runtime:   "mock",
				Fallback:  false,
				Validated: true,
			},
			Operations: []DocumentOperationRecord{
				replaceTextOperation("替换选中文本", request.Document.Content, request.SelectionText, mockRewrite(request.SelectionText), now),
			},
		}
	}

	if comment := pickDocumentOperationComment(request); comment != nil && (prompt == "" || mentionsMockComment(normalizedPrompt)) {
		return DocumentOperationsResponse{
			Message: "已按批注修改文档。",
			Summary: "已通过后端运行时应用批注意见。",
			Runtime: DocumentOperationRuntime{
				Runtime:   "mock",
				Fallback:  false,
				Validated: true,
			},
			Operations: []DocumentOperationRecord{
				replaceTextOperation("应用批注意见", request.Document.Content, comment.AnchorText, mockRewrite(comment.AnchorText), now),
			},
		}
	}

	block := mockInsertBlock(prompt, normalizedPrompt)
	return DocumentOperationsResponse{
		Message: "已通过后端 document-operations 接口生成内容并插入文档。",
		Summary: block.summary,
		Runtime: DocumentOperationRuntime{
			Runtime:   "mock",
			Fallback:  false,
			Validated: true,
		},
		Operations: []DocumentOperationRecord{
			{
				ID:      mustDocumentOperationID("op"),
				Type:    "insert_markdown",
				Summary: block.summary,
				Target: DocumentOperationTarget{
					Position: "append",
				},
				Payload: map[string]any{
					"markdown": block.markdown,
				},
				CreatedAt: now,
			},
		},
	}
}

// NormalizeDocumentOperationsResponse fills response defaults.
func NormalizeDocumentOperationsResponse(response DocumentOperationsResponse) DocumentOperationsResponse {
	now := timestamp.NowRFC3339Nano()
	if strings.TrimSpace(response.Message) == "" {
		response.Message = "文档操作已准备好。"
	}
	if strings.TrimSpace(response.Summary) == "" {
		response.Summary = "文档操作已准备好。"
	}
	for index := range response.Operations {
		if response.Operations[index].ID == "" {
			response.Operations[index].ID = mustDocumentOperationID("op")
		}
		if response.Operations[index].Summary == "" {
			response.Operations[index].Summary = response.Summary
		}
		if response.Operations[index].CreatedAt == "" {
			response.Operations[index].CreatedAt = now
		}
		if response.Operations[index].Payload == nil {
			response.Operations[index].Payload = map[string]any{}
		}
	}
	return response
}

// ValidateDocumentOperationsResponse validates runtime operation output.
func ValidateDocumentOperationsResponse(request DocumentOperationsRequest, response DocumentOperationsResponse) error {
	if len(response.Operations) == 0 {
		return fmt.Errorf("document operation response must include at least one operation")
	}
	for index, operation := range response.Operations {
		if err := validateDocumentOperation(request, operation); err != nil {
			return fmt.Errorf("operation %d: %w", index, err)
		}
	}
	return nil
}

func validateDocumentOperation(request DocumentOperationsRequest, operation DocumentOperationRecord) error {
	switch operation.Type {
	case "insert_markdown":
		if _, ok := nonEmptyPayloadString(operation.Payload, "markdown"); !ok {
			return fmt.Errorf("insert_markdown.payload.markdown is required")
		}
		return validateInsertPosition(operation.Target)
	case "insert_section":
		heading, hasHeading := nonEmptyPayloadString(operation.Payload, "heading")
		markdown, hasMarkdown := nonEmptyPayloadString(operation.Payload, "markdown")
		if !hasHeading && !hasMarkdown {
			return fmt.Errorf("insert_section.payload.heading or markdown is required")
		}
		_ = heading
		_ = markdown
		return validateInsertPosition(operation.Target)
	case "replace_text":
		if _, ok := nonEmptyPayloadString(operation.Payload, "replacement"); !ok {
			return fmt.Errorf("replace_text.payload.replacement is required")
		}
		if operation.Target.Anchor == nil || strings.TrimSpace(operation.Target.Anchor.Quote) == "" {
			if strings.TrimSpace(request.SelectionText) == "" {
				return fmt.Errorf("replace_text.target.anchor.quote is required")
			}
		}
		return nil
	case "delete_section":
		if strings.TrimSpace(operation.Target.Heading) == "" {
			return fmt.Errorf("delete_section.target.heading is required")
		}
		return nil
	case "replace_section":
		if strings.TrimSpace(operation.Target.Heading) == "" {
			return fmt.Errorf("replace_section.target.heading is required")
		}
		if _, ok := nonEmptyPayloadString(operation.Payload, "markdown"); !ok {
			return fmt.Errorf("replace_section.payload.markdown is required")
		}
		return nil
	case "reorder_sections":
		if _, ok := nonEmptyPayloadStringSlice(operation.Payload, "headings"); !ok {
			return fmt.Errorf("reorder_sections.payload.headings is required")
		}
		return nil
	case "add_comment":
		if _, ok := nonEmptyPayloadString(operation.Payload, "body"); !ok {
			return fmt.Errorf("add_comment.payload.body is required")
		}
		if operation.Target.Anchor == nil || strings.TrimSpace(operation.Target.Anchor.Quote) == "" {
			return fmt.Errorf("add_comment.target.anchor.quote is required")
		}
		return nil
	case "resolve_comment":
		if strings.TrimSpace(operation.Target.CommentID) == "" {
			return fmt.Errorf("resolve_comment.target.commentId is required")
		}
		return nil
	case "update_document_metadata":
		if _, ok := nonEmptyPayloadString(operation.Payload, "title"); !ok {
			return fmt.Errorf("update_document_metadata.payload.title is required")
		}
		return nil
	default:
		return fmt.Errorf("unknown document operation type %q", operation.Type)
	}
}

func validateInsertPosition(target DocumentOperationTarget) error {
	if target.Position == "" {
		return nil
	}
	switch target.Position {
	case "append", "prepend":
		return nil
	case "after_heading", "before_heading":
		if strings.TrimSpace(target.Heading) == "" {
			return fmt.Errorf("target.heading is required when position is %s", target.Position)
		}
		return nil
	default:
		return fmt.Errorf("unsupported target.position %q", target.Position)
	}
}

func nonEmptyPayloadString(payload map[string]any, key string) (string, bool) {
	value, ok := payload[key]
	if !ok {
		return "", false
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", false
	}
	return text, true
}

func nonEmptyPayloadStringSlice(payload map[string]any, key string) ([]string, bool) {
	value, ok := payload[key]
	if !ok {
		return nil, false
	}
	switch items := value.(type) {
	case []string:
		values := make([]string, 0, len(items))
		for _, item := range items {
			if trimmed := strings.TrimSpace(item); trimmed != "" {
				values = append(values, trimmed)
			}
		}
		return values, len(values) > 0
	case []any:
		values := make([]string, 0, len(items))
		for _, item := range items {
			text, ok := item.(string)
			if !ok {
				continue
			}
			if trimmed := strings.TrimSpace(text); trimmed != "" {
				values = append(values, trimmed)
			}
		}
		return values, len(values) > 0
	default:
		return nil, false
	}
}

func replaceTextOperation(summary string, content string, quote string, replacement string, createdAt string) DocumentOperationRecord {
	anchor := MakeTextAnchor(content, quote)
	return DocumentOperationRecord{
		ID:      mustDocumentOperationID("op"),
		Type:    "replace_text",
		Summary: summary,
		Target: DocumentOperationTarget{
			Anchor: &anchor,
		},
		Payload: map[string]any{
			"replacement": replacement,
		},
		CreatedAt: createdAt,
	}
}

func mustDocumentOperationID(prefix string) string {
	id, err := randomDocumentOperationID(prefix)
	if err == nil {
		return id
	}
	return prefix + "-unknown"
}

func randomDocumentOperationID(prefix string) (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(bytes[:]), nil
}

func pickDocumentOperationComment(request DocumentOperationsRequest) *mediamcp.DocumentComment {
	if request.CommentID != "" {
		for index := range request.Comments {
			if request.Comments[index].ID == request.CommentID {
				return &request.Comments[index]
			}
		}
	}
	for index := range request.Comments {
		if !request.Comments[index].Resolved {
			return &request.Comments[index]
		}
	}
	return nil
}

func shouldMockRewrite(prompt string) bool {
	for _, keyword := range []string{"改", "重写", "润色", "悬疑", "紧张", "rewrite", "revise"} {
		if strings.Contains(prompt, keyword) {
			return true
		}
	}
	return false
}

func mentionsMockComment(prompt string) bool {
	for _, keyword := range []string{"评论", "批注", "反馈", "comment", "annotation"} {
		if strings.Contains(prompt, keyword) {
			return true
		}
	}
	return false
}

func mockRewrite(text string) string {
	return strings.TrimSpace(text) + "。她停住脚步，广播里的电流声像被人按住喉咙，随后精准地重复了她刚刚没有说出口的问题。"
}

type mockInsertBlockResult struct {
	summary  string
	markdown string
}

func mockInsertBlock(prompt string, normalizedPrompt string) mockInsertBlockResult {
	if strings.Contains(normalizedPrompt, "角色") || strings.Contains(normalizedPrompt, "女主") {
		return mockInsertBlockResult{
			summary: "Inserted a backend character appearance profile.",
			markdown: `## 角色｜林雾

**形象定位**：三十岁左右女性，城市悬疑题材女主，冷静调查者形象。

**面部特征**：鹅蛋脸，浅麦色肤色，黑色齐肩短发，眼神冷静警觉。

**身材气质**：中等身高，身形清瘦，肩背挺直，行动克制利落。

**着装造型**：深色风衣，灰黑内搭，磨旧牛仔裤，低调实用的调查者造型。

**标志性细节**：旧相机斜挎在身侧，右手银色戒指，随身黑色录音笔。`,
		}
	}
	if strings.Contains(normalizedPrompt, "场景") || strings.Contains(normalizedPrompt, "空间") || strings.Contains(normalizedPrompt, "scene") || strings.Contains(normalizedPrompt, "factory") {
		return mockInsertBlockResult{
			summary: "Inserted a backend scene prompt profile.",
			markdown: `## 场景提取清单

1. 废弃临海旧厂房 | 阴冷压抑 | 冷蓝灰与锈红

## 废弃临海旧厂房

**画幅构图**：横向 16:9 电影级场景设定图，极高画质，纯净无人的空间。

**视觉风格**：冷峻现实主义电影质感，潮湿工业废墟美术，极致细节。

**环境类型**：海边废弃工业厂房，包含装配大厅、地下仓库、控制室与狭窄通道。

**时间时刻**：深夜暴雨后，破损天窗漏入冷色月光，远处海雾压低能见度。

**空间氛围**：压抑、阴冷、危险感强，空旷大厅带有被长期封存的荒废气息。

**主要特征**：前景是积水地面与锈蚀传送带，中景有半开的资料柜、断裂梁柱、编号 03:17 的巡检表，后景是控制室碎玻璃与褪色墙面标语。

**Prompt (直接复制)**：不能出现其他人, 无人, 纯场景, 深夜暴雨后的废弃临海旧厂房，冷色月光从破损天窗落入空旷装配大厅，积水地面反射锈蚀传送带、断裂梁柱、半开的资料柜、编号 03:17 的巡检表，远处控制室碎玻璃与褪色墙面标语隐在海雾中，压抑阴冷的工业废墟氛围，横向16:9电影级场景设定图，极高画质，极致细节，no humans, empty, landscape only`,
		}
	}
	if strings.Contains(normalizedPrompt, "分镜") || strings.Contains(normalizedPrompt, "镜头") {
		return mockInsertBlockResult{
			summary:  "Inserted backend shot blocks.",
			markdown: "## 分镜｜后端生成镜头\n\n```video\nstart: 36\nend: 48\nvisual: 林雾打开资料柜，旧录像带从档案袋中滑落。\naudio: 广播底噪突然归零，只剩她的呼吸声。\n```",
		}
	}

	return mockInsertBlockResult{
		summary:  "Inserted backend creative block.",
		markdown: "## 创作补充｜后端生成\n\n- 指令：" + prompt + "\n- 结果：这段内容来自 `/agent/document-operations`，可替换为真实模型输出的 JSON operations。",
	}
}
