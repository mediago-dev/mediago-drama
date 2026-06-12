package documents

// FirstNonEmpty returns the first non-empty value.
func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
