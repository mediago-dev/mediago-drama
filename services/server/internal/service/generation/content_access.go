package generation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

var (
	// ErrContentUseDenied reports a definitive online rights denial.
	ErrContentUseDenied = errors.New("content use is not authorized")
	// ErrContentUseUnavailable reports that online rights could not be checked.
	ErrContentUseUnavailable = errors.New("content authorization is unavailable")
)

// ContentUseAuthorizer checks formal content immediately before a protected operation.
type ContentUseAuthorizer interface {
	AuthorizeContentUse(context.Context, string, []ContentSourceRef) error
}

// ContentUseAuthorizerFunc adapts a function to ContentUseAuthorizer.
type ContentUseAuthorizerFunc func(context.Context, string, []ContentSourceRef) error

// AuthorizeContentUse implements ContentUseAuthorizer.
func (authorize ContentUseAuthorizerFunc) AuthorizeContentUse(ctx context.Context, operation string, refs []ContentSourceRef) error {
	return authorize(ctx, operation, refs)
}

// ContentUseDeniedError carries a user-facing reason and conversion action.
type ContentUseDeniedError struct {
	Reason     string
	NextAction string
}

// Error implements error.
func (err *ContentUseDeniedError) Error() string {
	message := strings.TrimSpace(err.Reason)
	if message == "" {
		message = ErrContentUseDenied.Error()
	}
	return message
}

// Unwrap supports errors.Is with ErrContentUseDenied.
func (err *ContentUseDeniedError) Unwrap() error { return ErrContentUseDenied }

func (workflow *GenerationService) authorizeContentUse(ctx context.Context, operation string, refs []ContentSourceRef) (int, error) {
	normalized, err := normalizeContentSourceRefs(refs)
	if err != nil {
		return http.StatusForbidden, err
	}
	if len(normalized) == 0 {
		return http.StatusOK, nil
	}
	if workflow == nil || workflow.contentUseAuthorizer == nil {
		// A successful protected import is the current MVP trust boundary. The
		// optional online authorizer may be installed by a future commercial
		// runtime, but its absence must not make imported content unusable.
		return http.StatusOK, nil
	}
	if err := workflow.contentUseAuthorizer.AuthorizeContentUse(ctx, operation, normalized); err != nil {
		if errors.Is(err, ErrContentUseDenied) {
			return http.StatusForbidden, err
		}
		return http.StatusServiceUnavailable, fmt.Errorf("%w: %v", ErrContentUseUnavailable, err)
	}
	return http.StatusOK, nil
}

func normalizeContentSourceRefs(refs []ContentSourceRef) ([]ContentSourceRef, error) {
	unique := make(map[string]ContentSourceRef, len(refs))
	for _, ref := range refs {
		ref.PackageID = strings.TrimSpace(ref.PackageID)
		ref.ReleaseID = strings.TrimSpace(ref.ReleaseID)
		if ref.PackageID == "" && ref.ReleaseID == "" {
			continue
		}
		if ref.PackageID == "" || ref.ReleaseID == "" {
			return nil, &ContentUseDeniedError{Reason: "content source provenance is incomplete"}
		}
		unique[ref.PackageID+"\x00"+ref.ReleaseID] = ref
	}
	keys := make([]string, 0, len(unique))
	for key := range unique {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]ContentSourceRef, 0, len(keys))
	for _, key := range keys {
		result = append(result, unique[key])
	}
	return result, nil
}
