package openrouter

import "strings"

func messageContent(prompt string, referenceURLs []string) any {
	if len(referenceURLs) == 0 {
		return prompt
	}

	parts := []map[string]any{
		{
			"type": "text",
			"text": prompt,
		},
	}
	parts = append(parts, imageURLObjects(referenceURLs)...)
	return parts
}

func imageURLObjects(referenceURLs []string) []map[string]any {
	parts := make([]map[string]any, 0, len(referenceURLs))
	for _, referenceURL := range referenceURLs {
		trimmed := strings.TrimSpace(referenceURL)
		if trimmed == "" {
			continue
		}
		parts = append(parts, map[string]any{
			"type": "image_url",
			"image_url": map[string]any{
				"url": trimmed,
			},
		})
	}

	return parts
}
