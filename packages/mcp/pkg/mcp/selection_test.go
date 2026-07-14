package mcp

import (
	"reflect"
	"strings"
	"testing"
)

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
	for _, fragment := range []string{FieldTypeGenerationSettings, "generation_params", "kind=video"} {
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
