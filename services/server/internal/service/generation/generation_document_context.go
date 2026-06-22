package generation

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

var (
	generationDocumentHeadingPattern          = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
	generationDocumentMentionPattern          = regexp.MustCompile(`@\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))\)`)
	generationDocumentImageLinePattern        = regexp.MustCompile(`^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$`)
	generationDocumentSectionIDCommentPattern = regexp.MustCompile(`^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$`)
)

// GenerationDocumentResolver reads workspace documents for generation context.
type GenerationDocumentResolver interface {
	RequireWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, error)
}

type generationDocumentSection struct {
	Markdown string
}

type generationMentionReference struct {
	AssetID    string
	BlockID    string
	DocumentID string
	Kind       string
}

func (workflow *GenerationService) applyGenerationDocumentContext(payload *generationMessageRequest) error {
	if payload == nil || payload.DocumentContext == nil {
		return nil
	}
	context := payload.DocumentContext
	documentID := strings.TrimSpace(context.DocumentID)
	if documentID == "" {
		return fmt.Errorf("documentContext.documentId is required")
	}
	if strings.TrimSpace(payload.DocumentID) != "" && strings.TrimSpace(payload.DocumentID) != documentID {
		return fmt.Errorf("documentContext.documentId does not match documentId")
	}
	payload.DocumentID = documentID
	if workflow.documents == nil {
		return fmt.Errorf("workspace document resolver is not configured")
	}

	contextProjectID := GenerationProjectIDForRequest(context.ProjectID, "")
	if payload.ProjectID != "" && contextProjectID != "" && payload.ProjectID != contextProjectID {
		return fmt.Errorf("documentContext.projectId does not match projectId")
	}
	if payload.ProjectID == "" {
		payload.ProjectID = contextProjectID
	}

	sectionID := strings.TrimSpace(context.SectionID)
	if payload.SectionID == "" {
		payload.SectionID = sectionID
	}

	document, err := workflow.documents.RequireWorkspaceDocument(payload.ProjectID, documentID)
	if err != nil {
		return err
	}

	markdown := document.Content
	if sectionID != "" {
		section, ok := generationDocumentSectionByBlockID(document, sectionID)
		if !ok {
			return fmt.Errorf("文档 section 不存在：%s", sectionID)
		}
		markdown = section.Markdown
	}

	if payload.Prompt == "" {
		payload.Prompt = strings.TrimSpace(stripGenerationDocumentImageLines(stripGenerationSectionIDCommentLines(markdown)))
	}

	sourceMarkdown := markdown
	if payload.Prompt != "" {
		sourceMarkdown += "\n\n" + payload.Prompt
	}
	assetIDs, referenceURLs := workflow.generationReferencesFromMarkdown(payload.ProjectID, sourceMarkdown)
	payload.ReferenceAssetIDs = uniqueCompactStrings(append(payload.ReferenceAssetIDs, assetIDs...))
	payload.ReferenceURLs = uniqueCompactStrings(append(payload.ReferenceURLs, referenceURLs...))
	return nil
}

func (workflow *GenerationService) generationReferencesFromMarkdown(projectID string, markdown string) ([]string, []string) {
	assetIDs, referenceURLs := generationImageReferencesFromMarkdown(markdown)

	for _, reference := range generationMentionsFromMarkdown(markdown) {
		switch reference.Kind {
		case "asset":
			if reference.AssetID != "" {
				assetIDs = append(assetIDs, reference.AssetID)
			}
		case "document", "section":
			if workflow.documents == nil || reference.DocumentID == "" {
				continue
			}
			document, err := workflow.documents.RequireWorkspaceDocument(projectID, reference.DocumentID)
			if err != nil {
				continue
			}
			referencedMarkdown := document.Content
			if reference.Kind == "section" && reference.BlockID != "" {
				section, ok := generationDocumentSectionByBlockID(document, reference.BlockID)
				if !ok {
					continue
				}
				referencedMarkdown = section.Markdown
			} else if reference.Kind == "document" {
				if section, ok := generationSingleDocumentSection(document); ok {
					referencedMarkdown = section.Markdown
				}
			}
			nextAssetIDs, nextReferenceURLs := generationImageReferencesFromMarkdown(referencedMarkdown)
			assetIDs = append(assetIDs, nextAssetIDs...)
			referenceURLs = append(referenceURLs, nextReferenceURLs...)
		}
	}

	return uniqueCompactStrings(assetIDs), uniqueCompactStrings(referenceURLs)
}

func generationMentionsFromMarkdown(markdown string) []generationMentionReference {
	references := []generationMentionReference{}
	seen := map[string]bool{}

	for _, match := range generationDocumentMentionPattern.FindAllStringSubmatch(markdown, -1) {
		href := ""
		if len(match) > 2 && match[2] != "" {
			href = match[2]
		} else if len(match) > 3 {
			href = match[3]
		}
		reference, ok := generationMentionReferenceFromHref(href)
		if !ok {
			continue
		}
		key := reference.Kind + ":" + reference.DocumentID + ":" + reference.BlockID + ":" + reference.AssetID
		if seen[key] {
			continue
		}
		seen[key] = true
		references = append(references, reference)
	}

	return references
}

func generationMentionReferenceFromHref(href string) (generationMentionReference, bool) {
	href = strings.TrimSpace(href)
	if href == "" {
		return generationMentionReference{}, false
	}

	parsed, err := url.Parse(href)
	if err != nil {
		return generationMentionReference{}, false
	}
	switch parsed.Scheme {
	case "asset":
		assetID := decodeGenerationURLPart(parsed.Host)
		if assetID == "" {
			assetID = decodeGenerationURLPart(strings.Trim(parsed.Path, "/"))
		}
		if assetID == "" {
			return generationMentionReference{}, false
		}
		return generationMentionReference{
			AssetID:    assetID,
			DocumentID: assetID,
			Kind:       "asset",
		}, true
	case "mention":
		documentID := decodeGenerationURLPart(parsed.Host)
		blockID := strings.Trim(parsed.Path, "/")
		if blockID != "" {
			blockID = decodeGenerationURLPart(blockID)
		}
		if documentID == "" {
			return generationMentionReference{}, false
		}
		kind := "document"
		if blockID != "" || parsed.Query().Get("kind") == "section" {
			kind = "section"
		}
		return generationMentionReference{
			BlockID:    blockID,
			DocumentID: documentID,
			Kind:       kind,
		}, true
	default:
		return generationMentionReference{}, false
	}
}

func generationImageReferencesFromMarkdown(markdown string) ([]string, []string) {
	assetIDs := []string{}
	referenceURLs := []string{}
	seen := map[string]bool{}

	for _, line := range strings.Split(markdown, "\n") {
		alt, source, ok := generationMarkdownImageFromLine(strings.TrimSpace(line))
		if !ok || isGenerationPlaceholderImage(alt, source) {
			continue
		}
		if assetID := libraryAssetIDFromGenerationAssetURL(source); assetID != "" {
			key := "asset:" + assetID
			if !seen[key] {
				seen[key] = true
				assetIDs = append(assetIDs, assetID)
			}
			continue
		}
		key := "url:" + source
		if !seen[key] {
			seen[key] = true
			referenceURLs = append(referenceURLs, source)
		}
	}

	return assetIDs, referenceURLs
}

func generationMarkdownImageFromLine(line string) (string, string, bool) {
	match := generationDocumentImageLinePattern.FindStringSubmatch(line)
	if len(match) == 0 {
		return "", "", false
	}
	source := ""
	if len(match) > 2 && match[2] != "" {
		source = match[2]
	} else if len(match) > 3 {
		source = match[3]
	}
	source = strings.TrimSpace(source)
	return match[1], source, source != ""
}

func isGenerationPlaceholderImage(alt string, source string) bool {
	return strings.HasPrefix(alt, "mediago-drama-section-image-pending:") ||
		strings.HasPrefix(alt, "media-cli-section-image-pending:") ||
		strings.HasPrefix(source, "data:image/svg+xml")
}

func generationDocumentSectionByBlockID(document mediamcp.WorkspaceDocument, blockID string) (generationDocumentSection, bool) {
	blockID = strings.TrimSpace(blockID)
	if blockID == "" {
		return generationDocumentSection{}, false
	}

	lines := strings.Split(document.Content, "\n")
	headingIndex, headingLevel := generationDocumentSectionHeadingLine(document, lines, blockID)
	if headingIndex < 0 {
		return generationDocumentSection{}, false
	}

	endIndex := len(lines)
	for index := headingIndex + 1; index < len(lines); index++ {
		match := generationDocumentHeadingPattern.FindStringSubmatch(lines[index])
		if len(match) == 0 || len(match[1]) > headingLevel {
			continue
		}
		endIndex = generationSectionBoundaryBeforeHeadingLine(lines, index)
		break
	}

	return generationDocumentSection{
		Markdown: strings.Join(lines[headingIndex:endIndex], "\n"),
	}, true
}

func generationSingleDocumentSection(document mediamcp.WorkspaceDocument) (generationDocumentSection, bool) {
	sections := generationDocumentSections(document)
	if len(sections) != 1 {
		return generationDocumentSection{}, false
	}
	return sections[0], true
}

func generationDocumentSections(document mediamcp.WorkspaceDocument) []generationDocumentSection {
	lines := strings.Split(document.Content, "\n")
	occurrenceByHeading := map[string]int{}
	seenSectionIDs := map[string]bool{}
	sections := []generationDocumentSection{}

	for index, line := range lines {
		match := generationDocumentHeadingPattern.FindStringSubmatch(line)
		if len(match) == 0 {
			continue
		}
		level := len(match[1])
		title := normalizeGenerationDocumentHeadingText(match[2])
		if title == "" {
			continue
		}

		key := strconv.Itoa(level) + "|" + title
		occurrenceByHeading[key]++
		sectionID := generationSectionIDBeforeHeadingLine(lines, index)
		blockID := ""
		if sectionID != "" && !seenSectionIDs[sectionID] {
			seenSectionIDs[sectionID] = true
			blockID = sectionID
		}
		if blockID == "" {
			blockID = createGenerationDocumentSectionBlockID(
				document.ID,
				level,
				occurrenceByHeading[key],
				title,
			)
		}
		section, ok := generationDocumentSectionByBlockID(document, blockID)
		if !ok {
			continue
		}
		sections = append(sections, section)
	}

	return sections
}

func generationDocumentSectionHeadingLine(document mediamcp.WorkspaceDocument, lines []string, blockID string) (int, int) {
	occurrenceByHeading := map[string]int{}
	seenSectionIDs := map[string]bool{}

	for index, line := range lines {
		match := generationDocumentHeadingPattern.FindStringSubmatch(line)
		if len(match) == 0 {
			continue
		}
		level := len(match[1])
		title := normalizeGenerationDocumentHeadingText(match[2])
		if title == "" {
			continue
		}

		key := strconv.Itoa(level) + "|" + title
		occurrenceByHeading[key]++
		sectionID := generationSectionIDBeforeHeadingLine(lines, index)
		resolvedBlockID := ""
		if sectionID != "" && !seenSectionIDs[sectionID] {
			seenSectionIDs[sectionID] = true
			resolvedBlockID = sectionID
		}
		if resolvedBlockID == "" {
			resolvedBlockID = createGenerationDocumentSectionBlockID(
				document.ID,
				level,
				occurrenceByHeading[key],
				title,
			)
		}
		if resolvedBlockID == blockID {
			return index, level
		}
	}

	return -1, 0
}

func generationSectionIDBeforeHeadingLine(lines []string, headingIndex int) string {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		match := generationDocumentSectionIDCommentPattern.FindStringSubmatch(line)
		if len(match) < 2 {
			return ""
		}
		return strings.TrimSpace(match[1])
	}
	return ""
}

func generationSectionBoundaryBeforeHeadingLine(lines []string, headingIndex int) int {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		if generationDocumentSectionIDCommentPattern.MatchString(line) {
			return index
		}
		return headingIndex
	}
	return headingIndex
}

func stripGenerationSectionIDCommentLines(markdown string) string {
	lines := strings.Split(markdown, "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		if generationDocumentSectionIDCommentPattern.MatchString(line) {
			continue
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

func stripGenerationDocumentImageLines(markdown string) string {
	lines := strings.Split(markdown, "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		_, _, ok := generationMarkdownImageFromLine(strings.TrimSpace(line))
		if ok {
			continue
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

func createGenerationDocumentSectionBlockID(documentID string, headingLevel int, headingOccurrence int, headingText string) string {
	raw := strings.Join([]string{
		documentID,
		strconv.Itoa(headingLevel),
		strconv.Itoa(headingOccurrence),
		normalizeGenerationDocumentHeadingText(headingText),
	}, "|")
	return "section-" + generationJSHashBase36(raw)
}

func generationJSHashBase36(value string) string {
	var hash int32
	for _, codeUnit := range utf16.Encode([]rune(value)) {
		hash = hash*31 + int32(codeUnit)
	}
	if hash < 0 {
		return strconv.FormatInt(-int64(hash), 36)
	}
	return strconv.FormatInt(int64(hash), 36)
}

func normalizeGenerationDocumentHeadingText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func decodeGenerationURLPart(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(decoded)
}
