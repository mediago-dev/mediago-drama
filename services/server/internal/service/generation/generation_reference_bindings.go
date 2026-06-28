package generation

import (
	"encoding/json"
	"strings"
)

const generationReferenceBindingsRequestOption = "_mediago_reference_bindings"

func normalizeGenerationReferenceBindings(bindings []GenerationReferenceBinding) []GenerationReferenceBinding {
	normalized := make([]GenerationReferenceBinding, 0, len(bindings))
	seen := map[string]struct{}{}
	for _, binding := range bindings {
		next := GenerationReferenceBinding{
			Kind:       strings.ToLower(strings.TrimSpace(binding.Kind)),
			DocumentID: strings.TrimSpace(binding.DocumentID),
			BlockID:    strings.TrimSpace(binding.BlockID),
			AssetID:    strings.TrimSpace(binding.AssetID),
			URL:        strings.TrimSpace(binding.URL),
		}
		if next.DocumentID == "" || (next.AssetID == "" && next.URL == "") {
			continue
		}
		if next.Kind == "" {
			if next.BlockID != "" {
				next.Kind = "section"
			} else {
				next.Kind = "document"
			}
		}
		key := generationReferenceBindingMentionKey(next) + "\x00" + generationReferenceBindingSourceKey(next)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, next)
	}
	return normalized
}

func generationParamsWithReferenceBindings(params map[string]any, bindings []GenerationReferenceBinding) map[string]any {
	bindings = normalizeGenerationReferenceBindings(bindings)
	if len(bindings) == 0 {
		return params
	}
	next := make(map[string]any, len(params)+1)
	for key, value := range params {
		next[key] = value
	}
	next[generationReferenceBindingsRequestOption] = bindings
	return next
}

func generationReferenceBindingsFromParams(params map[string]any) []GenerationReferenceBinding {
	if len(params) == 0 {
		return nil
	}
	raw, ok := params[generationReferenceBindingsRequestOption]
	if !ok || raw == nil {
		return nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var bindings []GenerationReferenceBinding
	if err := json.Unmarshal(data, &bindings); err != nil {
		return nil
	}
	return normalizeGenerationReferenceBindings(bindings)
}

func generationReferenceBindingsForPayload(payload generationMessageRequest) []GenerationReferenceBinding {
	return normalizeGenerationReferenceBindings(append(
		generationReferenceBindingsFromParams(payload.Params),
		payload.ReferenceBindings...,
	))
}

func generationReferenceBindingMentionKey(binding GenerationReferenceBinding) string {
	kind := strings.ToLower(strings.TrimSpace(binding.Kind))
	switch kind {
	case "asset":
		return "asset:" + strings.TrimSpace(firstNonEmpty(binding.AssetID, binding.DocumentID))
	case "section":
		return "section:" + strings.TrimSpace(binding.DocumentID) + ":" + strings.TrimSpace(binding.BlockID)
	default:
		return "document:" + strings.TrimSpace(binding.DocumentID)
	}
}

func generationReferenceBindingSourceKey(binding GenerationReferenceBinding) string {
	if assetID := strings.TrimSpace(binding.AssetID); assetID != "" {
		return "asset:" + assetID
	}
	if referenceURL := strings.TrimSpace(binding.URL); referenceURL != "" {
		return "url:" + referenceURL
	}
	return ""
}

func generationMentionReferenceKey(reference generationMentionReference) string {
	switch reference.Kind {
	case "asset":
		return "asset:" + strings.TrimSpace(reference.AssetID)
	case "section":
		return "section:" + strings.TrimSpace(reference.DocumentID) + ":" + strings.TrimSpace(reference.BlockID)
	default:
		return "document:" + strings.TrimSpace(reference.DocumentID)
	}
}
