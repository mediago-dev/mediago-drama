package capability

import (
	"testing"

	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
)

func TestListCapabilitiesComputesAvailability(t *testing.T) {
	service := NewService(corecapability.Default(), func(routeID string) bool {
		return routeID == "dmx.gpt-4.1-mini-text"
	})

	response := service.ListCapabilities()
	if len(response.Capabilities) != 4 {
		t.Fatalf("capabilities = %d, want 4", len(response.Capabilities))
	}

	text := findRecord(t, response.Capabilities, "text.generate")
	if !text.Available {
		t.Fatal("text.generate should be available when a related route is configured")
	}
	audio := findRecord(t, response.Capabilities, "audio.generate")
	if audio.Available {
		t.Fatal("audio.generate should be unavailable without a configured audio route")
	}
	image := findRecord(t, response.Capabilities, "image.generate")
	if image.Available {
		t.Fatal("image.generate should be unavailable without a configured image route")
	}
}

func findRecord(t *testing.T, records []dto.CapabilityRecord, id string) dto.CapabilityRecord {
	t.Helper()
	for _, record := range records {
		if record.ID == id {
			return record
		}
	}
	t.Fatalf("record %q not found", id)
	return dto.CapabilityRecord{}
}
