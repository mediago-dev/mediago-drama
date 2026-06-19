package agent

import (
	"strings"

	docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// AgentScopedEditContext describes the current focused document edit target.
type AgentScopedEditContext struct {
	Active        bool
	AnchorText    string
	BlockMarkdown string
	Comments      []mediamcp.DocumentComment
	Instruction   string
	SelectionText string
}

// ResolveAgentScopedEdit resolves the focused edit context for an agent request.
func ResolveAgentScopedEdit(request AgentRunRequest) AgentScopedEditContext {
	selectionText := strings.TrimSpace(request.SelectionText)
	anchorText := strings.TrimSpace(request.AnchorText)
	openComments := UnresolvedDocumentComments(request.Comments)
	targetComment := FindDocumentComment(request.Comments, request.CommentID)
	context := AgentScopedEditContext{
		AnchorText:    anchorText,
		SelectionText: selectionText,
	}

	switch {
	case targetComment != nil:
		context.Active = true
		context.Comments = []mediamcp.DocumentComment{*targetComment}
		context.AnchorText = firstNonEmpty(anchorText, targetComment.AnchorText, targetComment.Anchor.Quote)
		context.Instruction = "根据目标批注修改锚定文本所在的 Markdown 块，只改这一块。"
	case selectionText != "":
		context.Active = true
		context.AnchorText = firstNonEmpty(anchorText, selectionText)
		context.Instruction = "根据用户请求优化选中文本所在的 Markdown 块，只改这一块。"
	case strings.TrimSpace(request.Prompt) == "" && len(openComments) > 0:
		context.Active = true
		context.Comments = openComments
		context.AnchorText = firstNonEmpty(anchorText, openComments[0].AnchorText, openComments[0].Anchor.Quote)
		context.Instruction = "根据当前未解决批注修改对应 Markdown 块；每条批注只改自己的锚定块。"
	case anchorText != "":
		context.Active = true
		context.Instruction = "根据用户请求修改锚定文本所在的 Markdown 块，只改这一块。"
	default:
		return context
	}

	if request.Document != nil && context.AnchorText != "" {
		if block, ok := docs.FindMarkdownBlockForAnchor(request.Document.Content, context.AnchorText); ok {
			context.BlockMarkdown = block
		}
	}
	return context
}

// UnresolvedDocumentComments filters comments to open items.
func UnresolvedDocumentComments(comments []mediamcp.DocumentComment) []mediamcp.DocumentComment {
	openComments := []mediamcp.DocumentComment{}
	for _, comment := range comments {
		if !comment.Resolved {
			openComments = append(openComments, comment)
		}
	}
	return openComments
}

// FindDocumentComment returns a comment by ID.
func FindDocumentComment(comments []mediamcp.DocumentComment, commentID string) *mediamcp.DocumentComment {
	id := strings.TrimSpace(commentID)
	if id == "" {
		return nil
	}
	for index := range comments {
		if comments[index].ID == id {
			return &comments[index]
		}
	}
	return nil
}
