package promptpack

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func packFromModel(model domain.PackModel) Pack {
	return Pack{
		ID:          model.ID,
		Name:        model.Name,
		Version:     model.Version,
		ReleaseID:   model.ReleaseID,
		Author:      model.Author,
		Description: model.Description,
		Source:      normalizePackSource(model.Source, model.ID),
		Origin:      model.Origin,
		Enabled:     model.Enabled,
		CreatedAt:   domain.StringFromTime(model.CreatedAt),
		UpdatedAt:   domain.StringFromTime(model.UpdatedAt),
	}
}

func entryFromModel(model domain.PackEntryModel) Entry {
	metadata := metadataFromJSON(model.Metadata)
	linked := metadataBool(metadata, entryMetadataLinked)
	referenceEntryID := ""
	referencePackID := ""
	if linked {
		referenceEntryID = metadataText(metadata, entryMetadataCopiedFrom)
		referencePackID = metadataText(metadata, entryMetadataCopiedFromPack)
	}
	return Entry{
		ID:               model.ID,
		PackID:           model.PackID,
		ReleaseID:        model.ReleaseID,
		SourcePackageID:  model.SourcePackageID,
		SourceReleaseID:  model.SourceReleaseID,
		Kind:             instructionpack.Kind(model.Kind),
		Slug:             model.Slug,
		Name:             model.Name,
		Title:            model.Title,
		Description:      model.Description,
		Body:             model.Body,
		Metadata:         metadata,
		Source:           normalizeLegacyEntrySource(model.Source),
		OverriddenFrom:   model.OverriddenFrom,
		Linked:           linked && referenceEntryID != "",
		ReferenceEntryID: referenceEntryID,
		ReferencePackID:  referencePackID,
	}
}

func entryModelFromEntry(entry Entry) domain.PackEntryModel {
	return domain.PackEntryModel{
		ID:              nonEmpty(entry.ID, instructionpack.EntryID(entry.PackID, entry.Kind, entry.Slug)),
		PackID:          entry.PackID,
		ReleaseID:       entry.ReleaseID,
		SourcePackageID: entry.SourcePackageID,
		SourceReleaseID: entry.SourceReleaseID,
		Kind:            string(entry.Kind),
		Slug:            entry.Slug,
		Name:            entry.Name,
		Title:           entry.Title,
		Description:     entry.Description,
		Body:            normalizeBody(entry.Body),
		Metadata:        mustJSON(entry.Metadata),
		Source:          normalizeLegacyEntrySource(nonEmpty(entry.Source, entrySourceUser)),
		OverriddenFrom:  entry.OverriddenFrom,
	}
}

func entryModelFromPackEntry(entry instructionpack.Entry, source string) domain.PackEntryModel {
	return domain.PackEntryModel{
		ID:          entry.ID,
		PackID:      entry.PackID,
		Kind:        string(entry.Kind),
		Slug:        entry.Slug,
		Name:        entry.Name,
		Title:       entry.Title,
		Description: entry.Description,
		Body:        normalizeBody(entry.Body),
		Metadata:    mustJSON(entry.Metadata),
		Source:      normalizeLegacyEntrySource(source),
	}
}

func categoryFromModel(model domain.PackCategoryModel) Category {
	return Category{
		ID:      model.ID,
		PackID:  model.PackID,
		Label:   model.Label,
		Order:   model.Order,
		Source:  normalizeLegacyEntrySource(model.Source),
		Builtin: model.Builtin,
	}
}

func categoryModelFromCategory(category Category) domain.PackCategoryModel {
	return domain.PackCategoryModel{
		PackID:  category.PackID,
		ID:      category.ID,
		Label:   category.Label,
		Order:   category.Order,
		Source:  normalizeLegacyEntrySource(nonEmpty(category.Source, entrySourceUser)),
		Builtin: category.Builtin,
	}
}

func resolveEntryModels(models []domain.PackEntryModel) []Entry {
	resolved := map[string]domain.PackEntryModel{}
	for _, model := range models {
		if entryIsLinkedReference(entryFromModel(model)) {
			continue
		}
		key := model.Kind + "/" + model.Slug
		current, exists := resolved[key]
		if !exists || sourcePriority(model.Source) >= sourcePriority(current.Source) {
			resolved[key] = model
		}
	}
	entries := make([]Entry, 0, len(resolved))
	for _, model := range resolved {
		entry := entryFromModel(model)
		if entryIsHidden(entry) {
			continue
		}
		entries = append(entries, entry)
	}
	return entries
}

func resolvePackEntryModels(models []domain.PackEntryModel, packID string) []Entry {
	byID := entryModelsByID(models)
	entries := make([]Entry, 0)
	for _, model := range models {
		if model.PackID != packID {
			continue
		}
		entry := resolveLinkedEntryModel(model, byID, map[string]bool{})
		if entryIsHidden(entry) {
			continue
		}
		entries = append(entries, entry)
	}
	return entries
}

func entryModelsByID(models []domain.PackEntryModel) map[string]domain.PackEntryModel {
	byID := make(map[string]domain.PackEntryModel, len(models))
	for _, model := range models {
		byID[model.ID] = model
	}
	return byID
}

func resolveLinkedEntryModel(
	model domain.PackEntryModel,
	byID map[string]domain.PackEntryModel,
	visited map[string]bool,
) Entry {
	target := entryFromModel(model)
	if !target.Linked {
		return target
	}
	if visited[model.ID] {
		target.ReferenceMissing = true
		return target
	}
	visited[model.ID] = true
	sourceModel, ok := byID[target.ReferenceEntryID]
	if !ok {
		target.ReferenceMissing = true
		return target
	}
	source := resolveLinkedEntryModel(sourceModel, byID, visited)
	resolved := target
	resolved.SourcePackageID, resolved.SourceReleaseID = contentProvenance(source)
	if resolved.Kind == instructionpack.KindPrompt {
		resolved.Name = source.Name
	}
	resolved.Title = source.Title
	resolved.Description = source.Description
	resolved.Body = source.Body
	resolved.Metadata = cloneMetadata(source.Metadata)
	if resolved.Metadata == nil {
		resolved.Metadata = map[string]any{}
	}
	resolved.Metadata[entryMetadataCopiedFrom] = target.ReferenceEntryID
	resolved.Metadata[entryMetadataCopiedFromPack] = source.PackID
	resolved.Metadata[entryMetadataLinked] = true
	resolved.ReferencePackID = source.PackID
	resolved.ReferenceSlug = source.Slug
	resolved.ReferenceSource = source.Source
	resolved.ReferenceEditable = source.Source == entrySourceUser && source.OverriddenFrom == ""
	resolved.ReferenceMissing = source.ReferenceMissing
	return resolved
}

func contentProvenance(entry Entry) (string, string) {
	packageID := strings.TrimSpace(entry.SourcePackageID)
	releaseID := strings.TrimSpace(entry.SourceReleaseID)
	if packageID != "" && releaseID != "" {
		return packageID, releaseID
	}
	if strings.TrimSpace(entry.PackID) != "" && strings.TrimSpace(entry.ReleaseID) != "" {
		return strings.TrimSpace(entry.PackID), strings.TrimSpace(entry.ReleaseID)
	}
	return "", ""
}

func packContentProvenance(pack domain.PackModel) (string, string) {
	if strings.TrimSpace(pack.ID) == "" || strings.TrimSpace(pack.ReleaseID) == "" {
		return "", ""
	}
	return strings.TrimSpace(pack.ID), strings.TrimSpace(pack.ReleaseID)
}

func resolveCategoryModels(models []domain.PackCategoryModel) []Category {
	resolved := map[string]domain.PackCategoryModel{}
	for _, model := range models {
		current, exists := resolved[model.ID]
		if !exists || sourcePriority(model.Source) >= sourcePriority(current.Source) {
			resolved[model.ID] = model
		}
	}
	categories := make([]Category, 0, len(resolved))
	for _, model := range resolved {
		categories = append(categories, categoryFromModel(model))
	}
	return categories
}

func sortEntries(entries []Entry) {
	sort.SliceStable(entries, func(first, second int) bool {
		if entries[first].Kind != entries[second].Kind {
			return entries[first].Kind < entries[second].Kind
		}
		return entries[first].Slug < entries[second].Slug
	})
}

func sourcePriority(source string) int {
	switch source {
	case entrySourceUser:
		return 3
	case entrySourcePack:
		return 1
	default:
		return 0
	}
}

func metadataFromJSON(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(raw), &metadata); err != nil {
		return map[string]any{}
	}
	return metadata
}

func mustJSON(value map[string]any) string {
	if len(value) == 0 {
		return "{}"
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func entryIsHidden(entry Entry) bool {
	hidden, ok := entry.Metadata[entryMetadataHidden].(bool)
	return ok && hidden
}

func entryIsLinkedReference(entry Entry) bool {
	return entry.Linked && strings.TrimSpace(entry.ReferenceEntryID) != ""
}

func validateEntryForWrite(entry Entry) error {
	if err := validateDraftEntryForWrite(entry); err != nil {
		return err
	}
	if strings.TrimSpace(entry.Body) == "" {
		return fmt.Errorf("%w: entry body is required", ErrInvalidPack)
	}
	return nil
}

func validateDraftEntryForWrite(entry Entry) error {
	if strings.TrimSpace(entry.Slug) == "" {
		return fmt.Errorf("%w: entry slug is required", ErrInvalidPack)
	}
	name := strings.TrimSpace(entry.Name)
	if entry.Kind == instructionpack.KindSkill && strings.TrimSpace(entry.Title) != "" {
		name = strings.TrimSpace(entry.Title)
	}
	if name == "" {
		return fmt.Errorf("%w: entry name is required", ErrInvalidPack)
	}
	return nil
}

func validateEntrySlug(kind instructionpack.Kind, slug string) error {
	slug = strings.TrimSpace(slug)
	if kind == instructionpack.KindSkill {
		if !instructionpack.IsSafeSkillName(slug) {
			return fmt.Errorf("%w: skill slug is invalid", ErrInvalidPack)
		}
		return nil
	}
	if !localPackIDPattern.MatchString(slug) {
		return fmt.Errorf("%w: prompt slug is invalid", ErrInvalidPack)
	}
	return nil
}

func normalizeBody(body string) string {
	body = strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
	if body == "" {
		return ""
	}
	return body + "\n"
}

func nonEmpty(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func overriddenFromForLegacy(id string, source string, builtin bool) string {
	if source == entrySourceUser && builtin {
		return id
	}
	return ""
}

func normalizePackSource(source string, packID string) string {
	switch strings.TrimSpace(source) {
	case packSourceDefault:
		return packSourceDefault
	case packSourceImported:
		return packSourceImported
	case packSourceLocal:
		return packSourceLocal
	case "builtin":
		return packSourceDefault
	case "":
		if strings.TrimSpace(packID) == DefaultPackID {
			return packSourceDefault
		}
	}
	return packSourceImported
}

func normalizeLegacyEntrySource(source string) string {
	switch strings.TrimSpace(source) {
	case entrySourceUser:
		return entrySourceUser
	case entrySourcePack, "builtin", "imported":
		return entrySourcePack
	default:
		return entrySourcePack
	}
}
