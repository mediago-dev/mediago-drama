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
	return Entry{
		ID:             model.ID,
		PackID:         model.PackID,
		Kind:           instructionpack.Kind(model.Kind),
		Slug:           model.Slug,
		Name:           model.Name,
		Title:          model.Title,
		Description:    model.Description,
		Body:           model.Body,
		Metadata:       metadataFromJSON(model.Metadata),
		Source:         normalizeLegacyEntrySource(model.Source),
		OverriddenFrom: model.OverriddenFrom,
	}
}

func entryModelFromEntry(entry Entry) domain.PackEntryModel {
	return domain.PackEntryModel{
		ID:             nonEmpty(entry.ID, instructionpack.EntryID(entry.PackID, entry.Kind, entry.Slug)),
		PackID:         entry.PackID,
		Kind:           string(entry.Kind),
		Slug:           entry.Slug,
		Name:           entry.Name,
		Title:          entry.Title,
		Description:    entry.Description,
		Body:           normalizeBody(entry.Body),
		Metadata:       mustJSON(entry.Metadata),
		Source:         normalizeLegacyEntrySource(nonEmpty(entry.Source, entrySourceUser)),
		OverriddenFrom: entry.OverriddenFrom,
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
		key := model.Kind + "/" + model.Slug
		current, exists := resolved[key]
		if !exists || sourcePriority(model.Source) >= sourcePriority(current.Source) {
			resolved[key] = model
		}
	}
	entries := make([]Entry, 0, len(resolved))
	for _, model := range resolved {
		entries = append(entries, entryFromModel(model))
	}
	return entries
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

func validateEntryForWrite(entry Entry) error {
	if strings.TrimSpace(entry.Slug) == "" || strings.TrimSpace(entry.Name) == "" {
		return fmt.Errorf("%w: entry slug and name are required", ErrInvalidPack)
	}
	if strings.TrimSpace(entry.Body) == "" {
		return fmt.Errorf("%w: entry body is required", ErrInvalidPack)
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
