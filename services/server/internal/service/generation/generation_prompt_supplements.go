package generation

import "strings"

// NormalizeGenerationPromptSupplements trims prompt-pack snapshots, drops empty
// prompts, and deduplicates by reference ID or prompt while preserving order.
func NormalizeGenerationPromptSupplements(input []GenerationPromptSupplementRequest) []GenerationPromptSupplementRequest {
	if len(input) == 0 {
		return nil
	}

	seenIDs := make(map[string]struct{}, len(input))
	seenPrompts := make(map[string]struct{}, len(input))
	normalized := make([]GenerationPromptSupplementRequest, 0, len(input))
	for _, supplement := range input {
		supplement.ReferenceID = strings.TrimSpace(supplement.ReferenceID)
		supplement.ReferenceName = strings.TrimSpace(supplement.ReferenceName)
		supplement.ReferencePrompt = strings.TrimSpace(supplement.ReferencePrompt)
		if supplement.ReferencePrompt == "" {
			continue
		}
		if supplement.ReferenceID != "" {
			if _, exists := seenIDs[supplement.ReferenceID]; exists {
				continue
			}
		}
		if _, exists := seenPrompts[supplement.ReferencePrompt]; exists {
			continue
		}

		normalized = append(normalized, supplement)
		if supplement.ReferenceID != "" {
			seenIDs[supplement.ReferenceID] = struct{}{}
		}
		seenPrompts[supplement.ReferencePrompt] = struct{}{}
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

// ApplyGenerationPromptSupplements appends normalized prompt-pack snapshots to
// the base prompt once, skipping any full supplement already present.
func ApplyGenerationPromptSupplements(prompt string, supplements []GenerationPromptSupplementRequest) string {
	current := strings.TrimSpace(prompt)
	for _, supplement := range NormalizeGenerationPromptSupplements(supplements) {
		extra := supplement.ReferencePrompt
		if current == "" {
			current = extra
			continue
		}
		if strings.Contains(current, extra) {
			continue
		}
		current += "\n\n" + extra
	}
	return current
}
