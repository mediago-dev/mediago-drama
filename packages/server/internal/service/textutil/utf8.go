package textutil

import (
	"bytes"
	"encoding/binary"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// DecodeTextBytes decodes common novel text encodings into normalized UTF-8.
func DecodeTextBytes(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	if bytes.HasPrefix(data, []byte{0xff, 0xfe}) {
		return normalizeText(decodeUTF16(data[2:], binary.LittleEndian))
	}
	if bytes.HasPrefix(data, []byte{0xfe, 0xff}) {
		return normalizeText(decodeUTF16(data[2:], binary.BigEndian))
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if utf8.Valid(data) {
		return normalizeText(string(data))
	}
	decoded, _, err := transform.Bytes(simplifiedchinese.GB18030.NewDecoder(), data)
	if err == nil && utf8.Valid(decoded) {
		return normalizeText(string(decoded))
	}
	return normalizeText(string(data))
}

// TruncateUTF8 truncates content to maxBytes without splitting a UTF-8 rune.
func TruncateUTF8(content string, maxBytes int) (string, int) {
	if maxBytes < 0 {
		maxBytes = 0
	}
	if len(content) <= maxBytes {
		return content, 0
	}
	cut := maxBytes
	for cut > 0 && !utf8.ValidString(content[:cut]) {
		cut--
	}
	return content[:cut], len(content) - cut
}

func decodeUTF16(data []byte, order binary.ByteOrder) string {
	if len(data)%2 == 1 {
		data = data[:len(data)-1]
	}
	units := make([]uint16, 0, len(data)/2)
	for index := 0; index < len(data); index += 2 {
		units = append(units, order.Uint16(data[index:index+2]))
	}
	return string(utf16.Decode(units))
}

func normalizeText(text string) string {
	text = strings.TrimPrefix(text, "\ufeff")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return text
}
