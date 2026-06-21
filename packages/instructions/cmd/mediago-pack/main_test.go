package main

import "testing"

func TestParsePathAndOutputAllowsOutputAfterInput(t *testing.T) {
	input, output, err := parsePathAndOutput([]string{"pack-dir", "-o", "pack.mgpack"}, "usage")
	if err != nil {
		t.Fatalf("parsePathAndOutput returned error: %v", err)
	}
	if input != "pack-dir" || output != "pack.mgpack" {
		t.Fatalf("input/output = %q/%q, want pack-dir/pack.mgpack", input, output)
	}
}

func TestParsePathAndOutputAllowsOutputBeforeInput(t *testing.T) {
	input, output, err := parsePathAndOutput([]string{"-o=pack.mgpack", "pack-dir"}, "usage")
	if err != nil {
		t.Fatalf("parsePathAndOutput returned error: %v", err)
	}
	if input != "pack-dir" || output != "pack.mgpack" {
		t.Fatalf("input/output = %q/%q, want pack-dir/pack.mgpack", input, output)
	}
}
