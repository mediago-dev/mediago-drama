package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/codexapp"
)

type activeTurn struct {
	client                 codexapp.Client
	request                AgentRunRequest
	threadID, turnID       string
	publish                func(AgentEvent)
	items                  map[string]wireItem
	thoughts               map[string]string
	texts                  map[string]string
	finalText, finalItemID string
	streamed               bool
	mu                     sync.Mutex
	pending                map[string]*pendingRequest
	ctx                    context.Context
	cancel                 context.CancelFunc
	requests               sync.WaitGroup
	closed                 bool
}
type wireItem struct {
	ID, Type, Text, Phase, Status, Command, Cwd, Server, Tool, AggregatedOutput string
	Arguments                                                                   json.RawMessage
	Result                                                                      json.RawMessage
	ExitCode                                                                    *int
	Changes                                                                     []struct{ Path, Diff string }
}
type pendingRequest struct {
	wireID   json.RawMessage
	request  AgentRuntimePermissionRequest
	decision chan inputDecision
}
type inputDecision struct {
	option    string
	cancelled bool
	resolved  bool
	answers   map[string][]string
}

func newActiveTurn(client codexapp.Client, r AgentRunRequest, threadID string, publish func(AgentEvent)) *activeTurn {
	ctx, cancel := context.WithCancel(context.Background())
	return &activeTurn{client: client, request: r, threadID: threadID, publish: publish, items: map[string]wireItem{}, thoughts: map[string]string{}, texts: map[string]string{}, pending: map[string]*pendingRequest{}, ctx: ctx, cancel: cancel}
}
func (a *activeTurn) emit(event AgentEvent) {
	event.SessionID = a.request.SessionID
	event.ProjectID = a.request.ProjectID
	event.RunID = a.request.RunID
	event.TurnID = a.turnID
	if a.publish != nil {
		a.publish(event)
	}
}
func (a *activeTurn) close() {
	a.mu.Lock()
	a.closed = true
	a.mu.Unlock()
	a.cancel()
	a.requests.Wait()
}
func (a *activeTurn) handle(ctx context.Context, m codexapp.Message) (bool, error) {
	var p struct {
		ThreadID, TurnID, ItemID, Delta, Explanation string
		RequestID                                    json.RawMessage
		Item                                         wireItem
		Plan                                         []struct{ Step, Status string }
		Turn                                         struct {
			ID, Status string
			Error      *struct{ Message string }
		}
	}
	if err := json.Unmarshal(m.Params, &p); err != nil {
		return false, fmt.Errorf("decoding Codex event %s: %w", m.Method, err)
	}
	if (p.ThreadID != "" && p.ThreadID != a.threadID) || (p.TurnID != "" && p.TurnID != a.turnID) {
		if len(m.ID) > 0 {
			a.respond(m.ID, nil, &codexapp.RPCError{Code: -32602, Message: "conversation mismatch"})
		}
		return false, nil
	}
	if len(m.ID) > 0 {
		a.requests.Add(1)
		go func() { defer a.requests.Done(); a.handleRequest(m) }()
		return false, nil
	}
	switch m.Method {
	case "item/started":
		a.items[p.Item.ID] = p.Item
		a.tool(p.Item, false)
	case "item/completed":
		a.items[p.Item.ID] = p.Item
		if p.Item.Type == "agentMessage" {
			text := FirstNonEmpty(p.Item.Text, a.texts[p.Item.ID])
			phase := AgentMessagePhase(p.Item.Phase)
			a.emit(AgentEvent{Type: "agent.message.completed", ItemID: p.Item.ID, Phase: phase, Message: text, Content: text})
			if p.Item.Phase == "final_answer" || p.Item.Phase == "" {
				a.finalText = text
				a.finalItemID = p.Item.ID
			}
		} else {
			a.tool(p.Item, true)
		}
	case "item/agentMessage/delta":
		item := a.items[p.ItemID]
		a.texts[p.ItemID] += p.Delta
		a.streamed = true
		a.emit(AgentEvent{Type: "agent.message.delta", ItemID: p.ItemID, Phase: AgentMessagePhase(item.Phase), Message: p.Delta, Delta: p.Delta})
	case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
		a.thoughts[p.ItemID] += p.Delta
		a.emit(AgentEvent{Type: "agent.runtime", ItemID: p.ItemID, Runtime: &AgentRuntimeEvent{Kind: "thought", Thought: p.Delta}})
	case "item/commandExecution/outputDelta":
		a.emit(AgentEvent{Type: "agent.runtime", ItemID: p.ItemID, Runtime: &AgentRuntimeEvent{Kind: "toolCallUpdate", ToolCallID: p.ItemID, Content: []AgentRuntimeContentBlock{{Type: "terminal", Text: p.Delta}}}})
	case "turn/plan/updated":
		plan := []AgentRuntimePlanEntry{}
		for _, step := range p.Plan {
			status := step.Status
			if status == "inProgress" {
				status = "in_progress"
			}
			plan = append(plan, AgentRuntimePlanEntry{Content: step.Step, Status: status})
		}
		a.emit(AgentEvent{Type: "agent.runtime", Message: p.Explanation, Runtime: &AgentRuntimeEvent{Kind: "plan", Plan: plan}})
	case "serverRequest/resolved":
		a.mu.Lock()
		for _, pending := range a.pending {
			if string(pending.wireID) == string(p.RequestID) {
				select {
				case pending.decision <- inputDecision{cancelled: true, resolved: true}:
				default:
				}
			}
		}
		a.mu.Unlock()
	case "error":
		var failure struct {
			Error     struct{ Message string }
			WillRetry bool
		}
		if json.Unmarshal(m.Params, &failure) == nil && !failure.WillRetry {
			return false, fmt.Errorf("Codex: %s", failure.Error.Message)
		}
	case "turn/completed":
		if p.Turn.ID != a.turnID {
			return false, nil
		}
		switch p.Turn.Status {
		case "completed":
			return true, nil
		case "interrupted":
			return false, context.Canceled
		default:
			message := "turn failed"
			if p.Turn.Error != nil {
				message = p.Turn.Error.Message
			}
			return false, fmt.Errorf("Codex: %s", message)
		}
	}
	return false, ctx.Err()
}
func (a *activeTurn) tool(item wireItem, completed bool) {
	kind, title := "", ""
	switch item.Type {
	case "commandExecution":
		kind = "execute"
		title = item.Command
	case "fileChange":
		kind = "edit"
		title = "文件变更"
	case "mcpToolCall":
		kind = "other"
		title = "mcp__" + item.Server + "__" + item.Tool
	case "webSearch":
		kind = "search"
		title = "网页搜索"
	default:
		return
	}
	status := "in_progress"
	eventKind := "toolCall"
	if completed {
		status = "completed"
		eventKind = "toolCallUpdate"
		if item.Status == "failed" || item.Status == "declined" {
			status = "failed"
		}
	}
	raw, _ := json.Marshal(item)
	event := &AgentRuntimeEvent{Kind: eventKind, ToolCallID: item.ID, ToolKind: kind, Title: title, Status: status, RawInput: item.Arguments, RawOutput: item.Result}
	if len(event.RawOutput) == 0 && completed {
		event.RawOutput = raw
	}
	if item.AggregatedOutput != "" {
		event.Content = append(event.Content, AgentRuntimeContentBlock{Type: "terminal", Text: item.AggregatedOutput, ExitCode: item.ExitCode})
	}
	for _, change := range item.Changes {
		event.Locations = append(event.Locations, AgentRuntimeLocation{Path: change.Path})
		event.Content = append(event.Content, AgentRuntimeContentBlock{Type: "text", Path: change.Path, Text: change.Diff})
	}
	a.emit(AgentEvent{Type: "agent.runtime", ItemID: item.ID, Message: title, Runtime: event})
}
func (a *activeTurn) respond(id json.RawMessage, value any, rpcError *codexapp.RPCError) {
	if responder, ok := a.client.(codexapp.Responder); ok {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := responder.Respond(ctx, id, value, rpcError); err != nil {
			runtimeLog().Warn("Codex server request reply failed", "error", err)
		}
	}
}
func (a *activeTurn) handleRequest(m codexapp.Message) {
	var p struct {
		ItemID, Reason, Command, ServerName, Message, Mode, URL string
		Permissions                                             json.RawMessage
		AvailableDecisions                                      []json.RawMessage
		Questions                                               []struct {
			ID, Header, Question string
			IsSecret             bool
			Options              []AgentInputOption
		}
		RequestedSchema struct {
			Properties map[string]formProperty
			Required   []string
		}
	}
	if json.Unmarshal(m.Params, &p) != nil {
		a.respond(m.ID, nil, &codexapp.RPCError{Code: -32602, Message: "invalid request"})
		return
	}
	switch m.Method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval", "mcpServer/elicitation/request", "item/tool/requestUserInput":
	default:
		a.respond(m.ID, nil, &codexapp.RPCError{Code: -32601, Message: "unsupported client method"})
		return
	}
	request := AgentRuntimePermissionRequest{RequestID: MustRandomID("codex-request"), CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), ToolCall: &AgentRuntimeToolCallSummary{ID: p.ItemID, Title: FirstNonEmpty(p.Command, p.Reason, p.Message, "Codex 请求确认"), Status: "pending"}, Options: []AgentRuntimePermissionOption{{OptionID: "accept", Kind: "allow_once", Name: "允许一次"}, {OptionID: "decline", Kind: "reject_once", Name: "拒绝"}}}
	switch m.Method {
	case "item/commandExecution/requestApproval":
		request.ToolCall.Kind = "execute"
	case "item/fileChange/requestApproval":
		request.ToolCall.Kind = "edit"
	case "item/tool/requestUserInput":
		request.ToolCall.Kind = "input"
		request.Options[0].Name = "提交回答"
		for _, q := range p.Questions {
			request.Questions = append(request.Questions, AgentInputQuestion{ID: q.ID, Header: q.Header, Question: q.Question, Secret: q.IsSecret, Required: true, Options: q.Options})
		}
	case "mcpServer/elicitation/request":
		request.ToolCall.Kind = "input"
		request.Options[0].Name = "确认提交"
		if p.Mode == "url" {
			if strings.HasPrefix(p.URL, "https://") || strings.HasPrefix(p.URL, "http://") {
				request.URL = p.URL
			}
		} else {
			keys := make([]string, 0, len(p.RequestedSchema.Properties))
			for id := range p.RequestedSchema.Properties {
				keys = append(keys, id)
			}
			sort.Strings(keys)
			for _, id := range keys {
				prop := p.RequestedSchema.Properties[id]
				options := []AgentInputOption{}
				for _, v := range prop.values() {
					options = append(options, AgentInputOption{Label: v})
				}
				if prop.Type == "boolean" {
					options = []AgentInputOption{{Label: "true"}, {Label: "false"}}
				}
				request.Questions = append(request.Questions, AgentInputQuestion{ID: id, Header: prop.Title, Question: FirstNonEmpty(prop.Description, prop.Title, id), Type: prop.Type, Required: contains(p.RequestedSchema.Required, id), Options: options})
			}
		}
	}
	if len(p.AvailableDecisions) > 0 {
		allowed := []AgentRuntimePermissionOption{}
		for _, option := range request.Options {
			for _, wire := range p.AvailableDecisions {
				var value string
				if json.Unmarshal(wire, &value) == nil && value == option.OptionID {
					allowed = append(allowed, option)
				}
			}
		}
		request.Options = allowed
	}
	pending := &pendingRequest{wireID: m.ID, request: request, decision: make(chan inputDecision, 1)}
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		a.respond(m.ID, cancelledResponse(m.Method), nil)
		return
	}
	a.pending[request.RequestID] = pending
	a.mu.Unlock()
	defer func() { a.mu.Lock(); delete(a.pending, request.RequestID); a.mu.Unlock() }()
	a.emit(AgentEvent{Type: "agent.runtime", Message: request.ToolCall.Title, Runtime: &AgentRuntimeEvent{Kind: "permissionRequest", PermissionRequest: &request}})
	timer := time.NewTimer(5 * time.Minute)
	defer timer.Stop()
	decision := inputDecision{cancelled: true}
	select {
	case decision = <-pending.decision:
	case <-a.ctx.Done():
	case <-timer.C:
	}
	choice := decision.option
	if decision.cancelled {
		choice = "cancel"
	}
	var response any = map[string]string{"decision": choice}
	switch m.Method {
	case "item/permissions/requestApproval":
		permissions := json.RawMessage(`{}`)
		if choice == "accept" {
			if len(p.Permissions) > 0 {
				permissions = p.Permissions
			}
		}
		response = map[string]any{"permissions": permissions, "scope": "turn"}
	case "mcpServer/elicitation/request":
		action := choice
		if choice == "accept" {
			action = "accept"
		} else if choice == "decline" {
			action = "decline"
		} else {
			action = "cancel"
		}
		var content any
		if action == "accept" && p.Mode != "url" {
			values := map[string]any{}
			for id, prop := range p.RequestedSchema.Properties {
				if answer := decision.answers[id]; len(answer) > 0 {
					value, err := prop.parse(answer)
					if err == nil {
						values[id] = value
					}
				}
			}
			content = values
		}
		response = map[string]any{"action": action, "content": content}
	case "item/tool/requestUserInput":
		answers := map[string]any{}
		if choice == "accept" {
			for id, values := range decision.answers {
				answers[id] = map[string]any{"answers": values}
			}
		}
		response = map[string]any{"answers": answers}
	}
	if !decision.resolved {
		a.respond(m.ID, response, nil)
	}
	a.mu.Lock()
	delete(a.pending, request.RequestID)
	a.mu.Unlock()
	a.emit(AgentEvent{Type: "agent.runtime", Runtime: &AgentRuntimeEvent{Kind: "permissionResolved", Status: choice, PermissionRequest: &request}})
}

// ResolvePermission answers one pending request, scoped to the MediaGo session.
func (r *Runner) ResolvePermission(sessionID, requestID, optionID string, cancelled bool) error {
	return r.ResolveUserInput(sessionID, requestID, optionID, nil, cancelled)
}

// ResolveUserInput validates and delivers structured answers to Codex.
func (r *Runner) ResolveUserInput(sessionID, requestID, optionID string, answers map[string][]string, cancelled bool) error {
	r.mu.Lock()
	var active *activeTurn
	for _, candidate := range r.active {
		if candidate.request.SessionID == sessionID {
			active = candidate
			break
		}
	}
	r.mu.Unlock()
	if active == nil {
		return fmt.Errorf("active Codex session not found")
	}
	active.mu.Lock()
	defer active.mu.Unlock()
	pending := active.pending[requestID]
	if pending == nil {
		return fmt.Errorf("Codex request is no longer pending")
	}
	if !cancelled {
		valid := false
		for _, option := range pending.request.Options {
			if option.OptionID == optionID {
				valid = true
			}
		}
		if !valid {
			return fmt.Errorf("unsupported Codex approval decision")
		}
	}
	if optionID == "accept" && !cancelled {
		for _, q := range pending.request.Questions {
			values := answers[q.ID]
			if q.Required && (len(values) == 0 || strings.TrimSpace(values[0]) == "") {
				return fmt.Errorf("请回答：%s", q.Question)
			}
			if len(values) > 0 {
				prop := formProperty{Type: q.Type}
				for _, o := range q.Options {
					prop.Enum = append(prop.Enum, o.Label)
				}
				if _, err := prop.parse(values); err != nil {
					return fmt.Errorf("%s: %w", q.Question, err)
				}
			}
		}
	}
	select {
	case pending.decision <- inputDecision{option: optionID, cancelled: cancelled, answers: answers}:
		return nil
	default:
		return fmt.Errorf("Codex request already answered")
	}
}

// PendingPermissions returns only requests for the requested MediaGo session.
func (r *Runner) PendingPermissions(sessionID string) []AgentRuntimePermissionRequest {
	r.mu.Lock()
	var active *activeTurn
	for _, candidate := range r.active {
		if candidate.request.SessionID == sessionID {
			active = candidate
			break
		}
	}
	r.mu.Unlock()
	if active == nil {
		return nil
	}
	active.mu.Lock()
	defer active.mu.Unlock()
	result := []AgentRuntimePermissionRequest{}
	for _, pending := range active.pending {
		result = append(result, pending.request)
	}
	return result
}

func cancelledResponse(method string) any {
	switch method {
	case "item/tool/requestUserInput":
		return map[string]any{"answers": map[string]any{}}
	case "mcpServer/elicitation/request":
		return map[string]any{"action": "cancel", "content": nil}
	case "item/permissions/requestApproval":
		return map[string]any{"permissions": map[string]any{}, "scope": "turn"}
	default:
		return map[string]string{"decision": "cancel"}
	}
}

type formProperty struct {
	Type, Title, Description string
	Enum                     []string
	OneOf                    []struct{ Const, Title string }
	Items                    struct {
		Enum  []string
		AnyOf []struct{ Const, Title string }
	}
}

func (p formProperty) values() []string {
	values := append([]string{}, p.Enum...)
	for _, v := range p.OneOf {
		values = append(values, v.Const)
	}
	values = append(values, p.Items.Enum...)
	for _, v := range p.Items.AnyOf {
		values = append(values, v.Const)
	}
	return values
}
func (p formProperty) parse(values []string) (any, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("missing answer")
	}
	allowed := p.values()
	// Native Codex questions permit free-text answers; MCP enum fields do not.
	if p.Type != "" && len(allowed) > 0 {
		for _, v := range values {
			if !contains(allowed, v) {
				return nil, fmt.Errorf("invalid option")
			}
		}
	}
	switch p.Type {
	case "boolean":
		return strconv.ParseBool(values[0])
	case "integer":
		return strconv.ParseInt(values[0], 10, 64)
	case "number":
		return strconv.ParseFloat(values[0], 64)
	case "array":
		return values, nil
	default:
		return values[0], nil
	}
}
