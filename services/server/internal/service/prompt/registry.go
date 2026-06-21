package prompt

import (
	"context"
	"log/slog"
	"sort"
	"strings"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
)

// SectionDescriptor describes one system prompt section and its UI metadata.
type SectionDescriptor struct {
	ID          string
	Name        string
	Description string
	Order       int
	Editable    bool
	DataFn      func(PromptContext) any
	Condition   func(PromptContext) bool
}

type agentsMdData struct {
	SystemPrompt string
	SkillIndex   []serviceskill.SkillMeta
}

var fallbackSections = []SectionDescriptor{
	{
		ID:          "AGENTS",
		Name:        "AGENTS.md",
		Description: "Agent 操作指令：默认身份边界、写作策略、工具调用策略和 Skills 装载策略。",
		Order:       0,
		Editable:    true,
		DataFn: func(ctx PromptContext) any {
			return agentsMdData{
				SystemPrompt: strings.TrimSpace(ctx.Request.SystemPrompt),
				SkillIndex:   loadSkillIndex(ctx),
			}
		},
	},
	{
		ID:          "TOOLS",
		Name:        "TOOLS.md",
		Description: "跨工具编排策略：项目级审查、局部编辑触发和连续编辑复用。",
		Order:       1,
		Editable:    true,
		DataFn:      promptContextData,
	},
}

// SectionDescriptors returns every registered prompt section in injection order.
func SectionDescriptors() []SectionDescriptor {
	entries, err := currentPackStore().ListEntries(context.Background(), instructionpack.KindInstruction)
	if err != nil {
		slog.Warn("prompt instruction registry unavailable", "error", err)
		return sortedSectionDescriptors(fallbackSections)
	}
	descriptors := descriptorsFromEntries(entries)
	if len(descriptors) == 0 {
		return sortedSectionDescriptors(fallbackSections)
	}
	return sortedSectionDescriptors(descriptors)
}

// EditableSectionDescriptors returns registered sections that Settings may expose.
func EditableSectionDescriptors() []SectionDescriptor {
	descriptors := make([]SectionDescriptor, 0, len(fallbackSections))
	for _, descriptor := range SectionDescriptors() {
		if descriptor.Editable {
			descriptors = append(descriptors, descriptor)
		}
	}
	return sortedSectionDescriptors(descriptors)
}

// SectionDescriptorByID returns the registered prompt section metadata for an ID.
func SectionDescriptorByID(id string) (SectionDescriptor, bool) {
	id = strings.TrimSpace(id)
	for _, descriptor := range SectionDescriptors() {
		if descriptor.ID == id {
			return descriptor, true
		}
	}
	return SectionDescriptor{}, false
}

func loadSkillIndex(ctx PromptContext) []serviceskill.SkillMeta {
	metas, err := serviceskill.NewRegistry().List(context.Background())
	if err != nil {
		slog.Warn("skill index unavailable for prompt", "error", err)
		return nil
	}
	return metas
}

func promptContextData(ctx PromptContext) any {
	return ctx
}

func descriptorsFromEntries(entries []promptpack.Entry) []SectionDescriptor {
	descriptors := make([]SectionDescriptor, 0, len(entries))
	for _, entry := range entries {
		descriptor := SectionDescriptor{
			ID:          entry.Slug,
			Name:        nonEmpty(entry.Title, entry.Name),
			Description: entry.Description,
			Order:       metadataInt(entry.Metadata, "order"),
			Editable:    metadataBool(entry.Metadata, "editable"),
			DataFn:      promptContextData,
		}
		if descriptor.ID == "AGENTS" {
			descriptor.DataFn = func(ctx PromptContext) any {
				return agentsMdData{
					SystemPrompt: strings.TrimSpace(ctx.Request.SystemPrompt),
					SkillIndex:   loadSkillIndex(ctx),
				}
			}
		}
		descriptors = append(descriptors, descriptor)
	}
	return descriptors
}

func sortedSectionDescriptors(input []SectionDescriptor) []SectionDescriptor {
	descriptors := append([]SectionDescriptor(nil), input...)
	sort.SliceStable(descriptors, func(first, second int) bool {
		if descriptors[first].Order != descriptors[second].Order {
			return descriptors[first].Order < descriptors[second].Order
		}
		return descriptors[first].ID < descriptors[second].ID
	})
	return descriptors
}

func metadataBool(metadata map[string]any, key string) bool {
	value, ok := metadata[key]
	if !ok || value == nil {
		return false
	}
	typed, ok := value.(bool)
	return ok && typed
}

func metadataInt(metadata map[string]any, key string) int {
	value, ok := metadata[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func nonEmpty(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return strings.TrimSpace(fallback)
	}
	return value
}
