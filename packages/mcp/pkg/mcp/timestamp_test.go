package mcp

import (
	"testing"
	"time"
)

func TestFormatTimestampUsesUTC(t *testing.T) {
	local := time.Date(2026, 5, 30, 20, 0, 0, 42, time.FixedZone("CST", 8*60*60))

	got := FormatTimestamp(local)

	if got != "2026-05-30T12:00:00.000000042Z" {
		t.Fatalf("FormatTimestamp() = %q, want UTC RFC3339Nano", got)
	}
}

func TestParseTimestampTrimsInput(t *testing.T) {
	got, err := ParseTimestamp(" 2026-05-30T12:00:00.000000042Z ")
	if err != nil {
		t.Fatalf("ParseTimestamp() error = %v", err)
	}

	if got.UTC().Format(time.RFC3339Nano) != "2026-05-30T12:00:00.000000042Z" {
		t.Fatalf("ParseTimestamp() = %s", got.UTC().Format(time.RFC3339Nano))
	}
}
