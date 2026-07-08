package media

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	_ "image/jpeg"
	"image/png"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompressedImageDataURIValueDownscalesLargeImage(t *testing.T) {
	store := NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	source := encodeTestPNG(t, 1200, 600)
	asset, err := store.SaveReader(
		context.Background(),
		bytes.NewReader(source),
		"reference.png",
		"image/png",
		"",
	)
	if err != nil {
		t.Fatalf("saving source image: %v", err)
	}

	value, err := store.CompressedImageDataURIValue(asset, ImageCompressionOptions{
		MaxDimension: 512,
		JPEGQuality:  80,
		MinBytes:     1 << 30,
	})
	if err != nil {
		t.Fatalf("compressing image: %v", err)
	}

	mimeType, data := decodeTestDataURI(t, value)
	if mimeType != "image/jpeg" {
		t.Fatalf("mime type = %q, want image/jpeg", mimeType)
	}
	imageValue, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding compressed image: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("format = %q, want jpeg", format)
	}
	bounds := imageValue.Bounds()
	if bounds.Dx() != 512 || bounds.Dy() != 256 {
		t.Fatalf("compressed size = %dx%d, want 512x256", bounds.Dx(), bounds.Dy())
	}
}

func TestCompressedImageDataURIValueKeepsSmallImageOriginal(t *testing.T) {
	store := NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	source := encodeTestPNG(t, 64, 32)
	asset, err := store.SaveReader(
		context.Background(),
		bytes.NewReader(source),
		"reference.png",
		"image/png",
		"",
	)
	if err != nil {
		t.Fatalf("saving source image: %v", err)
	}

	value, err := store.CompressedImageDataURIValue(asset, ImageCompressionOptions{
		MaxDimension: 512,
		JPEGQuality:  80,
		MinBytes:     1 << 30,
	})
	if err != nil {
		t.Fatalf("compressing image: %v", err)
	}

	mimeType, data := decodeTestDataURI(t, value)
	if mimeType != "image/png" {
		t.Fatalf("mime type = %q, want image/png", mimeType)
	}
	if !bytes.Equal(data, source) {
		t.Fatal("small image should keep original bytes")
	}
}

func TestCompressedImageDataURIValueRejectsUnsupportedUndecodableImage(t *testing.T) {
	store := NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	asset, err := store.SaveReader(
		context.Background(),
		bytes.NewReader([]byte("not-avif-image-data")),
		"reference.avif",
		"image/avif",
		"",
	)
	if err != nil {
		t.Fatalf("saving source image: %v", err)
	}

	_, err = store.CompressedImageDataURIValue(asset, ImageCompressionOptions{
		MaxDimension: 512,
		JPEGQuality:  80,
		MinBytes:     1 << 30,
	})
	if err == nil {
		t.Fatal("CompressedImageDataURIValue() error = nil, want unsupported format error")
	}
	if !strings.Contains(err.Error(), `unsupported reference image format "image/avif"`) {
		t.Fatalf("error = %q, want unsupported avif format", err)
	}
}

func TestCompressedImageDataURIValueTranscodesUnsupportedDecodableImage(t *testing.T) {
	store := NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	source := encodeTestGIF(t, 64, 32)
	asset, err := store.SaveReader(
		context.Background(),
		bytes.NewReader(source),
		"reference.gif",
		"image/gif",
		"",
	)
	if err != nil {
		t.Fatalf("saving source image: %v", err)
	}

	value, err := store.CompressedImageDataURIValue(asset, ImageCompressionOptions{
		MaxDimension: 512,
		JPEGQuality:  80,
		MinBytes:     1 << 30,
	})
	if err != nil {
		t.Fatalf("compressing image: %v", err)
	}

	mimeType, data := decodeTestDataURI(t, value)
	if mimeType != "image/jpeg" {
		t.Fatalf("mime type = %q, want image/jpeg", mimeType)
	}
	_, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding transcoded image: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("format = %q, want jpeg", format)
	}
}

func encodeTestPNG(t *testing.T, width int, height int) []byte {
	t.Helper()

	source := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			source.SetRGBA(x, y, color.RGBA{
				R: uint8((x*31 + y*17) % 256),
				G: uint8((x*11 + y*23) % 256),
				B: uint8((x*7 + y*5) % 256),
				A: 255,
			})
		}
	}

	var output bytes.Buffer
	if err := png.Encode(&output, source); err != nil {
		t.Fatalf("encoding source image: %v", err)
	}
	return output.Bytes()
}

func encodeTestGIF(t *testing.T, width int, height int) []byte {
	t.Helper()

	palette := []color.Color{
		color.RGBA{R: 255, A: 255},
		color.RGBA{G: 255, A: 255},
		color.RGBA{B: 255, A: 255},
	}
	source := image.NewPaletted(image.Rect(0, 0, width, height), palette)
	for y := range height {
		for x := range width {
			source.SetColorIndex(x, y, uint8((x+y)%len(palette)))
		}
	}

	var output bytes.Buffer
	if err := gif.Encode(&output, source, nil); err != nil {
		t.Fatalf("encoding source image: %v", err)
	}
	return output.Bytes()
}

func decodeTestDataURI(t *testing.T, value string) (string, []byte) {
	t.Helper()

	metadata, encoded, ok := strings.Cut(value, ",")
	if !ok {
		t.Fatalf("value %q is not a data uri", value)
	}
	mimeType := strings.TrimPrefix(strings.TrimPrefix(metadata, "data:"), ";base64")
	mimeType, _, _ = strings.Cut(mimeType, ";")
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decoding data uri: %v", err)
	}
	return mimeType, data
}
