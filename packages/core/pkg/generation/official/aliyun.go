package official

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const aliyunWanGenerationPath = "/api/v1/services/aigc/multimodal-generation/generation"

type aliyunWanRequest struct {
	Model      string              `json:"model"`
	Input      aliyunWanInput      `json:"input"`
	Parameters aliyunWanParameters `json:"parameters"`
}

type aliyunWanInput struct {
	Messages []aliyunWanMessage `json:"messages"`
}

type aliyunWanMessage struct {
	Role    string             `json:"role"`
	Content []aliyunWanContent `json:"content"`
}

type aliyunWanContent struct {
	Image string `json:"image,omitempty"`
	Text  string `json:"text,omitempty"`
}

type aliyunWanParameters struct {
	Size             string `json:"size"`
	N                int    `json:"n"`
	Watermark        bool   `json:"watermark"`
	EnableSequential bool   `json:"enable_sequential"`
	ThinkingMode     *bool  `json:"thinking_mode,omitempty"`
	Seed             *int   `json:"seed,omitempty"`
}

type aliyunWanResponse struct {
	StatusCode int    `json:"status_code"`
	RequestID  string `json:"request_id"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	Output     struct {
		Finished bool `json:"finished"`
		Choices  []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Role    string `json:"role"`
				Content []struct {
					Type  string `json:"type"`
					Image string `json:"image"`
					Text  string `json:"text"`
				} `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	} `json:"output"`
	Usage struct {
		InputTokens  int    `json:"input_tokens"`
		OutputTokens int    `json:"output_tokens"`
		TotalTokens  int    `json:"total_tokens"`
		ImageCount   int    `json:"image_count"`
		Size         string `json:"size"`
	} `json:"usage"`
}

func (provider *Provider) generateAliyunWanImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	if err := validateAliyunWanRequest(request); err != nil {
		return generation.Response{}, err
	}
	return provider.aliyunWanScheduler(request.Model).run(ctx, func(runCtx context.Context) (generation.Response, error) {
		return provider.generateAliyunWanImageAttempt(runCtx, request)
	})
}

func (provider *Provider) generateAliyunWanImageAttempt(ctx context.Context, request generation.Request) (generation.Response, error) {
	payload := aliyunWanPayload(request)
	result := aliyunWanResponse{}
	if err := provider.postJSON(
		ctx,
		provider.aliyunBaseURL+aliyunWanGenerationPath,
		provider.bearerAuthorization(),
		payload,
		&result,
	); err != nil {
		return generation.Response{}, err
	}
	if result.StatusCode != 0 && result.StatusCode != 200 {
		return generation.Response{}, aliyunWanResponseError(result)
	}
	if strings.TrimSpace(result.Code) != "" {
		return generation.Response{}, aliyunWanResponseError(result)
	}

	assets := make([]generation.Asset, 0, result.Usage.ImageCount)
	for _, choice := range result.Output.Choices {
		for _, content := range choice.Message.Content {
			if strings.TrimSpace(content.Image) == "" {
				continue
			}
			assets = append(assets, generation.Asset{
				Kind:     generation.KindImage,
				URL:      content.Image,
				MIMEType: "image/png",
			})
		}
	}
	if len(assets) == 0 {
		return generation.Response{}, fmt.Errorf("aliyun wan image generation returned no images")
	}

	return generation.Response{
		ID:     firstNonEmpty(result.RequestID, request.RouteID),
		Status: "completed",
		Model:  request.Model,
		Assets: assets,
		Usage: generation.Usage{
			InputTokens:  result.Usage.InputTokens,
			OutputTokens: result.Usage.OutputTokens,
			TotalTokens:  result.Usage.TotalTokens,
		},
		Metadata: map[string]any{
			"request_id":  result.RequestID,
			"image_count": result.Usage.ImageCount,
			"size":        result.Usage.Size,
		},
	}, nil
}

func aliyunWanPayload(request generation.Request) aliyunWanRequest {
	content := make([]aliyunWanContent, 0, len(request.ReferenceURLs)+1)
	for _, referenceURL := range compactStrings(request.ReferenceURLs) {
		content = append(content, aliyunWanContent{Image: referenceURL})
	}
	content = append(content, aliyunWanContent{Text: request.Prompt})

	parameters := aliyunWanParameters{
		Size:             firstNonEmpty(paramString(request.Params, "size"), "2048*2048"),
		N:                paramInt(request.Params, "n", 1),
		Watermark:        boolParamValue(request.Params, "watermark", request.Watermark, false),
		EnableSequential: false,
		Seed:             paramIntPointer(request.Params, "seed"),
	}
	if len(compactStrings(request.ReferenceURLs)) == 0 {
		thinkingMode := paramBool(request.Params, "thinking_mode", true)
		parameters.ThinkingMode = &thinkingMode
	}

	return aliyunWanRequest{
		Model: request.Model,
		Input: aliyunWanInput{Messages: []aliyunWanMessage{
			{Role: "user", Content: content},
		}},
		Parameters: parameters,
	}
}

func validateAliyunWanRequest(request generation.Request) error {
	if request.Model != generation.ModelWan27ImagePro && request.Model != generation.ModelWan27Image {
		return fmt.Errorf("unsupported aliyun wan image model %q", request.Model)
	}
	if utf8.RuneCountInString(request.Prompt) > 5000 {
		return fmt.Errorf("aliyun wan prompt must contain at most 5000 characters")
	}
	if len(compactStrings(request.ReferenceURLs)) > 9 {
		return fmt.Errorf("aliyun wan image generation supports at most 9 reference images")
	}
	if paramBool(request.Params, "enable_sequential", false) {
		return fmt.Errorf("aliyun wan sequential image generation is not enabled for this route")
	}

	n := paramInt(request.Params, "n", 1)
	if n < 1 || n > 4 {
		return fmt.Errorf("aliyun wan image count n must be between 1 and 4 in non-sequential mode")
	}

	size := firstNonEmpty(paramString(request.Params, "size"), "2048*2048")
	if isAliyunWan4KSize(size) {
		if request.Model != generation.ModelWan27ImagePro {
			return fmt.Errorf("aliyun wan model %q does not support 4K output", request.Model)
		}
		if len(compactStrings(request.ReferenceURLs)) > 0 {
			return fmt.Errorf("aliyun wan 4K output requires no reference images")
		}
	}

	return nil
}

func isAliyunWan4KSize(size string) bool {
	size = strings.TrimSpace(size)
	if strings.EqualFold(size, "4K") {
		return true
	}
	parts := strings.FieldsFunc(size, func(value rune) bool {
		return value == '*' || value == 'x' || value == 'X'
	})
	if len(parts) != 2 {
		return false
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil {
		return false
	}
	return int64(width)*int64(height) > int64(2048*2048)
}

func aliyunWanResponseError(response aliyunWanResponse) error {
	message := strings.TrimSpace(response.Message)
	if message == "" {
		message = "provider returned a non-success status"
	}
	code := strings.TrimSpace(response.Code)
	if response.StatusCode == http.StatusTooManyRequests || isAliyunWanRateLimitCode(code) {
		body := message
		if code != "" {
			body = fmt.Sprintf("%s: %s", code, message)
		}
		return &generation.HTTPError{
			Provider:   "aliyun",
			StatusCode: http.StatusTooManyRequests,
			Body:       body,
			Code:       "rate_limited",
			Reason:     generation.FailureRateLimited,
			Message:    "Provider rate limit exceeded.",
			Retryable:  true,
		}
	}
	if code != "" {
		return fmt.Errorf("aliyun wan image generation failed (%s): %s", code, message)
	}
	return fmt.Errorf("aliyun wan image generation failed: %s", message)
}

func isAliyunWanRateLimitCode(code string) bool {
	switch strings.ToLower(strings.TrimSpace(code)) {
	case "throttling.ratequota", "throttling.burstrate", "limitrequests", "limit_requests", "limit_burst_rate":
		return true
	default:
		return false
	}
}

const (
	aliyunWanMaxConcurrency = 5
	aliyunWanMaxQueued      = 100
	aliyunWanMaxAttempts    = 5
	aliyunWanQueueTimeout   = 2 * time.Minute
	aliyunWanStartInterval  = time.Second / aliyunWanMaxConcurrency
	aliyunWanRetryBaseDelay = time.Second
	aliyunWanRetryMaxDelay  = 16 * time.Second
)

type aliyunWanSchedulerConfig struct {
	maxConcurrency int
	maxQueued      int64
	maxAttempts    int
	queueTimeout   time.Duration
	startInterval  time.Duration
	retryBaseDelay time.Duration
	retryMaxDelay  time.Duration
}

type aliyunWanScheduler struct {
	config aliyunWanSchedulerConfig
	slots  chan struct{}

	waiting atomic.Int64
	startMu sync.Mutex
	nextRun time.Time
}

type aliyunWanSchedulerRegistry struct {
	mu         sync.Mutex
	schedulers map[string]*aliyunWanScheduler
}

var sharedAliyunWanSchedulers = aliyunWanSchedulerRegistry{
	schedulers: map[string]*aliyunWanScheduler{},
}

func defaultAliyunWanSchedulerConfig() aliyunWanSchedulerConfig {
	return aliyunWanSchedulerConfig{
		maxConcurrency: aliyunWanMaxConcurrency,
		maxQueued:      aliyunWanMaxQueued,
		maxAttempts:    aliyunWanMaxAttempts,
		queueTimeout:   aliyunWanQueueTimeout,
		startInterval:  aliyunWanStartInterval,
		retryBaseDelay: aliyunWanRetryBaseDelay,
		retryMaxDelay:  aliyunWanRetryMaxDelay,
	}
}

func newAliyunWanScheduler(config aliyunWanSchedulerConfig) *aliyunWanScheduler {
	if config.maxConcurrency <= 0 {
		config.maxConcurrency = aliyunWanMaxConcurrency
	}
	if config.maxQueued <= 0 {
		config.maxQueued = aliyunWanMaxQueued
	}
	if config.maxAttempts <= 0 {
		config.maxAttempts = 1
	}
	if config.queueTimeout <= 0 {
		config.queueTimeout = aliyunWanQueueTimeout
	}
	if config.retryBaseDelay <= 0 {
		config.retryBaseDelay = aliyunWanRetryBaseDelay
	}
	if config.retryMaxDelay < config.retryBaseDelay {
		config.retryMaxDelay = config.retryBaseDelay
	}

	return &aliyunWanScheduler{
		config: config,
		slots:  make(chan struct{}, config.maxConcurrency),
	}
}

func (registry *aliyunWanSchedulerRegistry) scheduler(key string) *aliyunWanScheduler {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	if scheduler := registry.schedulers[key]; scheduler != nil {
		return scheduler
	}
	scheduler := newAliyunWanScheduler(defaultAliyunWanSchedulerConfig())
	registry.schedulers[key] = scheduler
	return scheduler
}

func (provider *Provider) aliyunWanScheduler(model string) *aliyunWanScheduler {
	digest := sha256.Sum256([]byte(strings.TrimSpace(provider.apiKey)))
	key := fmt.Sprintf("%s|%x|%s", provider.aliyunBaseURL, digest[:8], strings.TrimSpace(model))
	return sharedAliyunWanSchedulers.scheduler(key)
}

func (scheduler *aliyunWanScheduler) run(
	ctx context.Context,
	operation func(context.Context) (generation.Response, error),
) (generation.Response, error) {
	for attempt := 0; attempt < scheduler.config.maxAttempts; attempt++ {
		release, err := scheduler.acquire(ctx)
		if err != nil {
			return generation.Response{}, err
		}
		response, err := operation(ctx)
		release()
		if err == nil || !isAliyunWanRateLimit(err) || attempt+1 >= scheduler.config.maxAttempts {
			return response, err
		}
		if err := waitForAliyunWanRetry(ctx, scheduler.retryDelay(attempt)); err != nil {
			return generation.Response{}, err
		}
	}

	return generation.Response{}, errors.New("aliyun wan image generation exhausted retry attempts")
}

func (scheduler *aliyunWanScheduler) acquire(ctx context.Context) (func(), error) {
	if scheduler.waiting.Add(1) > scheduler.config.maxQueued {
		scheduler.waiting.Add(-1)
		return nil, aliyunWanQueueError("aliyun wan image queue is full")
	}
	defer scheduler.waiting.Add(-1)

	waitCtx, cancel := context.WithTimeout(ctx, scheduler.config.queueTimeout)
	defer cancel()
	select {
	case scheduler.slots <- struct{}{}:
	case <-waitCtx.Done():
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return nil, aliyunWanQueueError("timed out waiting in aliyun wan image queue")
	}

	release := func() { <-scheduler.slots }
	if err := scheduler.waitForStart(waitCtx); err != nil {
		release()
		if parentErr := ctx.Err(); parentErr != nil {
			return nil, parentErr
		}
		return nil, aliyunWanQueueError("timed out waiting for aliyun wan image rate limit")
	}
	return release, nil
}

func (scheduler *aliyunWanScheduler) waitForStart(ctx context.Context) error {
	scheduler.startMu.Lock()
	now := time.Now()
	startAt := now
	if scheduler.nextRun.After(startAt) {
		startAt = scheduler.nextRun
	}
	scheduler.nextRun = startAt.Add(scheduler.config.startInterval)
	scheduler.startMu.Unlock()

	delay := time.Until(startAt)
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (scheduler *aliyunWanScheduler) retryDelay(attempt int) time.Duration {
	delay := scheduler.config.retryBaseDelay
	for index := 0; index < attempt && delay < scheduler.config.retryMaxDelay; index++ {
		delay *= 2
		if delay > scheduler.config.retryMaxDelay {
			delay = scheduler.config.retryMaxDelay
		}
	}
	if delay <= 1 {
		return delay
	}
	return delay + time.Duration(rand.Int63n(int64(delay/2)+1))
}

func waitForAliyunWanRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func isAliyunWanRateLimit(err error) bool {
	var httpErr *generation.HTTPError
	if errors.As(err, &httpErr) {
		if httpErr.StatusCode == http.StatusTooManyRequests || httpErr.Reason == generation.FailureRateLimited {
			return true
		}
		body := strings.ToLower(httpErr.Body)
		return strings.Contains(body, "throttling.ratequota") || strings.Contains(body, "throttling.burstrate")
	}
	return false
}

func aliyunWanQueueError(message string) error {
	return &generation.HTTPError{
		Provider:   "aliyun",
		StatusCode: http.StatusTooManyRequests,
		Body:       message,
		Code:       "provider_queue_full",
		Reason:     generation.FailureRateLimited,
		Message:    "Aliyun Wan image queue is busy.",
		Retryable:  true,
	}
}

const (
	aliyunHappyHorseGenerationPath = "/api/v1/services/aigc/video-generation/video-synthesis"
	aliyunHappyHorseTaskPath       = "/api/v1/tasks/"
)

var aliyunHappyHorseReferencePattern = regexp.MustCompile(`(?i)@(图片|image)\s*(\d+)`)

type aliyunHappyHorseRequest struct {
	Model      string                     `json:"model"`
	Input      aliyunHappyHorseInput      `json:"input"`
	Parameters aliyunHappyHorseParameters `json:"parameters"`
}

type aliyunHappyHorseInput struct {
	Prompt string                  `json:"prompt"`
	Media  []aliyunHappyHorseMedia `json:"media,omitempty"`
}

type aliyunHappyHorseMedia struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

type aliyunHappyHorseParameters struct {
	Resolution string `json:"resolution"`
	Ratio      string `json:"ratio,omitempty"`
	Duration   int    `json:"duration"`
	Watermark  bool   `json:"watermark"`
}

type aliyunHappyHorseResponse struct {
	RequestID string                        `json:"request_id"`
	Code      string                        `json:"code"`
	Message   string                        `json:"message"`
	Output    aliyunHappyHorseTaskOutput    `json:"output"`
	Usage     aliyunHappyHorseResponseUsage `json:"usage"`
}

type aliyunHappyHorseTaskOutput struct {
	TaskID     string `json:"task_id"`
	TaskStatus string `json:"task_status"`
	VideoURL   string `json:"video_url"`
	Code       string `json:"code"`
	Message    string `json:"message"`
}

type aliyunHappyHorseResponseUsage struct {
	Duration            int    `json:"duration"`
	InputVideoDuration  int    `json:"input_video_duration"`
	OutputVideoDuration int    `json:"output_video_duration"`
	VideoCount          int    `json:"video_count"`
	Resolution          int    `json:"SR"`
	Ratio               string `json:"ratio"`
}

func (provider *Provider) createAliyunHappyHorseVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	if err := validateAliyunHappyHorseRequest(request); err != nil {
		return generation.Response{}, err
	}

	result := aliyunHappyHorseResponse{}
	if err := provider.postAliyunHappyHorseJSON(ctx, aliyunHappyHorsePayload(request), &result); err != nil {
		return generation.Response{}, err
	}
	if err := aliyunHappyHorseResponseError(result.Code, result.Message); err != nil {
		return generation.Response{}, err
	}
	if strings.TrimSpace(result.Output.TaskID) == "" {
		return generation.Response{}, fmt.Errorf("aliyun HappyHorse response did not include a task id")
	}

	return generation.Response{
		ID:     joinTaskID(taskIDPrefix(request), result.Output.TaskID),
		Status: firstNonEmpty(normalizeVideoStatus(result.Output.TaskStatus), "submitted"),
		Model:  request.Model,
		Metadata: map[string]any{
			"task_id":        result.Output.TaskID,
			"request_id":     result.RequestID,
			"upstream_model": aliyunHappyHorseUpstreamModel(request),
		},
	}, nil
}

func (provider *Provider) getAliyunHappyHorseVideo(ctx context.Context, route generation.ModelRoute, taskID string) (generation.Response, error) {
	result := aliyunHappyHorseResponse{}
	endpoint := provider.aliyunBaseURL + aliyunHappyHorseTaskPath + url.PathEscape(taskID)
	if err := provider.getJSON(ctx, endpoint, provider.bearerAuthorization(), &result); err != nil {
		return generation.Response{}, err
	}
	if err := aliyunHappyHorseResponseError(result.Code, result.Message); err != nil {
		return generation.Response{}, err
	}

	status := normalizeVideoStatus(result.Output.TaskStatus)
	if strings.EqualFold(strings.TrimSpace(result.Output.TaskStatus), "UNKNOWN") {
		status = "failed"
	}
	assets := []generation.Asset{}
	if videoURL := strings.TrimSpace(result.Output.VideoURL); videoURL != "" {
		assets = append(assets, generation.Asset{Kind: generation.KindVideo, URL: videoURL})
	}

	return generation.Response{
		ID:     joinTaskID(route.ID, taskID),
		Status: firstNonEmpty(status, "submitted"),
		Model:  route.Model,
		Assets: assets,
		Metadata: map[string]any{
			"task_id":               taskID,
			"request_id":            result.RequestID,
			"error":                 result.Output.Message,
			"error_code":            result.Output.Code,
			"duration":              result.Usage.Duration,
			"input_video_duration":  result.Usage.InputVideoDuration,
			"output_video_duration": result.Usage.OutputVideoDuration,
			"video_count":           result.Usage.VideoCount,
			"resolution":            result.Usage.Resolution,
			"ratio":                 result.Usage.Ratio,
		},
	}, nil
}

func (provider *Provider) postAliyunHappyHorseJSON(ctx context.Context, payload aliyunHappyHorseRequest, result *aliyunHappyHorseResponse) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		provider.aliyunBaseURL+aliyunHappyHorseGenerationPath,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", provider.bearerAuthorization())
	request.Header.Set("X-DashScope-Async", "enable")

	return provider.doJSON(request, result)
}

func aliyunHappyHorsePayload(request generation.Request) aliyunHappyHorseRequest {
	references := compactStrings(request.ReferenceURLs)
	media := make([]aliyunHappyHorseMedia, 0, len(references))
	for _, referenceURL := range references {
		media = append(media, aliyunHappyHorseMedia{Type: "reference_image", URL: referenceURL})
	}

	parameters := aliyunHappyHorseParameters{
		Resolution: firstNonEmpty(paramString(request.Params, "resolution"), "720P"),
		Duration:   paramInt(request.Params, "duration", 5),
		Watermark:  false,
	}
	parameters.Ratio = firstNonEmpty(paramString(request.Params, "ratio"), "16:9")

	prompt := request.Prompt
	if len(references) > 0 {
		prompt = aliyunHappyHorseReferencePrompt(prompt)
	}

	return aliyunHappyHorseRequest{
		Model: aliyunHappyHorseUpstreamModel(request),
		Input: aliyunHappyHorseInput{
			Prompt: prompt,
			Media:  media,
		},
		Parameters: parameters,
	}
}

func validateAliyunHappyHorseRequest(request generation.Request) error {
	if request.Model != generation.ModelHappyHorse11 {
		return fmt.Errorf("unsupported aliyun HappyHorse video model %q", request.Model)
	}

	referenceCount := len(compactStrings(request.ReferenceURLs))
	if referenceCount > 9 {
		return fmt.Errorf("aliyun HappyHorse video generation supports at most 9 reference images")
	}

	resolution := firstNonEmpty(paramString(request.Params, "resolution"), "720P")
	if resolution != "720P" && resolution != "1080P" {
		return fmt.Errorf("aliyun HappyHorse resolution must be 720P or 1080P")
	}
	duration := paramInt(request.Params, "duration", 5)
	if duration < 3 || duration > 15 {
		return fmt.Errorf("aliyun HappyHorse duration must be between 3 and 15 seconds")
	}

	return nil
}

func aliyunHappyHorseUpstreamModel(request generation.Request) string {
	if len(compactStrings(request.ReferenceURLs)) > 0 {
		return generation.ModelHappyHorse11R2V
	}
	return generation.ModelHappyHorse11T2V
}

func aliyunHappyHorseReferencePrompt(prompt string) string {
	return aliyunHappyHorseReferencePattern.ReplaceAllString(prompt, "[Image $2]")
}

func aliyunHappyHorseResponseError(code string, message string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil
	}
	message = firstNonEmpty(strings.TrimSpace(message), "provider returned a non-success status")
	return fmt.Errorf("aliyun HappyHorse video generation failed (%s): %s", code, message)
}
