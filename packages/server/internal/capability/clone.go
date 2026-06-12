package capability

func cloneCapability(value AtomicCapability) AtomicCapability {
	value.Inputs = cloneIOSlice(value.Inputs)
	value.Outputs = cloneIOSlice(value.Outputs)
	value.RelatedRoutes = cloneStrings(value.RelatedRoutes)
	return value
}

func cloneCapabilities(values []AtomicCapability) []AtomicCapability {
	result := make([]AtomicCapability, len(values))
	for index, value := range values {
		result[index] = cloneCapability(value)
	}
	return result
}

func cloneIOSlice(values []IOKind) []IOKind {
	result := make([]IOKind, len(values))
	copy(result, values)
	return result
}

func cloneStrings(values []string) []string {
	result := make([]string, len(values))
	copy(result, values)
	return result
}
