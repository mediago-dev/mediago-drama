package textutil

import (
	"strings"
	"testing"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func TestDecodeTextBytesPreservesUTF8(t *testing.T) {
	source := "\ufeff第一章 风起\r\n\r\n石昊来到大荒。"

	got := DecodeTextBytes([]byte(source))
	if got != "第一章 风起\n\n石昊来到大荒。" {
		t.Fatalf("DecodeTextBytes() = %q", got)
	}
}

func TestDecodeTextBytesDecodesGB18030(t *testing.T) {
	source := "第一章 大荒\n\n石昊在村中醒来。柳神沉默。"
	encoded, err := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(source))
	if err != nil {
		t.Fatalf("GB18030 encode test fixture error = %v", err)
	}

	got := DecodeTextBytes(encoded)
	if got != source {
		t.Fatalf("DecodeTextBytes() = %q, want %q", got, source)
	}
	if strings.Contains(got, "\ufffd") {
		t.Fatalf("DecodeTextBytes() produced replacement rune: %q", got)
	}
}

func TestTruncateUTF8(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		maxBytes    int
		wantContent string
		wantOmitted int
	}{
		{name: "within limit", content: "1234", maxBytes: 4, wantContent: "1234", wantOmitted: 0},
		{name: "negative limit", content: "1234", maxBytes: -1, wantContent: "", wantOmitted: 4},
		{name: "ascii", content: "123456", maxBytes: 4, wantContent: "1234", wantOmitted: 2},
		{name: "utf8 boundary", content: "你好世界", maxBytes: 7, wantContent: "你好", wantOmitted: 6},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gotContent, gotOmitted := TruncateUTF8(test.content, test.maxBytes)
			if gotContent != test.wantContent || gotOmitted != test.wantOmitted {
				t.Fatalf("TruncateUTF8() = %q, %d; want %q, %d", gotContent, gotOmitted, test.wantContent, test.wantOmitted)
			}
			if strings.Contains(gotContent, "\ufffd") {
				t.Fatalf("TruncateUTF8() produced replacement rune: %q", gotContent)
			}
		})
	}
}
