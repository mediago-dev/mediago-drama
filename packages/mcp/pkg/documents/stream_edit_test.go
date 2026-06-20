package documents

import "testing"

func TestNormalizeStreamDocumentEditInput(t *testing.T) {
	parent := " parent "
	input := NormalizeStreamDocumentEditInput(StreamDocumentEditInput{
		StreamID:         " stream ",
		DocumentID:       " doc ",
		Mode:             " append ",
		AnchorText:       " anchor ",
		Title:            " title ",
		Category:         " reference ",
		ParentDocumentID: &parent,
		Summary:          " summary ",
	})

	if input.StreamID != "stream" ||
		input.DocumentID != "doc" ||
		input.Mode != "append" ||
		input.AnchorText != "anchor" ||
		input.Title != "title" ||
		input.Category != "reference" ||
		input.ParentDocumentID == nil ||
		*input.ParentDocumentID != "parent" ||
		input.Summary != "summary" {
		t.Fatalf("normalized input = %#v", input)
	}
}

func TestValidateStreamDocumentEditInput(t *testing.T) {
	if err := ValidateStreamDocumentEditInput(StreamDocumentEditInput{}); err == nil {
		t.Fatal("ValidateStreamDocumentEditInput returned nil, want mode error")
	}
	if err := ValidateStreamDocumentEditInput(StreamDocumentEditInput{Mode: "append"}); err == nil {
		t.Fatal("ValidateStreamDocumentEditInput returned nil, want chunk error")
	}
	if err := ValidateStreamDocumentEditInput(StreamDocumentEditInput{Mode: "append", Finalize: true}); err != nil {
		t.Fatalf("ValidateStreamDocumentEditInput returned error: %v", err)
	}
}

func TestStreamEditEventMode(t *testing.T) {
	tests := []struct {
		mode string
		want string
	}{
		{mode: "create", want: "replace"},
		{mode: "replace_block", want: "replace"},
		{mode: "replace_document", want: "replace"},
		{mode: "append", want: "append"},
	}

	for _, test := range tests {
		t.Run(test.mode, func(t *testing.T) {
			if got := StreamEditEventMode(test.mode); got != test.want {
				t.Fatalf("StreamEditEventMode(%q) = %q, want %q", test.mode, got, test.want)
			}
		})
	}
}
