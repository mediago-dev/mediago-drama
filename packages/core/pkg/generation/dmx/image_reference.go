package dmx

import (
	"context"
	"fmt"
	"mime/multipart"
	"net/textproto"

	"github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation/internal/adapterutil"
)

func (provider *Provider) writeImageReferencePart(
	ctx context.Context,
	writer *multipart.Writer,
	reference string,
	index int,
) error {
	mimeType, data, err := provider.imageReferenceData(ctx, reference)
	if err != nil {
		return fmt.Errorf("reading reference image %d: %w", index+1, err)
	}

	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename="reference-%d%s"`, index+1, imageExtension(mimeType)))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	_, err = part.Write(data)
	return err
}

func (provider *Provider) imageReferenceData(ctx context.Context, reference string) (string, []byte, error) {
	return adapterutil.ReadImageReference(ctx, provider.client, reference, readHTTPError)
}

func decodeDataURI(value string) (string, []byte, error) {
	return adapterutil.DecodeImageDataURI(value)
}

func imageExtension(mimeType string) string {
	return adapterutil.ImageExtension(mimeType)
}
