package promptpack

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type protectedImporterStub struct {
	result ProtectedImport
	err    error
	calls  int
}

func (stub *protectedImporterStub) Import(
	_ context.Context,
	_ string,
	_ []byte,
) (ProtectedImport, error) {
	stub.calls++
	return stub.result, stub.err
}

func TestInstallDataDelegatesOnlyUnsupportedVersions(t *testing.T) {
	plainPath := writeTestMGPack(t)
	payload, err := os.ReadFile(plainPath)
	if err != nil {
		t.Fatal(err)
	}
	stub := &protectedImporterStub{result: ProtectedImport{
		PackageID: "com.example.test",
		ReleaseID: "release-1",
		Version:   "1.0.7",
		Payload:   payload,
	}}
	store := newTestService(t)
	store.SetProtectedImporter(stub)

	pack, err := store.InstallData(context.Background(), "protected.mgpack", []byte("MGPK\x02opaque"))
	if err != nil {
		t.Fatalf("InstallData(protected) error = %v", err)
	}
	if stub.calls != 1 {
		t.Fatalf("protected importer calls = %d, want 1", stub.calls)
	}
	if pack.ID != "com.example.test" || pack.ReleaseID != "release-1" || pack.Version != "1.0.7" {
		t.Fatalf("installed pack = %#v", pack)
	}

	_, err = store.InstallData(context.Background(), filepath.Base(plainPath), []byte("not-an-mgpack"))
	if !errors.Is(err, ErrInvalidPack) {
		t.Fatalf("InstallData(invalid) error = %v, want ErrInvalidPack", err)
	}
	if stub.calls != 1 {
		t.Fatalf("protected importer calls after invalid v1 = %d, want 1", stub.calls)
	}
}

func TestInstallDataRejectsUnprotectedPackWhenPolicyDisallowsIt(t *testing.T) {
	plainPath := writeTestMGPack(t)
	payload, err := os.ReadFile(plainPath)
	if err != nil {
		t.Fatal(err)
	}
	store := newTestService(t)
	store.SetUnprotectedImportAllowed(false)

	_, err = store.InstallData(context.Background(), filepath.Base(plainPath), payload)
	if !errors.Is(err, ErrUnprotectedPackImportDenied) {
		t.Fatalf("InstallData(v1) error = %v, want ErrUnprotectedPackImportDenied", err)
	}
	_, err = store.InstallPath(context.Background(), plainPath)
	if !errors.Is(err, ErrUnprotectedPackImportDenied) {
		t.Fatalf("InstallPath(v1) error = %v, want ErrUnprotectedPackImportDenied", err)
	}
}

func TestInstallDataReportsConfiguredProtectedImporterFailure(t *testing.T) {
	store := newTestService(t)
	store.SetProtectedImporterUnavailable(errors.New("runtime sha256 does not match"))

	_, err := store.InstallData(
		context.Background(),
		"protected.mgpack",
		[]byte("MGPK\x02opaque"),
	)
	if !errors.Is(err, ErrProtectedPackUnavailable) {
		t.Fatalf("InstallData(protected) error = %v, want ErrProtectedPackUnavailable", err)
	}
}
