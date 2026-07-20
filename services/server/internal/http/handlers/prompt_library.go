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
	ListBrowsable(ctx context.Context, filter service.Filter) ([]service.PromptEntryIndex, error)
	ListCategories(ctx context.Context) ([]service.PromptCategory, error)
	Get(ctx context.Context, id string) (service.PromptEntry, error)
	GetBrowsable(ctx context.Context, id string) (service.PromptEntry, error)
	Create(ctx context.Context, entry service.PromptEntry) (service.PromptEntry, error)
	CreateCategory(ctx context.Context, category service.PromptCategory) (service.PromptCategory, error)
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
	Prompts []service.PromptEntryIndex `json:"prompts"`
}

type promptCategoryListResponse struct {
	Categories []service.PromptCategory `json:"categories"`
}

type deletePromptLibraryResponse struct {
	Deleted bool `json:"deleted"`
}

// HandleListCategories godoc
// @Summary 获取提示词分类
// @Description 返回来自技能包和用户自定义的提示词分类。
// @Tags Prompt Presets
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-categories [get]
func (handler PromptLibrary) HandleListCategories(context *gin.Context) {
	categories, err := handler.store.ListCategories(context.Request.Context())
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, promptCategoryListResponse{Categories: categories})
}

// HandlePostCategory godoc
// @Summary 创建提示词分类
// @Description 创建一个用户提示词分类。
// @Tags Prompt Presets
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Prompt category payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-categories [post]
func (handler PromptLibrary) HandlePostCategory(context *gin.Context) {
	payload, err := decodeJSON[service.PromptCategory](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	category, err := handler.store.CreateCategory(context.Request.Context(), payload)
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, category)
}

// HandleListPrompts godoc
// @Summary 获取提示词预设
// @Description 返回来自技能包和用户自定义的提示词索引，不包含提示词正文。
// @Tags Prompt Presets
// @Produce json
// @Param category query string false "Prompt category"
// @Param type query string false "Prompt type"
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets [get]
func (handler PromptLibrary) HandleListPrompts(context *gin.Context) {
	category := context.Query("category")
	if category == "" {
		category = context.Query("layer")
		switch category {
		case "scene_style", "tone":
			category = "extra"
		}
	}
	prompts, err := handler.store.ListBrowsable(context.Request.Context(), service.Filter{
		Category: category,
		Type:     context.Query("type"),
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
	prompt, err := handler.store.GetBrowsable(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, prompt)
}

// HandleGetPromptForUse returns prompt content for an explicit insertion or
// generation action. Imported packs stay hidden from management views, while
// their enabled prompts remain usable from the generation workspace.
// @Summary 获取可插入的提示词内容
// @Description 返回一个可直接插入生成输入框的提示词完整内容。
// @Tags Prompt Presets
// @Produce json
// @Param id path string true "Prompt preset ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-presets/{id}/use [get]
func (handler PromptLibrary) HandleGetPromptForUse(context *gin.Context) {
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
// @Description 更新用户提示词，或为包内提示词创建用户覆盖。
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
// @Description 将一个提示词恢复到所属技能包的默认内容。
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
	case errors.Is(err, service.ErrInvalidPromptEntry), errors.Is(err, service.ErrInvalidPromptCategory):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, service.ErrBuiltinPromptEntryReadonly):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, service.ErrPromptEntryExists), errors.Is(err, service.ErrPromptCategoryExists):
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
	case errors.Is(err, service.ErrPromptEntryNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}
