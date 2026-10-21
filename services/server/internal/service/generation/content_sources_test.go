package generation

import "testing"

func TestHistoricalContentSourcesDoNotRequireAuthorization(t *testing.T) {
	refs := normalizeContentSourceRefs([]ContentSourceRef{
		{PackageID: "legacy-only"},
		{PackageID: " legacy-pack ", ReleaseID: " release-1 "},
		{PackageID: "legacy-pack", ReleaseID: "release-1"},
	})
	if len(refs) != 1 || refs[0].PackageID != "legacy-pack" || refs[0].ReleaseID != "release-1" {
		t.Fatalf("historical provenance = %#v", refs)
	}
}
