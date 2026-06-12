package agentdto

// AgentDocumentToolApproval is the REST payload for a document tool approval.
type AgentDocumentToolApproval struct {
	ID              string                           `json:"id"`
	ProjectID       string                           `json:"projectId,omitempty"`
	ToolName        string                           `json:"toolName"`
	DocumentID      string                           `json:"documentId,omitempty"`
	Title           string                           `json:"title,omitempty"`
	Summary         string                           `json:"summary,omitempty"`
	Status          string                           `json:"status"`
	Request         AgentDocumentToolApprovalRequest `json:"request"`
	DecisionPayload map[string]any                   `json:"decisionPayload,omitempty"`
	CreatedAt       string                           `json:"createdAt"`
	DecidedAt       string                           `json:"decidedAt,omitempty"`
}

// AgentDocumentToolApprovalRequest is the request summary for an approval.
type AgentDocumentToolApprovalRequest struct {
	ID         string `json:"id,omitempty"`
	Name       string `json:"name"`
	DocumentID string `json:"documentId,omitempty"`
	Title      string `json:"title,omitempty"`
	Summary    string `json:"summary,omitempty"`
}

// AgentDocumentToolApprovalDecisionPayload carries typed approval decision options.
type AgentDocumentToolApprovalDecisionPayload struct {
	Config *AgentDocumentToolApprovalConfig `json:"config,omitempty"`
}

// AgentDocumentToolApprovalConfig configures an approved document tool action.
type AgentDocumentToolApprovalConfig struct {
	Prompt             string `json:"prompt,omitempty"`
	SaveSourceMaterial bool   `json:"saveSourceMaterial,omitempty"`
}
