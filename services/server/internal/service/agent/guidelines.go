package agent

import "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/official"

const (
	// DefaultAgentName is the fixed display name for local workspace agent output.
	DefaultAgentName = "MediaGo Drama Agent"
)

// DefaultAgentPersona is the fixed system persona for local workspace agent runs.
var DefaultAgentPersona = official.MustInstructionSection("AGENTS", "内部模板（代码读取）", "运行时身份短句")
