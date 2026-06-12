package timestamp

import (
	"testing"
	"time"
)

func TestFormatRFC3339NanoUsesUTC(t *testing.T) {
	local := time.Date(2026, 5, 30, 18, 30, 0, 123456789, time.FixedZone("CST", 8*60*60))

	got := FormatRFC3339Nano(local)

	if got != "2026-05-30T10:30:00.123456789Z" {
		t.Fatalf("FormatRFC3339Nano() = %q, want UTC RFC3339Nano", got)
	}
}

func TestParseRFC3339NanoTrimsInput(t *testing.T) {
	got, err := ParseRFC3339Nano(" 2026-05-30T10:30:00.123456789Z ")
	if err != nil {
		t.Fatalf("ParseRFC3339Nano() error = %v", err)
	}

	if got.UTC().Format(time.RFC3339Nano) != "2026-05-30T10:30:00.123456789Z" {
		t.Fatalf("ParseRFC3339Nano() = %s", got.UTC().Format(time.RFC3339Nano))
	}
}
