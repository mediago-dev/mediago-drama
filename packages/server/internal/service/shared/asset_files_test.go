package shared

import "testing"

func TestKindFromMIMETypeMapsAudio(t *testing.T) {
	if got := KindFromMIMEType("audio/mpeg; codecs=mp3"); got != AssetKindAudio {
		t.Fatalf("KindFromMIMEType(audio/mpeg) = %q, want %q", got, AssetKindAudio)
	}
}

func TestExtensionForMIMETypeMapsCommonAudioTypes(t *testing.T) {
	tests := []struct {
		mimeType string
		want     string
	}{
		{mimeType: "audio/mpeg", want: ".mp3"},
		{mimeType: "audio/mp4", want: ".m4a"},
		{mimeType: "audio/wav", want: ".wav"},
		{mimeType: "audio/webm", want: ".webm"},
	}

	for _, test := range tests {
		t.Run(test.mimeType, func(t *testing.T) {
			if got := ExtensionForMIMEType(test.mimeType); got != test.want {
				t.Fatalf("ExtensionForMIMEType(%q) = %q, want %q", test.mimeType, got, test.want)
			}
		})
	}
}
