package generation

func version(
	id string,
	familyID string,
	label string,
	kind Kind,
	canonicalModel string,
	async bool,
	supportsReferenceURLs bool,
) ModelVersion {
	return ModelVersion{
		ID:             id,
		FamilyID:       familyID,
		Label:          label,
		Kind:           kind,
		CanonicalModel: canonicalModel,
		Capabilities: Capabilities{
			Async:                 async,
			SupportsReferenceURLs: supportsReferenceURLs,
		},
	}
}

func dmxRoute(
	id string,
	familyID string,
	versionID string,
	label string,
	model string,
	adapter string,
	docURL string,
	params []ParamSpec,
	async bool,
	supportsReferenceURLs bool,
	legacyModelID string,
) ModelRoute {
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kindForFamily(familyID),
		Provider:              ProviderDMX,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderDMX},
		Params:                params,
		LegacyModelID:         legacyModelID,
	}
}

func openRouterRoute(
	id string,
	familyID string,
	versionID string,
	kind Kind,
	label string,
	model string,
	adapter string,
	docURL string,
	params []ParamSpec,
	async bool,
	supportsReferenceURLs bool,
) ModelRoute {
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              ProviderOpenRouter,
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              []string{ProviderOpenRouter},
		Params:                params,
	}
}

func officialRoute(
	id string,
	familyID string,
	versionID string,
	kind Kind,
	label string,
	model string,
	adapter string,
	docURL string,
	authKeys []string,
	params []ParamSpec,
	async bool,
	supportsReferenceURLs bool,
) ModelRoute {
	return ModelRoute{
		ID:                    id,
		FamilyID:              familyID,
		VersionID:             versionID,
		Label:                 label,
		Kind:                  kind,
		Provider:              routeProviderFromAuthKeys(authKeys),
		Model:                 model,
		Adapter:               adapter,
		DocURL:                docURL,
		Async:                 async,
		SupportsReferenceURLs: supportsReferenceURLs,
		Status:                RouteStatusAvailable,
		AuthKeys:              authKeys,
		Params:                params,
	}
}

func routeProviderFromAuthKeys(authKeys []string) string {
	if len(authKeys) == 0 {
		return ""
	}
	return authKeys[0]
}

func kindForFamily(familyID string) Kind {
	switch familyID {
	case FamilyText:
		return KindText
	case FamilySeedream, FamilyGPTImage, FamilyNanoBanana:
		return KindImage
	case FamilySeedance:
		return KindVideo
	default:
		return ""
	}
}
