package runtime

import (
	"context"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestRemovedRoutesFailBeforeResolvingCredentials(t *testing.T) {
	credentialCalls := 0
	provider, err := NewProvider(Config{Credentials: CredentialResolverFunc(func(context.Context, string) (string, error) {
		credentialCalls++
		return "old-key", nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"dmx.seedream-5-lite", "mediago.gpt-5.5-text", "xiaoyunque.seedance-2.0-fast"} {
		if _, err := provider.Generate(context.Background(), generation.Request{RouteID: id, Prompt: "test"}); err == nil {
			t.Errorf("removed route %q was accepted", id)
		}
	}
	if _, err := provider.Get(context.Background(), "legacy-unprefixed-task"); err == nil {
		t.Fatal("legacy task unexpectedly fell back to a removed provider")
	}
	if credentialCalls != 0 {
		t.Fatalf("removed routes resolved credentials %d times", credentialCalls)
	}
}
