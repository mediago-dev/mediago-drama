package prompt

import (
	"context"
	"log/slog"
	"sort"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
)

// SectionDescriptor describes one system prompt section and its UI metadata.
type SectionDescriptor struct {
	ID          string
	Name        string
	Description string
	Order       int
	Editable    bool
}

var fallbackSections = []SectionDescriptor{
	{
		ID:          "AGENTS",
		Name:        "AGENTS.md",
		Description: "Agent 操作指令：默认身份边界、写作策略、工具调用策略和 Skills 装载策略。",
		Order:       0,
		Editable:    true,
	},
	{
		ID:          "TOOLS",
		Name:        "TOOLS.md",
		Description: "跨工具编排策略：项目级审查、局部编辑触发和连续编辑复用。",
		Order:       1,
		Editable:    true,
	},
}

// SectionDescriptors returns every registered prompt section in injection order.
func SectionDescriptors() []SectionDescriptor {
	templateMap, err := currentPromptTemplateStore().Load(context.Background())
	if err != nil {
		slog.Warn("prompt instruction registry unavailable", "error", err)
		return sortedSectionDescriptors(fallbackSections)
	}
	descriptors := descriptorsFromTemplates(prompttemplates.OrderedTemplates(templateMap))
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

func descriptorsFromTemplates(templates []prompttemplates.PromptTemplate) []SectionDescriptor {
	descriptors := make([]SectionDescriptor, 0, len(templates))
	for _, template := range templates {
		descriptor := SectionDescriptor{
			ID:          template.ID,
			Name:        template.Name,
			Description: template.Description,
			Order:       template.Order,
			Editable:    true,
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
