package generation

import "testing"

func TestRemovedProvidersHaveNoCatalogOrCredentialEntries(t *testing.T) {
	removed := map[string]bool{"dmx": true, "mediago": true, "xiaoyunque": true, "pippit": true}
	catalog := Catalog()
	usedVersions := map[string]bool{}
	for _, route := range catalog.Routes {
		if removed[route.Provider] {
			t.Errorf("removed provider has an executable route: %s", route.ID)
		}
		usedVersions[route.VersionID] = true
	}
	for _, version := range catalog.Versions {
		if !usedVersions[version.ID] {
			t.Errorf("version %q has no remaining route", version.ID)
		}
	}
	for id := range removed {
		if ProviderTypeOf(id) != "" {
			t.Errorf("provider %q is still registered", id)
		}
		if _, ok := FindCredentialSpec(id); ok {
			t.Errorf("provider %q still accepts credentials", id)
		}
	}
	for _, id := range []string{RouteDMXSeedream5Lite, RouteMediagoGPT55Text, RouteXiaoyunqueSeedance20Fast} {
		if _, ok := FindRoute(id); ok {
			t.Errorf("removed route %q can be resolved", id)
		}
	}
}
