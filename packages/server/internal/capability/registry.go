package capability

import "sync"

type capabilityIndex struct {
	capabilities []AtomicCapability
	byID         map[string]AtomicCapability
}

type defaultRegistry struct{}

type registryCache struct {
	once  sync.Once
	value capabilityIndex
}

var defaultRegistryCache registryCache

// Default returns the process-wide built-in registry. Reads return deep copies.
func Default() Registry {
	return defaultRegistry{}
}

func (defaultRegistry) List() []AtomicCapability {
	return cloneCapabilities(defaultCapabilityIndex().capabilities)
}

func (defaultRegistry) Get(id string) (AtomicCapability, bool) {
	value, ok := defaultCapabilityIndex().byID[id]
	if !ok {
		return AtomicCapability{}, false
	}
	return cloneCapability(value), true
}

func (defaultRegistry) Filter(filter Filter) []AtomicCapability {
	result := []AtomicCapability{}
	for _, value := range defaultCapabilityIndex().capabilities {
		if filter.Category != "" && value.Category != filter.Category {
			continue
		}
		if filter.Status != "" && value.Status != filter.Status {
			continue
		}
		if filter.Kind != "" && value.Kind != filter.Kind {
			continue
		}
		result = append(result, cloneCapability(value))
	}
	return result
}

func defaultCapabilityIndex() capabilityIndex {
	return defaultRegistryCache.Get(func() capabilityIndex {
		values := make([]AtomicCapability, 0, len(capabilitySpecs))
		byID := make(map[string]AtomicCapability, len(capabilitySpecs))
		for _, spec := range capabilitySpecs {
			value := cloneCapability(spec.Capability)
			if spec.RelatedRoutes != nil {
				value.RelatedRoutes = spec.RelatedRoutes()
			}
			values = append(values, value)
			byID[value.ID] = cloneCapability(value)
		}
		return capabilityIndex{capabilities: cloneCapabilities(values), byID: byID}
	})
}

func (cache *registryCache) Get(build func() capabilityIndex) capabilityIndex {
	cache.once.Do(func() {
		cache.value = build()
	})
	return cache.value
}
