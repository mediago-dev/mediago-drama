package documents

import (
	"fmt"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	"sort"
	"strings"
)

// DocumentPatchEditPatch is one text patch in a document patch edit.
type DocumentPatchEditPatch struct {
	Op          string
	Range       mediamcp.DocumentTextRange
	Replacement string
}

// ApplyDocumentPatchEditContent applies replace_range patches against the original content coordinates.
func ApplyDocumentPatchEditContent(content string, patches []DocumentPatchEditPatch) (string, error) {
	if len(patches) == 0 {
		return "", fmt.Errorf("patches is required")
	}
	ordered := append([]DocumentPatchEditPatch(nil), patches...)
	sort.SliceStable(ordered, func(i int, j int) bool {
		return ordered[i].Range.Start > ordered[j].Range.Start
	})
	next := content
	previousStart := UTF16Length(content)
	for index, patch := range ordered {
		if strings.TrimSpace(patch.Op) != "replace_range" {
			return "", fmt.Errorf("patch %d uses unsupported op %q", index+1, patch.Op)
		}
		if patch.Range.Start < 0 || patch.Range.End < patch.Range.Start {
			return "", fmt.Errorf("patch %d has invalid range %d..%d", index+1, patch.Range.Start, patch.Range.End)
		}
		if patch.Range.End > previousStart {
			return "", fmt.Errorf("patch %d overlaps a later patch", index+1)
		}
		start, end, ok := UTF16RangeToByteRange(next, patch.Range)
		if !ok {
			return "", fmt.Errorf("patch %d range %d..%d is outside document content", index+1, patch.Range.Start, patch.Range.End)
		}
		next = next[:start] + patch.Replacement + next[end:]
		previousStart = patch.Range.Start
	}
	return next, nil
}
