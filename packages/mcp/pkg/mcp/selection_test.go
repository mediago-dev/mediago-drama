package mcp

import (
	"reflect"
	"strings"
	"testing"
)

func TestGenerationPlanIntentContract(t *testing.T) {
	intentType := reflect.TypeOf(GenerationPlanIntentInput{})
	assertJSONField(t, intentType, "Version", "version")
	assertJSONField(t, intentType, "Operation", "operation")
	assertJSONField(t, intentType, "ConversationTitle", "conversationTitle,omitempty")
	itemsField := assertJSONField(t, intentType, "Items", "items")
	if itemsField.Type != reflect.TypeOf([]GenerationPlanIntentItemInput{}) {
		t.Fatalf("GenerationPlanIntentInput.Items type = %v, want []GenerationPlanIntentItemInput", itemsField.Type)
	}

	operationField, _ := intentType.FieldByName("Operation")
	operationSchema := operationField.Tag.Get("jsonschema")
	for _, fragment := range []string{"create_single", "create_batch"} {
		if !strings.Contains(operationField.Tag.Get("jsonschema"), fragment) {
			t.Fatalf("GenerationPlanIntentInput.Operation jsonschema missing %q: %q", fragment, operationField.Tag.Get("jsonschema"))
		}
	}
	if strings.Contains(operationSchema, "retry") {
		t.Fatalf("GenerationPlanIntentInput.Operation jsonschema still allows retry: %q", operationSchema)
	}

	itemType := reflect.TypeOf(GenerationPlanIntentItemInput{})
	for fieldName, jsonName := range map[string]string{
		"ID":                 "id",
		"Kind":               "kind",
		"Prompt":             "prompt",
		"AssetTitle":         "assetTitle,omitempty",
		"CapabilityID":       "capabilityId,omitempty",
		"ConversationID":     "sessionId,omitempty",
		"ScopeID":            "scopeId,omitempty",
		"DocumentID":         "documentId,omitempty",
		"SectionID":          "sectionId,omitempty",
		"DocumentContext":    "documentContext,omitempty",
		"ResourceType":       "resourceType,omitempty",
		"ReferenceAssetIDs":  "referenceAssetIds,omitempty",
		"NotificationTarget": "notificationTarget,omitempty",
	} {
		assertJSONField(t, itemType, fieldName, jsonName)
	}
	if _, ok := itemType.FieldByName("RetryTaskID"); ok {
		t.Fatal("GenerationPlanIntentItemInput.RetryTaskID must not be published")
	}
	conversationField, _ := itemType.FieldByName("ConversationID")
	for _, fragment := range []string{"生成会话 ID", "sessionId"} {
		if !strings.Contains(conversationField.Tag.Get("jsonschema"), fragment) {
			t.Fatalf("GenerationPlanIntentItemInput.ConversationID jsonschema missing %q: %q", fragment, conversationField.Tag.Get("jsonschema"))
		}
	}

	formIntent := assertJSONField(t, reflect.TypeOf(AskUserFormInput{}), "Intent", "intent,omitempty")
	selectionIntent := assertJSONField(t, reflect.TypeOf(AskUserSelectionInput{}), "Intent", "intent,omitempty")
	wantIntentType := reflect.TypeOf((*GenerationPlanIntentInput)(nil))
	if formIntent.Type != wantIntentType || selectionIntent.Type != wantIntentType {
		t.Fatalf("intent field types = form %v, selection %v; want %v", formIntent.Type, selectionIntent.Type, wantIntentType)
	}
	if !strings.Contains(formIntent.Tag.Get("jsonschema"), "generation_plan") {
		t.Fatalf("AskUserFormInput.Intent jsonschema = %q, want generation_plan requirement", formIntent.Tag.Get("jsonschema"))
	}
	selectionIntentSchema := selectionIntent.Tag.Get("jsonschema")
	for _, fragment := range []string{"create_single", "create_batch"} {
		if !strings.Contains(selectionIntentSchema, fragment) {
			t.Fatalf("AskUserSelectionInput.Intent jsonschema missing %q: %q", fragment, selectionIntentSchema)
		}
	}
	for _, forbidden := range []string{"generation_retry_plan", "retry"} {
		if strings.Contains(selectionIntentSchema, forbidden) {
			t.Fatalf("AskUserSelectionInput.Intent jsonschema still advertises %q: %q", forbidden, selectionIntentSchema)
		}
	}
}

func TestGenerationSettingsFieldContractIsAdvertised(t *testing.T) {
	if FieldTypeGenerationSettings != "generation_settings" {
		t.Fatalf("FieldTypeGenerationSettings = %q, want generation_settings", FieldTypeGenerationSettings)
	}

	fieldType, ok := reflect.TypeOf(FormFieldInput{}).FieldByName("Type")
	if !ok {
		t.Fatal("FormFieldInput.Type is missing")
	}
	for _, fragment := range []string{
		FieldTypeGenerationSettings,
		"kind=image",
		"video",
		"routeId",
		"referenceAssetIds",
		"promptSupplements",
		"promptOptimization",
	} {
		if !strings.Contains(fieldType.Tag.Get("jsonschema"), fragment) {
			t.Fatalf("FormFieldInput.Type jsonschema missing %q: %q", fragment, fieldType.Tag.Get("jsonschema"))
		}
	}

	fields, ok := reflect.TypeOf(AskUserFormInput{}).FieldByName("Fields")
	if !ok {
		t.Fatal("AskUserFormInput.Fields is missing")
	}
	for _, fragment := range []string{FieldTypeGenerationSettings, "kind=image|video", "历史视频"} {
		if !strings.Contains(fields.Tag.Get("jsonschema"), fragment) {
			t.Fatalf("AskUserFormInput.Fields jsonschema missing %q: %q", fragment, fields.Tag.Get("jsonschema"))
		}
	}

	defaultField, ok := reflect.TypeOf(FormFieldInput{}).FieldByName("Default")
	if !ok {
		t.Fatal("FormFieldInput.Default is missing")
	}
	defaultSchema := defaultField.Tag.Get("jsonschema")
	for _, fragment := range []string{"仅在用户本轮明确指定", "完整 default", "否则必须省略", "批量生成表单"} {
		if !strings.Contains(defaultSchema, fragment) {
			t.Fatalf("FormFieldInput.Default jsonschema missing %q: %q", fragment, defaultSchema)
		}
	}
	if strings.Contains(defaultSchema, "用 preferences 或 schema 默认项预填") {
		t.Fatalf("FormFieldInput.Default jsonschema still advertises unconditional defaults: %q", defaultSchema)
	}
}

func TestSelectionSchemaUsesNeutralResourceExamples(t *testing.T) {
	tests := []struct {
		fieldName string
		want      string
	}{
		{fieldName: "ImageURL", want: "生成结果"},
		{fieldName: "Title", want: "目标资源"},
		{fieldName: "Kind", want: "resource_target"},
	}
	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			owner := reflect.TypeOf(SelectionOptionInput{})
			if tt.fieldName == "Title" || tt.fieldName == "Kind" {
				owner = reflect.TypeOf(AskUserSelectionInput{})
			}
			field, ok := owner.FieldByName(tt.fieldName)
			if !ok {
				t.Fatalf("%s.%s is missing", owner.Name(), tt.fieldName)
			}
			description := field.Tag.Get("jsonschema")
			if !strings.Contains(description, tt.want) {
				t.Fatalf("%s.%s jsonschema = %q, want neutral example %q", owner.Name(), tt.fieldName, description, tt.want)
			}
			for _, forbidden := range []string{"风格网格", "插画风格", "image_style"} {
				if strings.Contains(description, forbidden) {
					t.Fatalf("%s.%s jsonschema still contains standalone style example %q: %q", owner.Name(), tt.fieldName, forbidden, description)
				}
			}
		})
	}
}

func assertJSONField(t *testing.T, owner reflect.Type, fieldName string, wantJSONTag string) reflect.StructField {
	t.Helper()

	field, ok := owner.FieldByName(fieldName)
	if !ok {
		t.Fatalf("%s.%s is missing", owner.Name(), fieldName)
	}
	if got := field.Tag.Get("json"); got != wantJSONTag {
		t.Fatalf("%s.%s json tag = %q, want %q", owner.Name(), fieldName, got, wantJSONTag)
	}
	return field
}
