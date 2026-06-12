package acp

func activeAgentDocumentID(request AgentRunRequest) string {
	if request.Document != nil {
		return request.Document.ID
	}
	return ""
}
