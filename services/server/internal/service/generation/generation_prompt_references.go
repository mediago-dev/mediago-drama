package generation

import (
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

type generationReferenceSlot struct {
	Kind      string
	Names     []string
	Number    int
	SourceKey string
	Token     string
}

func (workflow *GenerationService) providerPromptForGeneration(
	route coregeneration.ModelRoute,
	payload generationMessageRequest,
) string {
	if route.Kind != coregeneration.KindVideo {
		return payload.Prompt
	}

	slots := workflow.generationReferenceSlots(payload)
	if len(slots) == 0 {
		return payload.Prompt
	}

	aliasesBySource := workflow.generationPromptMentionAliases(payload.ProjectID, payload.Prompt)
	for index := range slots {
		slots[index].Names = uniqueCompactStrings(append(
			slots[index].Names,
			aliasesBySource[slots[index].SourceKey]...,
		))
	}

	prompt := workflow.replaceGenerationPromptMentionReferences(
		payload.ProjectID,
		payload.Prompt,
		slots,
		generationReferenceBindingsForPayload(payload),
	)
	return replaceGenerationPromptReferenceNames(prompt, slots)
}

func (workflow *GenerationService) generationReferenceSlots(payload generationMessageRequest) []generationReferenceSlot {
	directURLs, referenceAssetIDsFromURLs := splitReferenceURLs(payload.ReferenceURLs)
	references := make([]generationReferenceSlot, 0, len(directURLs)+len(referenceAssetIDsFromURLs)+len(payload.ReferenceAssetIDs))

	for _, referenceURL := range directURLs {
		names := generationReferenceNamesFromURL(referenceURL)
		references = append(references, generationReferenceSlot{
			Kind:      generationReferenceKindFromURL(referenceURL),
			Names:     names,
			SourceKey: "url:" + referenceURL,
		})
	}

	for _, assetID := range uniqueCompactStrings(append(referenceAssetIDsFromURLs, payload.ReferenceAssetIDs...)) {
		if workflow == nil || workflow.mediaAssets == nil {
			continue
		}
		asset, ok, err := workflow.mediaAssets.Get(assetID)
		if err != nil || !ok {
			continue
		}

		kind := normalizedGenerationReferenceKind(asset.Kind)
		if kind == "" {
			continue
		}
		references = append(references, generationReferenceSlot{
			Kind:      kind,
			Names:     generationReferenceNamesFromFilename(asset.Filename),
			SourceKey: "asset:" + asset.ID,
		})
	}

	countsByKind := map[string]int{}
	slots := make([]generationReferenceSlot, 0, len(references))
	for _, reference := range references {
		kind := normalizedGenerationReferenceKind(reference.Kind)
		if kind == "" {
			continue
		}
		countsByKind[kind]++
		reference.Kind = kind
		reference.Number = countsByKind[kind]
		reference.Token = "@" + generationReferenceKindLabel(kind) + decimalString(reference.Number)
		slots = append(slots, reference)
	}
	return slots
}

func (workflow *GenerationService) generationPromptMentionAliases(projectID string, prompt string) map[string][]string {
	aliases := map[string][]string{}
	if strings.TrimSpace(prompt) == "" {
		return aliases
	}

	for _, match := range generationDocumentMentionPattern.FindAllStringSubmatch(prompt, -1) {
		if len(match) < 4 {
			continue
		}
		label := generationUnescapeMentionLabel(match[1])
		href := match[2]
		if href == "" {
			href = match[3]
		}
		reference, ok := generationMentionReferenceFromHref(href)
		if !ok {
			continue
		}
		for _, sourceKey := range workflow.generationMentionSourceKeys(projectID, reference) {
			aliases[sourceKey] = append(aliases[sourceKey], label)
			break
		}
	}

	for sourceKey, names := range aliases {
		aliases[sourceKey] = uniqueCompactStrings(names)
	}
	return aliases
}

func (workflow *GenerationService) generationMentionSourceKeys(projectID string, reference generationMentionReference) []string {
	switch reference.Kind {
	case "asset":
		if reference.AssetID == "" {
			return nil
		}
		return []string{"asset:" + reference.AssetID}
	case "document", "section":
		if workflow == nil || workflow.documents == nil || reference.DocumentID == "" {
			return nil
		}
		document, err := workflow.documents.RequireWorkspaceDocument(projectID, reference.DocumentID)
		if err != nil {
			return nil
		}

		referencedMarkdown := document.Content
		if reference.Kind == "section" && reference.BlockID != "" {
			section, ok := generationDocumentSectionByBlockID(document, reference.BlockID)
			if !ok {
				return nil
			}
			referencedMarkdown = section.Markdown
		} else if reference.Kind == "document" {
			if section, ok := generationSingleDocumentSection(document); ok {
				referencedMarkdown = section.Markdown
			}
		}

		assetIDs, referenceURLs := generationImageReferencesFromMarkdown(referencedMarkdown)
		sourceKeys := make([]string, 0, len(assetIDs)+len(referenceURLs))
		for _, assetID := range assetIDs {
			sourceKeys = append(sourceKeys, "asset:"+assetID)
		}
		for _, referenceURL := range referenceURLs {
			sourceKeys = append(sourceKeys, "url:"+referenceURL)
		}
		return sourceKeys
	default:
		return nil
	}
}

func (workflow *GenerationService) replaceGenerationPromptMentionReferences(
	projectID string,
	prompt string,
	slots []generationReferenceSlot,
	bindings []GenerationReferenceBinding,
) string {
	if len(slots) == 0 || strings.TrimSpace(prompt) == "" {
		return prompt
	}

	bySource := map[string]generationReferenceSlot{}
	for _, slot := range slots {
		if slot.SourceKey != "" {
			bySource[slot.SourceKey] = slot
		}
	}
	byMention := map[string]generationReferenceSlot{}
	for _, binding := range bindings {
		sourceKey := generationReferenceBindingSourceKey(binding)
		slot, ok := bySource[sourceKey]
		if !ok {
			continue
		}
		mentionKey := generationReferenceBindingMentionKey(binding)
		if mentionKey == "" {
			continue
		}
		if _, exists := byMention[mentionKey]; !exists {
			byMention[mentionKey] = slot
		}
	}

	matches := generationDocumentMentionPattern.FindAllStringSubmatchIndex(prompt, -1)
	if len(matches) == 0 {
		return prompt
	}

	var builder strings.Builder
	last := 0
	for _, match := range matches {
		if len(match) < 8 {
			continue
		}
		builder.WriteString(prompt[last:match[0]])
		original := prompt[match[0]:match[1]]
		href := ""
		if match[4] >= 0 && match[5] >= 0 {
			href = prompt[match[4]:match[5]]
		} else if match[6] >= 0 && match[7] >= 0 {
			href = prompt[match[6]:match[7]]
		}
		reference, ok := generationMentionReferenceFromHref(href)
		if !ok {
			builder.WriteString(original)
			last = match[1]
			continue
		}

		token := ""
		if slot, ok := byMention[generationMentionReferenceKey(reference)]; ok {
			token = slot.Token
		}
		for _, sourceKey := range workflow.generationMentionSourceKeys(projectID, reference) {
			if token != "" {
				break
			}
			if slot, ok := bySource[sourceKey]; ok {
				token = slot.Token
				break
			}
		}
		if token == "" {
			builder.WriteString(original)
		} else {
			builder.WriteString(token)
		}
		last = match[1]
	}
	builder.WriteString(prompt[last:])
	return builder.String()
}

func replaceGenerationPromptReferenceNames(prompt string, slots []generationReferenceSlot) string {
	if len(slots) == 0 || strings.TrimSpace(prompt) == "" {
		return prompt
	}

	type replacement struct {
		name  string
		token string
	}
	replacements := []replacement{}
	seen := map[string]bool{}
	for _, slot := range slots {
		for _, name := range slot.Names {
			name = strings.TrimSpace(name)
			if name == "" || "@"+name == slot.Token {
				continue
			}
			key := name + "\x00" + slot.Token
			if seen[key] {
				continue
			}
			seen[key] = true
			replacements = append(replacements, replacement{name: name, token: slot.Token})
		}
	}
	sort.SliceStable(replacements, func(left, right int) bool {
		return len(replacements[left].name) > len(replacements[right].name)
	})

	for _, item := range replacements {
		prompt = strings.ReplaceAll(prompt, "@"+item.name, item.token)
	}
	return prompt
}

func generationReferenceNamesFromFilename(filename string) []string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return nil
	}

	names := []string{filename}
	extension := filepath.Ext(filename)
	if extension != "" {
		names = append(names, strings.TrimSuffix(filename, extension))
	}
	return uniqueCompactStrings(names)
}

func generationReferenceNamesFromURL(referenceURL string) []string {
	referenceURL = strings.TrimSpace(referenceURL)
	if referenceURL == "" || strings.HasPrefix(strings.ToLower(referenceURL), "data:") {
		return nil
	}

	parsed, err := url.Parse(referenceURL)
	basename := ""
	if err == nil {
		basename = path.Base(parsed.Path)
	} else {
		basename = path.Base(referenceURL)
	}
	if basename == "." || basename == "/" {
		return nil
	}
	return generationReferenceNamesFromFilename(basename)
}

func generationReferenceKindFromURL(referenceURL string) string {
	trimmed := strings.ToLower(strings.TrimSpace(referenceURL))
	if strings.HasPrefix(trimmed, "data:audio/") {
		return string(coregeneration.KindAudio)
	}
	if strings.HasPrefix(trimmed, "data:video/") {
		return string(coregeneration.KindVideo)
	}
	if strings.HasPrefix(trimmed, "data:image/") {
		return string(coregeneration.KindImage)
	}

	parsed, err := url.Parse(trimmed)
	value := trimmed
	if err == nil {
		value = parsed.Path
	}
	switch filepath.Ext(value) {
	case ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus":
		return string(coregeneration.KindAudio)
	case ".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v":
		return string(coregeneration.KindVideo)
	default:
		return string(coregeneration.KindImage)
	}
}

func normalizedGenerationReferenceKind(kind string) string {
	switch coregeneration.Kind(strings.ToLower(strings.TrimSpace(kind))) {
	case coregeneration.KindImage:
		return string(coregeneration.KindImage)
	case coregeneration.KindVideo:
		return string(coregeneration.KindVideo)
	case coregeneration.KindAudio:
		return string(coregeneration.KindAudio)
	default:
		return ""
	}
}

func generationReferenceKindLabel(kind string) string {
	switch normalizedGenerationReferenceKind(kind) {
	case string(coregeneration.KindVideo):
		return "视频"
	case string(coregeneration.KindAudio):
		return "音频"
	default:
		return "图片"
	}
}

var generationMentionLabelEscapePattern = regexp.MustCompile(`\\(.)`)

func generationUnescapeMentionLabel(label string) string {
	return generationMentionLabelEscapePattern.ReplaceAllString(label, "$1")
}
