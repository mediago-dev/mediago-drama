package media

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif" // Register GIF decoder for image.Decode.
	"image/jpeg"
	_ "image/png" // Register PNG decoder for image.Decode.
	"math"
	"os"
	"strings"
)

const (
	defaultReferenceImageMaxDimension = 512
	defaultReferenceImageJPEGQuality  = 76
	defaultReferenceImageMinBytes     = 256 << 10
)

// ImageCompressionOptions controls request-only image compression.
type ImageCompressionOptions struct {
	MaxDimension int
	JPEGQuality  int
	MinBytes     int64
}

// DefaultReferenceImageCompressionOptions returns the generation reference defaults.
func DefaultReferenceImageCompressionOptions() ImageCompressionOptions {
	return ImageCompressionOptions{
		MaxDimension: defaultReferenceImageMaxDimension,
		JPEGQuality:  defaultReferenceImageJPEGQuality,
		MinBytes:     defaultReferenceImageMinBytes,
	}
}

// CompressedImageDataURIValue returns an image data URI optimized for provider requests.
func (store *MediaAssets) CompressedImageDataURIValue(
	asset MediaAsset,
	options ImageCompressionOptions,
) (string, error) {
	if store.initErr != nil {
		return "", store.initErr
	}
	data, err := os.ReadFile(asset.FilePath)
	if err != nil {
		return "", err
	}

	mimeType, compressed, ok, err := compressReferenceImage(data, asset.MIMEType, options)
	if err != nil {
		return dataURIValue(asset.MIMEType, data), nil
	}
	if !ok {
		return dataURIValue(asset.MIMEType, data), nil
	}

	return dataURIValue(mimeType, compressed), nil
}

func compressReferenceImage(
	data []byte,
	mimeType string,
	options ImageCompressionOptions,
) (string, []byte, bool, error) {
	options = normalizeImageCompressionOptions(options)
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", nil, false, err
	}

	sourceBounds := source.Bounds()
	sourceWidth := sourceBounds.Dx()
	sourceHeight := sourceBounds.Dy()
	if sourceWidth <= 0 || sourceHeight <= 0 {
		return "", nil, false, fmt.Errorf("image has invalid dimensions")
	}

	targetWidth, targetHeight, resized := scaledDimensions(
		sourceWidth,
		sourceHeight,
		options.MaxDimension,
	)
	shouldCompress := resized || int64(len(data)) > options.MinBytes
	if !shouldCompress {
		return "", nil, false, nil
	}

	canvas := flattenImage(source)
	if resized {
		canvas = resizeNearest(canvas, targetWidth, targetHeight)
	}

	var output bytes.Buffer
	if err := jpeg.Encode(&output, canvas, &jpeg.Options{Quality: options.JPEGQuality}); err != nil {
		return "", nil, false, err
	}
	compressed := output.Bytes()
	if !resized && len(compressed) >= len(data) {
		return "", nil, false, nil
	}

	return "image/jpeg", compressed, true, nil
}

func normalizeImageCompressionOptions(options ImageCompressionOptions) ImageCompressionOptions {
	if options.MaxDimension <= 0 {
		options.MaxDimension = defaultReferenceImageMaxDimension
	}
	if options.JPEGQuality <= 0 {
		options.JPEGQuality = defaultReferenceImageJPEGQuality
	}
	options.JPEGQuality = min(100, max(1, options.JPEGQuality))
	if options.MinBytes <= 0 {
		options.MinBytes = defaultReferenceImageMinBytes
	}
	return options
}

func scaledDimensions(width int, height int, maxDimension int) (int, int, bool) {
	longSide := max(width, height)
	if maxDimension <= 0 || longSide <= maxDimension {
		return width, height, false
	}

	scale := float64(maxDimension) / float64(longSide)
	targetWidth := max(1, int(math.Round(float64(width)*scale)))
	targetHeight := max(1, int(math.Round(float64(height)*scale)))
	return targetWidth, targetHeight, true
}

func flattenImage(source image.Image) *image.RGBA {
	sourceBounds := source.Bounds()
	canvas := image.NewRGBA(image.Rect(0, 0, sourceBounds.Dx(), sourceBounds.Dy()))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(canvas, canvas.Bounds(), source, sourceBounds.Min, draw.Over)
	return canvas
}

func resizeNearest(source *image.RGBA, width int, height int) *image.RGBA {
	sourceBounds := source.Bounds()
	sourceWidth := sourceBounds.Dx()
	sourceHeight := sourceBounds.Dy()
	target := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		sourceY := sourceBounds.Min.Y + y*sourceHeight/height
		for x := range width {
			sourceX := sourceBounds.Min.X + x*sourceWidth/width
			target.SetRGBA(x, y, source.RGBAAt(sourceX, sourceY))
		}
	}
	return target
}

func dataURIValue(mimeType string, data []byte) string {
	mimeType = strings.TrimSpace(strings.Split(mimeType, ";")[0])
	if mimeType == "" {
		mimeType = "image/png"
	}

	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
}
