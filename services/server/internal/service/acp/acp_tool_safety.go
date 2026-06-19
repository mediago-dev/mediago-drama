package acp

import (
	"encoding/json"
	"strings"
	"unicode"
)

func isMutatingACPToolCall(toolKind string, title string, rawInput []byte) bool {
	normalizedKind := strings.ToLower(strings.TrimSpace(toolKind))
	switch normalizedKind {
	case "read":
		return false
	case "edit", "write", "delete":
		return rawInputHasFields(rawInput)
	case "execute":
		command := rawInputCommand(rawInput)
		if command == "" {
			return false
		}
		return !isReadOnlyShellCommand(command)
	}

	if isNonWorkspaceMutatingACPTool(title, rawInput) {
		return false
	}

	for _, token := range []string{
		"apply_patch",
		"batch_document_edit",
		"document_patch_edit",
		"mutate",
		"update_project_config",
		"sed -i",
	} {
		if strings.Contains(strings.ToLower(title+" "+string(rawInput)), token) {
			return true
		}
	}
	return containsWorkspaceMutationTerm(title + " " + string(rawInput))
}

func containsWorkspaceMutationTerm(value string) bool {
	terms := strings.FieldsFunc(strings.ToLower(value), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	for _, term := range terms {
		switch term {
		case "write", "edit", "delete", "remove", "truncate", "create", "mkdir", "touch", "mv", "cp", "rm":
			return true
		}
	}
	return false
}

func isNonWorkspaceMutatingACPTool(title string, rawInput []byte) bool {
	normalizedTitle := strings.ToLower(strings.TrimSpace(title))
	switch normalizedTitle {
	case "todowrite", "todo", "todos":
		return true
	}
	if len(rawInput) == 0 {
		return false
	}
	var payload map[string]any
	if err := json.Unmarshal(rawInput, &payload); err != nil {
		return false
	}
	_, hasTodos := payload["todos"]
	return hasTodos
}

func rawInputHasFields(rawInput []byte) bool {
	if len(rawInput) == 0 {
		return false
	}
	var payload map[string]any
	if err := json.Unmarshal(rawInput, &payload); err != nil {
		return strings.TrimSpace(string(rawInput)) != ""
	}
	return len(payload) > 0
}

func rawInputCommand(rawInput []byte) string {
	if len(rawInput) == 0 {
		return ""
	}
	var payload struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal(rawInput, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.Command)
}

func isReadOnlyShellCommand(command string) bool {
	command = strings.TrimSpace(command)
	if command == "" {
		return false
	}
	for _, segment := range splitShellSegments(command) {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}
		if strings.Contains(segment, ">") && !strings.Contains(segment, "/dev/null") {
			return false
		}
		if !isReadOnlyShellSegment(segment) {
			return false
		}
	}
	return true
}

func splitShellSegments(command string) []string {
	command = strings.ReplaceAll(command, "&&", ";")
	command = strings.ReplaceAll(command, "||", ";")
	return strings.Split(command, ";")
}

func isReadOnlyShellSegment(segment string) bool {
	segment = strings.TrimSpace(segment)
	for _, prefix := range []string{
		"ls",
		"pwd",
		"cat ",
		"head ",
		"tail ",
		"sed -n",
		"rg ",
		"grep ",
		"find ",
		"wc ",
		"stat ",
		"du ",
		"tree ",
		"file ",
		"printf ",
		"echo ",
	} {
		if segment == prefix || strings.HasPrefix(segment, prefix) {
			return true
		}
	}
	return false
}
