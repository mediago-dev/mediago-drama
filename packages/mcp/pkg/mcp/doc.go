// Package mcp defines the MediaGo Drama MCP wire records, tool names, and transport helpers.
//
// Host applications use these structs as the stable JSON contract for document,
// comment, project, document lifecycle, and agent-event tools. Server assembly lives in
// pkg/server; this package intentionally stays storage-agnostic and transport-neutral.
//
// Timestamp fields remain strings for JSON compatibility and are expected to use
// RFC3339Nano UTC values; use FormatTimestamp and ParseTimestamp when producing
// or consuming those fields from Go.
package mcp
