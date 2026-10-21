package generation

import (
	"sort"
	"strings"
)

// normalizeContentSourceRefs preserves complete historical source identities.
// Incomplete legacy identities do not block local generation.
func normalizeContentSourceRefs(refs []ContentSourceRef) []ContentSourceRef {
	unique := make(map[string]ContentSourceRef, len(refs))
	for _, ref := range refs {
		ref.PackageID = strings.TrimSpace(ref.PackageID)
		ref.ReleaseID = strings.TrimSpace(ref.ReleaseID)
		if ref.PackageID == "" || ref.ReleaseID == "" {
			continue
		}
		unique[ref.PackageID+"\x00"+ref.ReleaseID] = ref
	}
	keys := make([]string, 0, len(unique))
	for key := range unique {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]ContentSourceRef, 0, len(keys))
	for _, key := range keys {
		result = append(result, unique[key])
	}
	return result
}
