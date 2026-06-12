package capability

import (
	corecapability "github.com/torchstellar-team/mediago-drama/packages/server/internal/capability"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/http/dto"
)

// Service reads the atomic capability registry and annotates route availability.
type Service struct {
	registry        corecapability.Registry
	routeConfigured func(routeID string) bool
}

// NewService creates a capability manifest service.
func NewService(registry corecapability.Registry, routeConfigured func(string) bool) *Service {
	return &Service{registry: registry, routeConfigured: routeConfigured}
}

// ListCapabilities returns every built-in capability with computed availability.
func (service *Service) ListCapabilities() dto.CapabilityManifestResponse {
	if service == nil || service.registry == nil {
		return dto.CapabilityManifestResponse{Capabilities: []dto.CapabilityRecord{}}
	}
	capabilities := service.registry.List()
	records := make([]dto.CapabilityRecord, 0, len(capabilities))
	for _, value := range capabilities {
		records = append(records, dto.CapabilityRecord{
			ID:            value.ID,
			Name:          value.Name,
			Description:   value.Description,
			Kind:          value.Kind,
			Category:      string(value.Category),
			Icon:          value.Icon,
			Surface:       value.Surface,
			Inputs:        ioKindsToStrings(value.Inputs),
			Outputs:       ioKindsToStrings(value.Outputs),
			RelatedRoutes: cloneStrings(value.RelatedRoutes),
			Status:        string(value.Status),
			Available:     service.capabilityAvailable(value),
		})
	}
	return dto.CapabilityManifestResponse{Capabilities: records}
}

func (service *Service) capabilityAvailable(value corecapability.AtomicCapability) bool {
	if value.Status == corecapability.StatusHidden {
		return false
	}
	if len(value.RelatedRoutes) == 0 {
		return true
	}
	if service.routeConfigured == nil {
		return false
	}
	for _, routeID := range value.RelatedRoutes {
		if service.routeConfigured(routeID) {
			return true
		}
	}
	return false
}

func ioKindsToStrings(values []corecapability.IOKind) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = string(value)
	}
	return result
}

func cloneStrings(values []string) []string {
	result := make([]string, len(values))
	copy(result, values)
	return result
}
