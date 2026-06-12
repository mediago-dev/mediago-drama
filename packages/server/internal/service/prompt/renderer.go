package prompt

import (
	"bytes"
	"fmt"
	"strings"
	"sync"
	"text/template"

	configassets "github.com/torchstellar-team/mediago-drama/packages/server/configs"
)

var parsedTemplates sync.Map // map[string]*template.Template

func loadParsedTemplate(id string) (*template.Template, error) {
	if cached, ok := parsedTemplates.Load(id); ok {
		return cached.(*template.Template), nil
	}

	raw, err := configassets.ReadPromptTemplate(id + ".md")
	if err != nil {
		return nil, fmt.Errorf("read prompt template %s: %w", id, err)
	}
	tmpl, err := template.New(id).Funcs(promptStaticFuncs).Parse(string(raw))
	if err != nil {
		return nil, fmt.Errorf("parse prompt template %s: %w", id, err)
	}
	actual, _ := parsedTemplates.LoadOrStore(id, tmpl)
	return actual.(*template.Template), nil
}

func renderSection(id string, data any) (string, error) {
	base, err := loadParsedTemplate(id)
	if err != nil {
		return "", err
	}
	cloned, err := base.Clone()
	if err != nil {
		return "", fmt.Errorf("clone prompt template %s: %w", id, err)
	}
	cloned.Funcs(promptDynamicFuncs(id))

	var buffer bytes.Buffer
	if err := cloned.Execute(&buffer, data); err != nil {
		return "", fmt.Errorf("execute prompt template %s: %w", id, err)
	}
	return strings.TrimSpace(buffer.String()), nil
}

// InvalidateTemplateCache drops one cached parsed template by ID.
func InvalidateTemplateCache(id string) {
	parsedTemplates.Delete(id)
}
