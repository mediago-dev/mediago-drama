package document

import "testing"

func TestSelectionFromDocumentContentFindsUTF16Range(t *testing.T) {
	selection, err := SelectionFromDocumentContent("# Title\n\nhello 世界\n", "世界")
	if err != nil {
		t.Fatalf("SelectionFromDocumentContent returned error: %v", err)
	}
	if selection == nil {
		t.Fatal("selection is nil, want a range")
	}
	if selection.Quote != "世界" || selection.Range.Start != 6 || selection.Range.End != 8 {
		t.Fatalf("selection = %#v, want quote range for 世界", selection)
	}
}

func TestSelectionFromDocumentContentReturnsNilForMissingQuote(t *testing.T) {
	selection, err := SelectionFromDocumentContent("# Title\n\nhello\n", "missing")
	if err != nil {
		t.Fatalf("SelectionFromDocumentContent returned error: %v", err)
	}
	if selection != nil {
		t.Fatalf("selection = %#v, want nil", selection)
	}
}
