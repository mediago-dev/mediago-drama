package agent

import serviceagent "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"

// DefaultRunTimeout is zero, which disables the wall-clock timeout for one agent run.
const DefaultRunTimeout = serviceagent.DefaultAgentRunTimeout

// Runner executes one normalized agent request.
type Runner = serviceagent.AgentRunner

// RunRequest is the normalized runtime request passed to an agent runner.
type RunRequest = serviceagent.AgentRunRequest

// RunResult is the result returned by an agent runner.
type RunResult = serviceagent.AgentRunResult

// FinalResponse is the parsed final response from an agent.
type FinalResponse = serviceagent.AgentFinalResponse
