package official

import (
	"context"
	"errors"
	"testing"
)

func TestInstructionsParsesOfficialTemplates(t *testing.T) {
	instructions, err := Instructions(context.Background())
	if err != nil {
		t.Fatalf("Instructions() error = %v", err)
	}
	if len(instructions) != 2 {
		t.Fatalf("instructions = %#v, want AGENTS and TOOLS", instructions)
	}
	if instructions[0].ID != "AGENTS" || instructions[1].ID != "TOOLS" {
		t.Fatalf("instructions = %#v, want AGENTS then TOOLS", instructions)
	}
	for _, instruction := range instructions {
		if instruction.Name == "" || instruction.Body == "" || !instruction.Editable {
			t.Fatalf("instruction = %#v, want name, body, editable", instruction)
		}
	}
}

func TestInstructionByIDReportsMissingInstruction(t *testing.T) {
	_, err := InstructionByID(context.Background(), "MISSING")
	if !errors.Is(err, ErrInstructionNotFound) {
		t.Fatalf("InstructionByID() error = %v, want ErrInstructionNotFound", err)
	}
}
