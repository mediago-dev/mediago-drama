package model

import "testing"

func TestNormalizeDocumentCategoryValueMapsLegacySourceMaterial(t *testing.T) {
	if got := NormalizeDocumentCategoryValue(" source-material "); got != ReferenceDocumentCategory {
		t.Fatalf("NormalizeDocumentCategoryValue returned %q, want %q", got, ReferenceDocumentCategory)
	}
	if err := ValidateDocumentCategory("source-material"); err != nil {
		t.Fatalf("ValidateDocumentCategory rejected legacy category: %v", err)
	}
}
