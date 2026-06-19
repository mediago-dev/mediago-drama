package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
)

// PromptLibraryService supplies reusable generation prompt persistence.
type PromptLibraryService interface {
	List(ctx context.Context, filter service.Filter) ([]service.PromptEntry, error)
	Get(ctx context.Context, id string) (service.PromptEntry, error)
	Create(ctx context.Context, entry service.PromptEntry) (service.PromptEntry, error)
	Update(ctx context.Context, id string, entry service.PromptEntry) (service.PromptEntry, error)
	Reset(ctx context.Context, id string) (service.PromptEntry, error)
	Delete(ctx context.Context, id string) error
}

// PromptLibrary handles reusable generation prompt HTTP routes.
type PromptLibrary struct {
	store PromptLibraryService
}

// NewPromptLibrary returns a reusable generation prompt route handler.
func NewPromptLibrary(store PromptLibraryService) PromptLibrary {
	return PromptLibrary{store: store}
}

type promptLibraryListResponse struct {
	Prompts []service.PromptEntry `json:"prompts"`
}

type deletePromptLibraryResponse struct {
	Deleted bool `json:"deleted"`
}

// HandleListPrompts godoc
// @Summary 获取提示词预设
// @Description 返回内置和用户自定义的可复用生成提示词。
// @Tags Prompt Presets
// @Produce json
// @Param layer query string false "Prompt layer"
// @Param kind query string false "Prompt kind"
// @Param type query string false "Prompt type"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets [get]
func (handler PromptLibrary) HandleListPrompts(context *gin.Context) {
	prompts, err := handler.store.List(context.Request.Context(), service.Filter{
		Layer: context.Query("layer"),
		Type:  context.Query("type"),
		Kind:  context.Query("kind"),
	})
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, promptLibraryListResponse{Prompts: prompts})
}

// HandleGetPrompt godoc
// @Summary 获取提示词预设详情
// @Description 返回一个可复用生成提示词的完整内容。
// @Tags Prompt Presets
// @Produce json
// @Param id path string true "Prompt preset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets/{id} [get]
func (handler PromptLibrary) HandleGetPrompt(context *gin.Context) {
	prompt, err := handler.store.Get(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, prompt)
}

// HandlePostPrompt godoc
// @Summary 创建提示词预设
// @Description 创建一个用户提示词预设。
// @Tags Prompt Presets
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Prompt preset payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets [post]
func (handler PromptLibrary) HandlePostPrompt(context *gin.Context) {
	payload, err := decodeJSON[service.PromptEntry](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	prompt, err := handler.store.Create(context.Request.Context(), payload)
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, prompt)
}

// HandlePutPrompt godoc
// @Summary 更新提示词预设
// @Description 更新用户提示词，或为内置提示词创建用户覆盖。
// @Tags Prompt Presets
// @Accept json
// @Produce json
// @Param id path string true "Prompt preset ID"
// @Param payload body SwaggerObject true "Prompt preset payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets/{id} [put]
func (handler PromptLibrary) HandlePutPrompt(context *gin.Context) {
	payload, err := decodeJSON[service.PromptEntry](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	prompt, err := handler.store.Update(context.Request.Context(), context.Param("id"), payload)
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, prompt)
}

// HandleDeletePrompt godoc
// @Summary 删除提示词预设
// @Description 删除一个用户创建的提示词预设。
// @Tags Prompt Presets
// @Produce json
// @Param id path string true "Prompt preset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets/{id} [delete]
func (handler PromptLibrary) HandleDeletePrompt(context *gin.Context) {
	if err := handler.store.Delete(context.Request.Context(), context.Param("id")); err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, deletePromptLibraryResponse{Deleted: true})
}

// HandleResetPrompt godoc
// @Summary 重置提示词预设
// @Description 将一个内置提示词恢复到系统默认内容。
// @Tags Prompt Presets
// @Produce json
// @Param id path string true "Prompt preset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets/{id}/reset [post]
func (handler PromptLibrary) HandleResetPrompt(context *gin.Context) {
	prompt, err := handler.store.Reset(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, prompt)
}

func writePromptLibraryError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidPromptEntry):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrBuiltinPromptEntryReadonly):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, service.ErrPromptEntryExists):
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
	case errors.Is(err, service.ErrPromptEntryNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}
