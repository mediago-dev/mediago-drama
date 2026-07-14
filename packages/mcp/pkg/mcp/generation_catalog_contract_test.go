package mcp

import (
	"reflect"
	"strings"
	"testing"
)

func TestGenerationCatalogContractOmitsStandaloneStyleState(t *testing.T) {
	assertNoJSONField(t, reflect.TypeOf(GenerationModelsOutput{}), "stylePresets")
	assertNoJSONField(t, reflect.TypeOf(GenerationPreferences{}), "stylePresetId")
}

func assertNoJSONField(t *testing.T, valueType reflect.Type, jsonName string) {
	t.Helper()
	for index := 0; index < valueType.NumField(); index++ {
		field := valueType.Field(index)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name == jsonName {
			t.Fatalf("%s still exposes deprecated Agent field %q", valueType.Name(), jsonName)
		}
	}
}
