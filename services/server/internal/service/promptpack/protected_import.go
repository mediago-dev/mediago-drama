package promptpack

import "context"

// ProtectedImport contains a verified release identity and its importable v1 payload.
type ProtectedImport struct {
	PackageID string
	ReleaseID string
	Version   string
	Payload   []byte
}

// ProtectedImporter imports a protected .mgpack without exposing its private
// authorization or cryptographic implementation to the open-source service.
type ProtectedImporter interface {
	Import(ctx context.Context, fileName string, data []byte) (ProtectedImport, error)
}

// SetProtectedImporter installs the optional protected-pack import boundary.
// It must be called while wiring the service, before requests are served.
func (store *Service) SetProtectedImporter(importer ProtectedImporter) {
	store.protectedImporter = importer
	store.protectedImportErr = nil
}

// SetProtectedImporterUnavailable records why a configured protected importer
// could not be initialized, so v2 imports report an unavailable Runtime rather
// than claiming that the package version is unsupported.
func (store *Service) SetProtectedImporterUnavailable(err error) {
	store.protectedImporter = nil
	store.protectedImportErr = err
}

// SetUnprotectedImportAllowed controls whether v1 files and local pack paths
// can be installed without going through the protected-pack importer.
func (store *Service) SetUnprotectedImportAllowed(allowed bool) {
	store.allowUnprotected = allowed
}
