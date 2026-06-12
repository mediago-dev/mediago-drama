package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/promptlibrary"
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

// HandleListPrompts lists built-in and user reusable generation prompts.
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

// HandleGetPrompt returns one reusable generation prompt.
func (handler PromptLibrary) HandleGetPrompt(context *gin.Context) {
	prompt, err := handler.store.Get(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, prompt)
}

// HandlePostPrompt creates a new user reusable generation prompt.
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

// HandlePutPrompt updates a user prompt or creates a user override for a built-in prompt.
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

// HandleDeletePrompt deletes a user-created prompt.
func (handler PromptLibrary) HandleDeletePrompt(context *gin.Context) {
	if err := handler.store.Delete(context.Request.Context(), context.Param("id")); err != nil {
		writePromptLibraryError(context, err)
		return
	}
	httpresponse.OK(context, deletePromptLibraryResponse{Deleted: true})
}

// HandleResetPrompt restores one built-in prompt to its system default.
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
