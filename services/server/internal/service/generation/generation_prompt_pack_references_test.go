package generation

import (
	"context"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
)

type promptReferenceSourceStub struct {
	entries map[string]promptlibrary.PromptEntry
}

func (stub promptReferenceSourceStub) Get(_ context.Context, id string) (promptlibrary.PromptEntry, error) {
	return stub.entries[id], nil
}

func (stub promptReferenceSourceStub) List(context.Context, promptlibrary.Filter) ([]promptlibrary.PromptEntry, error) {
	return nil, nil
}

func TestResolveGenerationPromptReferencesUsesServerSideBodies(t *testing.T) {
	workflow := NewGenerationService(nil, nil, nil)
	workflow.SetStylePromptLibrary(promptReferenceSourceStub{entries: map[string]promptlibrary.PromptEntry{
		"protected-style": {
			ID: "protected-style", Name: "受保护风格", Prompt: "private cinematic prompt",
			SourcePackageID: "package.cinematic", SourceReleaseID: "release-1",
		},
		"protected-optimize": {
			ID: "protected-optimize", Name: "受保护优化", Prompt: "private optimization prompt",
		},
	}})
	payload := generationMessageRequest{
		PromptSupplements:  []GenerationPromptSupplementRequest{{ReferenceID: "protected-style"}},
		PromptOptimization: &GenerationPromptOptimizationRequest{ReferenceID: "protected-optimize"},
	}

	status, err := workflow.resolveGenerationPromptReferences(context.Background(), &payload)
	if err != nil || status != 200 {
		t.Fatalf("resolveGenerationPromptReferences() status = %d error = %v", status, err)
	}
	if got := payload.PromptSupplements[0]; got.ReferencePrompt != "private cinematic prompt" || got.ReferenceName != "受保护风格" {
		t.Fatalf("supplement = %#v, want server-side body and name", got)
	}
	if got := payload.PromptOptimization; got.ReferencePrompt != "private optimization prompt" || got.ReferenceName != "受保护优化" {
		t.Fatalf("optimization = %#v, want server-side body and name", got)
	}
	if len(payload.SourceRefs) != 1 || payload.SourceRefs[0].PackageID != "package.cinematic" || payload.SourceRefs[0].ReleaseID != "release-1" {
		t.Fatalf("source refs = %#v, want imported prompt provenance", payload.SourceRefs)
	}
}

func TestPrepareTextPromptOptimizationResolvesProtectedReference(t *testing.T) {
	workflow := NewGenerationService(nil, nil, nil)
	workflow.SetStylePromptLibrary(promptReferenceSourceStub{entries: map[string]promptlibrary.PromptEntry{
		"protected-optimize": {
			ID: "protected-optimize", Name: "受保护优化", Prompt: "private optimization prompt",
		},
	}})
	payload := GenerationMessageRequest{
		Prompt: "原始视频提示词",
		PromptOptimization: &GenerationPromptOptimizationRequest{
			ReferenceID: "protected-optimize",
		},
	}

	status, err := workflow.prepareTextPromptOptimization(context.Background(), &payload)
	if err != nil || status != 200 {
		t.Fatalf("prepareTextPromptOptimization() status = %d error = %v", status, err)
	}
	if payload.PromptOptimization != nil {
		t.Fatalf("prompt optimization = %#v, want consumed server-side", payload.PromptOptimization)
	}
	if !strings.Contains(payload.Prompt, "private optimization prompt") || !strings.Contains(payload.Prompt, "原始视频提示词") {
		t.Fatalf("prompt = %q, want protected reference and original prompt", payload.Prompt)
	}
}
