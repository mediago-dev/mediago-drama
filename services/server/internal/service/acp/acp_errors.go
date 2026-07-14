package acp

import (
	"errors"

	acpsdk "github.com/coder/acp-go-sdk"
)

const acpAuthenticationRequiredCode = -32000

// IsAuthenticationRequiredError reports whether err is ACP's typed authentication-required error.
func IsAuthenticationRequiredError(err error) bool {
	var requestErr *acpsdk.RequestError
	return errors.As(err, &requestErr) && requestErr != nil && requestErr.Code == acpAuthenticationRequiredCode
}
