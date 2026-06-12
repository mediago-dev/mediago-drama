package capability

import (
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestDefaultRegistryReturnsIsolatedCopies(t *testing.T) {
	registry := Default()
	capabilities := registry.List()
	if len(capabilities) == 0 {
		t.Fatal("registry has no capabilities")
	}

	id := capabilities[0].ID
	input := capabilities[0].Inputs[0]
	output := capabilities[0].Outputs[0]
	route := capabilities[0].RelatedRoutes[0]
	capabilities[0].Inputs[0] = "mutated"
	capabilities[0].Outputs[0] = "mutated"
	capabilities[0].RelatedRoutes[0] = "mutated"

	next, ok := registry.Get(id)
	if !ok {
		t.Fatalf("Get(%q) missing", id)
	}
	if next.Inputs[0] != input || next.Outputs[0] != output || next.RelatedRoutes[0] != route {
		t.Fatalf("registry returned mutated capability: %#v", next)
	}
}

func TestDefaultRegistryGetAndFilter(t *testing.T) {
	tests := []struct {
		name   string
		filter Filter
		wantID string
	}{
		{
			name:   "generation image",
			filter: Filter{Category: CategoryGeneration, Kind: string(coregeneration.KindImage)},
			wantID: "image.generate",
		},
		{
			name:   "processing available",
			filter: Filter{Category: CategoryProcessing, Status: StatusAvailable},
			wantID: "",
		},
	}

	registry := Default()
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := registry.Filter(test.filter)
			if test.wantID == "" {
				if len(values) != 0 {
					t.Fatalf("Filter(%#v) = %#v, want none", test.filter, values)
				}
				return
			}
			if len(values) == 0 {
				t.Fatalf("Filter(%#v) returned no capabilities", test.filter)
			}
			found := false
			for _, value := range values {
				if value.ID == test.wantID {
					found = true
				}
			}
			if !found {
				t.Fatalf("Filter(%#v) did not include %q: %#v", test.filter, test.wantID, values)
			}
		})
	}

	value, ok := registry.Get("text.generate")
	if !ok {
		t.Fatal("Get(text.generate) missing")
	}
	if value.Kind != string(coregeneration.KindText) {
		t.Fatalf("text.generate kind = %q", value.Kind)
	}

	for _, id := range []string{
		"novel.understand",
		"video.understand",
		"audio.transcribe",
		"novel.chunk",
		"video.chunk",
	} {
		if _, ok := registry.Get(id); ok {
			t.Fatalf("%s should not be registered", id)
		}
	}
}

func TestDefaultRegistryRelatedRoutesExist(t *testing.T) {
	for _, value := range Default().List() {
		for _, routeID := range value.RelatedRoutes {
			if _, ok := coregeneration.FindRoute(routeID); !ok {
				t.Fatalf("capability %q references unknown route %q", value.ID, routeID)
			}
		}
	}
}
