package generation

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestAuthorizeContentUseAllowsCommunityContent(t *testing.T) {
	workflow := &GenerationService{}
	status, err := workflow.authorizeContentUse(context.Background(), "call", nil)
	if err != nil || status != http.StatusOK {
		t.Fatalf("authorizeContentUse() = (%d, %v), want (200, nil)", status, err)
	}
}

func TestAuthorizeContentUseAllowsImportedContentWithoutRuntime(t *testing.T) {
	workflow := &GenerationService{}
	status, err := workflow.authorizeContentUse(context.Background(), "call", []ContentSourceRef{{
		PackageID: "pack-1",
		ReleaseID: "release-1",
	}})
	if status != http.StatusOK || err != nil {
		t.Fatalf("authorizeContentUse() = (%d, %v), want (200, nil)", status, err)
	}
}

func TestAuthorizeContentUseNormalizesAndDelegates(t *testing.T) {
	var received []ContentSourceRef
	workflow := &GenerationService{}
	workflow.SetContentUseAuthorizer(ContentUseAuthorizerFunc(
		func(_ context.Context, operation string, refs []ContentSourceRef) error {
			if operation != "call" {
				t.Fatalf("operation = %q, want call", operation)
			}
			received = refs
			return nil
		},
	))
	status, err := workflow.authorizeContentUse(context.Background(), "call", []ContentSourceRef{
		{PackageID: " pack-1 ", ReleaseID: "release-1"},
		{PackageID: "pack-1", ReleaseID: "release-1"},
	})
	if err != nil || status != http.StatusOK {
		t.Fatalf("authorizeContentUse() = (%d, %v), want success", status, err)
	}
	if len(received) != 1 || received[0].PackageID != "pack-1" {
		t.Fatalf("received = %#v, want one normalized source", received)
	}
}

func TestAuthorizeContentUseMapsDenial(t *testing.T) {
	workflow := &GenerationService{}
	wantReason := "当前账号没有有效的发布者席位，请重新导入并确认加入"
	workflow.SetContentUseAuthorizer(ContentUseAuthorizerFunc(
		func(context.Context, string, []ContentSourceRef) error {
			return &ContentUseDeniedError{Reason: wantReason, NextAction: "import"}
		},
	))
	status, err := workflow.authorizeContentUse(context.Background(), "call", []ContentSourceRef{{
		PackageID: "pack-1",
		ReleaseID: "release-1",
	}})
	if status != http.StatusForbidden || !errors.Is(err, ErrContentUseDenied) {
		t.Fatalf("authorizeContentUse() = (%d, %v), want denied", status, err)
	}
	if err.Error() != wantReason {
		t.Fatalf("authorizeContentUse() error = %q, want %q", err, wantReason)
	}
}
