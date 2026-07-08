package agent

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// The frontend mirrors these DTOs by hand in
// apps/workspace/src/api/types/agent.ts. The shared fixture pins the field
// sets on both sides: this test proves the Go structs match the fixture
// (unknown fixture keys are rejected, and every json-tagged field must appear
// in the fixture), while agent-wire-contract.test.ts proves the TS mirrors
// match the same fixture. A wire field added or renamed on one side fails the
// other side's test until the fixture and both mirrors are updated together.
const wireContractFixturePath = "../../../../../apps/workspace/src/api/types/__fixtures__/agent-wire-contract.json"

func TestAgentWireContractMatchesFrontendFixture(t *testing.T) {
	raw, err := os.ReadFile(wireContractFixturePath)
	if err != nil {
		t.Fatalf("reading wire contract fixture: %v", err)
	}
	var fixture struct {
		MessageRequest json.RawMessage `json:"messageRequest"`
		Reference      json.RawMessage `json:"reference"`
		ChatMessage    json.RawMessage `json:"chatMessage"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parsing wire contract fixture: %v", err)
	}

	assertWireContract(t, "messageRequest", fixture.MessageRequest, &AgentMessageRequest{})
	assertWireContract(t, "reference", fixture.Reference, &AgentReference{})
	assertWireContract(t, "chatMessage", fixture.ChatMessage, &AgentChatMessageRecord{})
}

// assertWireContract checks both drift directions for one tracked DTO:
// fixture keys must all exist on the Go struct (DisallowUnknownFields), and
// every json-tagged Go field must appear in the fixture.
func assertWireContract(t *testing.T, name string, raw json.RawMessage, target any) {
	t.Helper()

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		t.Fatalf("%s: fixture carries a field the Go struct does not know: %v", name, err)
	}

	var fixtureKeys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fixtureKeys); err != nil {
		t.Fatalf("%s: parsing fixture keys: %v", name, err)
	}

	structType := reflect.TypeOf(target).Elem()
	for index := 0; index < structType.NumField(); index++ {
		tag := structType.Field(index).Tag.Get("json")
		fieldName := strings.Split(tag, ",")[0]
		if fieldName == "" || fieldName == "-" {
			continue
		}
		if _, ok := fixtureKeys[fieldName]; !ok {
			t.Errorf(
				"%s: Go field %q is missing from the wire contract fixture — update the fixture and the TS mirror in apps/workspace/src/api/types/agent.ts",
				name,
				fieldName,
			)
		}
	}
}
