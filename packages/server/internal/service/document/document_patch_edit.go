package document

import (
	docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
)

// ApplyDocumentPatchEditContent applies replace_range patches against the original content coordinates.
func ApplyDocumentPatchEditContent(content string, patches []DocumentPatchEditPatchInput) (string, error) {
	docPatches := make([]docs.DocumentPatchEditPatch, 0, len(patches))
	for _, patch := range patches {
		docPatches = append(docPatches, docs.DocumentPatchEditPatch{
			Op:          patch.Op,
			Range:       patch.Range,
			Replacement: patch.Replacement,
		})
	}
	return docs.ApplyDocumentPatchEditContent(content, docPatches)
}
