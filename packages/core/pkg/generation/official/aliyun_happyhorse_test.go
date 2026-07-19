package official

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestAliyunHappyHorseReferenceToVideoLifecycle(t *testing.T) {
	var payload aliyunHappyHorseRequest
	var rawPayload map[string]any
	client := &http.Client{Transport: happyHorseRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		responseBody := ""
		switch {
		case request.Method == http.MethodPost && request.URL.Path == aliyunHappyHorseGenerationPath:
			if got := request.Header.Get("Authorization"); got != "Bearer sk-aliyun" {
				t.Fatalf("Authorization = %q, want Bearer sk-aliyun", got)
			}
			if got := request.Header.Get("X-DashScope-Async"); got != "enable" {
				t.Fatalf("X-DashScope-Async = %q, want enable", got)
			}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("ReadAll() error = %v", err)
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("Unmarshal(payload) error = %v", err)
			}
			if err := json.Unmarshal(body, &rawPayload); err != nil {
				t.Fatalf("Unmarshal(raw payload) error = %v", err)
			}
			responseBody = `{
				"request_id":"req-create",
				"output":{"task_id":"task-123","task_status":"PENDING"}
			}`
		case request.Method == http.MethodGet && request.URL.Path == aliyunHappyHorseTaskPath+"task-123":
			if got := request.Header.Get("Authorization"); got != "Bearer sk-aliyun" {
				t.Fatalf("Authorization = %q, want Bearer sk-aliyun", got)
			}
			responseBody = `{
				"request_id":"req-status",
				"output":{
					"task_id":"task-123",
					"task_status":"SUCCEEDED",
					"video_url":"https://example.test/happyhorse.mp4"
				},
				"usage":{"duration":6,"input_video_duration":0,"output_video_duration":6,"video_count":1,"SR":1080}
			}`
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Request:    request,
		}, nil
	})}

	provider, err := NewProvider(Config{
		AliyunBaseURL: "https://dashscope.test",
		APIKey:        "sk-aliyun",
		HTTPClient:    client,
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	created, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteOfficialHappyHorse11,
		Prompt:        "让@图片1向镜头挥手",
		ReferenceURLs: []string{"data:image/png;base64,abc"},
		Params: map[string]any{
			"aspectRatio": "9:16",
			"resolution":  "1080p",
			"duration":    "6",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if created.ID != generation.RouteOfficialHappyHorse11+":task-123" || created.Status != "submitted" {
		t.Fatalf("created response = %#v", created)
	}
	if created.Model != generation.ModelHappyHorse11 || created.Metadata["upstream_model"] != generation.ModelHappyHorse11R2V {
		t.Fatalf("created model/metadata = %q/%#v", created.Model, created.Metadata)
	}
	if payload.Model != generation.ModelHappyHorse11R2V || payload.Input.Prompt != "让[Image 1]向镜头挥手" {
		t.Fatalf("payload model/prompt = %q/%q", payload.Model, payload.Input.Prompt)
	}
	if len(payload.Input.Media) != 1 || payload.Input.Media[0].Type != "reference_image" {
		t.Fatalf("payload media = %#v", payload.Input.Media)
	}
	if payload.Parameters.Resolution != "1080P" || payload.Parameters.Ratio != "9:16" || payload.Parameters.Duration != 6 || payload.Parameters.Watermark {
		t.Fatalf("payload parameters = %#v", payload.Parameters)
	}
	parameters, ok := rawPayload["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("raw parameters = %#v", rawPayload["parameters"])
	}
	if _, ok := parameters["seed"]; ok {
		t.Fatalf("parameters should not include seed: %#v", parameters)
	}

	completed, err := provider.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if completed.Status != "completed" || len(completed.Assets) != 1 {
		t.Fatalf("completed response = %#v", completed)
	}
	if completed.Assets[0].URL != "https://example.test/happyhorse.mp4" {
		t.Fatalf("video URL = %q", completed.Assets[0].URL)
	}
	if completed.Metadata["resolution"] != 1080 || completed.Metadata["video_count"] != 1 {
		t.Fatalf("metadata = %#v", completed.Metadata)
	}
}

type happyHorseRoundTripFunc func(*http.Request) (*http.Response, error)

func (function happyHorseRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestValidateAliyunHappyHorseReferenceRequirements(t *testing.T) {
	references := func(count int) []string {
		values := make([]string, count)
		for index := range values {
			values[index] = "https://example.test/reference.png"
		}
		return values
	}

	tests := []struct {
		name       string
		model      string
		references int
		wantError  string
	}{
		{name: "text to video accepts none", model: generation.ModelHappyHorse11},
		{name: "reference to video accepts one", model: generation.ModelHappyHorse11, references: 1},
		{name: "reference to video accepts nine", model: generation.ModelHappyHorse11, references: 9},
		{name: "reference to video rejects ten", model: generation.ModelHappyHorse11, references: 10, wantError: "at most 9"},
		{name: "image to video is unsupported", model: "happyhorse-1.1-i2v", references: 1, wantError: "unsupported"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateAliyunHappyHorseRequest(generation.Request{
				Model:         test.model,
				ReferenceURLs: references(test.references),
			})
			if test.wantError == "" && err != nil {
				t.Fatalf("validateAliyunHappyHorseRequest() error = %v", err)
			}
			if test.wantError != "" && (err == nil || !strings.Contains(err.Error(), test.wantError)) {
				t.Fatalf("validateAliyunHappyHorseRequest() error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestAliyunHappyHorseReferencePayload(t *testing.T) {
	payload := aliyunHappyHorsePayload(generation.Request{
		Model:         generation.ModelHappyHorse11,
		Prompt:        "@图片1看向@image 2",
		ReferenceURLs: []string{"one", "two"},
		Params: map[string]any{
			"ratio":      "9:16",
			"resolution": "720P",
			"duration":   15,
		},
	})

	if payload.Model != generation.ModelHappyHorse11R2V {
		t.Fatalf("model = %q", payload.Model)
	}
	if payload.Input.Prompt != "[Image 1]看向[Image 2]" {
		t.Fatalf("prompt = %q", payload.Input.Prompt)
	}
	if len(payload.Input.Media) != 2 || payload.Input.Media[0].Type != "reference_image" || payload.Input.Media[1].Type != "reference_image" {
		t.Fatalf("media = %#v", payload.Input.Media)
	}
	if payload.Parameters.Ratio != "9:16" || payload.Parameters.Duration != 15 {
		t.Fatalf("parameters = %#v", payload.Parameters)
	}
}

func TestAliyunHappyHorseTextPayload(t *testing.T) {
	payload := aliyunHappyHorsePayload(generation.Request{
		Model:  generation.ModelHappyHorse11,
		Prompt: "一匹马在草原奔跑",
		Params: map[string]any{
			"ratio":      "16:9",
			"resolution": "720P",
			"duration":   5,
		},
	})

	if payload.Model != generation.ModelHappyHorse11T2V {
		t.Fatalf("model = %q", payload.Model)
	}
	if payload.Input.Prompt != "一匹马在草原奔跑" || len(payload.Input.Media) != 0 {
		t.Fatalf("input = %#v", payload.Input)
	}
}
