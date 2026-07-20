package textcompletion

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/codexapp"
)

const codexUtilityInstructions = `You are running a text-only utility task inside MediaGo Drama.
Do not inspect files, execute commands, call tools, access the network, or modify the workspace.
Follow the supplied text instructions and return only the requested final text.`

type codexSessionFactory func(context.Context, string) (codexapp.Client, error)

// CodexBackend runs isolated text-only turns through a signed-in Codex runtime.
type CodexBackend struct {
	binPath        string
	workingDir     string
	sessionFactory codexSessionFactory
}

// NewCodexBackend creates a Codex-backed text executor.
func NewCodexBackend(binPath string, workingDir string) *CodexBackend {
	return &CodexBackend{
		binPath:    strings.TrimSpace(binPath),
		workingDir: strings.TrimSpace(workingDir),
		sessionFactory: func(ctx context.Context, binPath string) (codexapp.Client, error) {
			return codexapp.Start(ctx, binPath)
		},
	}
}

// Complete executes one ephemeral Codex turn and returns its final agent message.
func (backend *CodexBackend) Complete(ctx context.Context, request Request) (Result, error) {
	if backend == nil || backend.binPath == "" || backend.sessionFactory == nil {
		return Result{}, fmt.Errorf("%w: Codex executable is not configured", ErrUnavailable)
	}
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return Result{}, fmt.Errorf("prompt is required")
	}
	session, err := backend.sessionFactory(ctx, backend.binPath)
	if err != nil {
		return Result{}, fmt.Errorf("starting Codex text executor: %w", err)
	}
	defer session.Close()
	workingDir := backend.workingDir
	if tempDir, tempErr := os.MkdirTemp("", "mediago-codex-text-"); tempErr == nil {
		workingDir = tempDir
		defer os.RemoveAll(tempDir)
	}

	developerInstructions := codexUtilityInstructions
	if instruction := strings.TrimSpace(request.SystemInstruction); instruction != "" {
		developerInstructions += "\n\n" + instruction
	}
	threadParams := map[string]any{
		"approvalPolicy":        "never",
		"developerInstructions": developerInstructions,
		"ephemeral":             true,
		"sandbox":               "read-only",
	}
	if workingDir != "" {
		threadParams["cwd"] = workingDir
	}
	if model := strings.TrimSpace(request.Model); model != "" {
		threadParams["model"] = model
	}
	var threadResponse struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
		Model string `json:"model"`
	}
	if err := session.Call(ctx, "thread/start", threadParams, &threadResponse); err != nil {
		return Result{}, fmt.Errorf("starting Codex text thread: %w", err)
	}
	threadID := strings.TrimSpace(threadResponse.Thread.ID)
	if threadID == "" {
		return Result{}, fmt.Errorf("Codex text executor returned an empty thread id")
	}

	var turnResponse struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := session.Call(ctx, "turn/start", map[string]any{
		"threadId": threadID,
		"input": []map[string]any{{
			"type": "text",
			"text": prompt,
		}},
	}, &turnResponse); err != nil {
		return Result{}, fmt.Errorf("starting Codex text turn: %w", err)
	}
	turnID := strings.TrimSpace(turnResponse.Turn.ID)
	if turnID == "" {
		return Result{}, fmt.Errorf("Codex text executor returned an empty turn id")
	}

	var streamed strings.Builder
	finalText := ""
	for {
		message, err := session.Next(ctx)
		if err != nil {
			return Result{}, fmt.Errorf("reading Codex text turn: %w", err)
		}
		switch message.Method {
		case "item/agentMessage/delta":
			var event struct {
				ThreadID string `json:"threadId"`
				TurnID   string `json:"turnId"`
				Delta    string `json:"delta"`
			}
			if json.Unmarshal(message.Params, &event) == nil && event.ThreadID == threadID && event.TurnID == turnID {
				streamed.WriteString(event.Delta)
			}
		case "item/completed":
			var event struct {
				ThreadID string `json:"threadId"`
				TurnID   string `json:"turnId"`
				Item     struct {
					Type  string  `json:"type"`
					Text  string  `json:"text"`
					Phase *string `json:"phase"`
				} `json:"item"`
			}
			if json.Unmarshal(message.Params, &event) == nil && event.ThreadID == threadID && event.TurnID == turnID && event.Item.Type == "agentMessage" {
				if event.Item.Phase == nil || *event.Item.Phase == "final_answer" {
					finalText = event.Item.Text
				}
			}
		case "turn/completed":
			var event struct {
				ThreadID string `json:"threadId"`
				Turn     struct {
					ID     string `json:"id"`
					Status string `json:"status"`
					Error  *struct {
						Message string `json:"message"`
					} `json:"error"`
				} `json:"turn"`
			}
			if json.Unmarshal(message.Params, &event) != nil || event.ThreadID != threadID || event.Turn.ID != turnID {
				continue
			}
			if event.Turn.Status != "completed" {
				message := "Codex text turn did not complete"
				if event.Turn.Error != nil && strings.TrimSpace(event.Turn.Error.Message) != "" {
					message = strings.TrimSpace(event.Turn.Error.Message)
				}
				return Result{}, fmt.Errorf("Codex text turn %s: %s", event.Turn.Status, message)
			}
			text := strings.TrimSpace(finalText)
			if text == "" {
				text = strings.TrimSpace(streamed.String())
			}
			if text == "" {
				return Result{}, fmt.Errorf("Codex text turn completed without text")
			}
			model := strings.TrimSpace(threadResponse.Model)
			if model == "" {
				model = strings.TrimSpace(request.Model)
			}
			return Result{Text: text, Executor: ExecutorCodex, Model: model}, nil
		}
	}
}
