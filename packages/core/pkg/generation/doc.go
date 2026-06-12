// Package generation defines provider-neutral contracts for MediaGo Drama media generation.
//
// The package exposes a versioned model catalog, route resolution helpers, request and
// response structs, and provider interfaces shared by HTTP services and generation
// adapters. Callers should resolve a ModelRoute first, validate route-specific
// parameters, then pass a Request to a concrete Provider implementation.
package generation
