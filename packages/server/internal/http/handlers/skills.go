package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	serviceskill "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/skill"
)

// Skills handles agent skill HTTP routes.
type Skills struct {
	registry *serviceskill.Registry
}

// NewSkills returns a skill route handler.
func NewSkills(registry *serviceskill.Registry) Skills {
	return Skills{registry: registry}
}

type skillListResponse struct {
	Skills []serviceskill.SkillMeta `json:"skills"`
}

type skillResponse struct {
	Name        string              `json:"name"`
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description"`
	Source      serviceskill.Source `json:"source"`
	Hint        map[string]string   `json:"hint,omitempty"`
	Content     string              `json:"content"`
}

type createSkillRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type deleteSkillResponse struct {
	Deleted bool `json:"deleted"`
}

// HandleListSkills lists available built-in and user skills.
func (handler Skills) HandleListSkills(context *gin.Context) {
	metas, err := handler.registry.List(context.Request.Context())
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, skillListResponse{Skills: metas})
}

// HandleGetSkill returns one raw skill Markdown file.
func (handler Skills) HandleGetSkill(context *gin.Context) {
	item, err := handler.registry.GetRaw(context.Request.Context(), context.Param("name"))
	if err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, skillHTTPResponse(item))
}

// HandlePutSkill updates a skill from raw Markdown, creating a user override for built-ins.
func (handler Skills) HandlePutSkill(context *gin.Context) {
	raw, err := decodeRawMarkdown(context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	item, err := handler.registry.Save(context.Request.Context(), context.Param("name"), raw)
	if err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, skillHTTPResponse(item))
}

// HandlePostSkill creates a new user skill.
func (handler Skills) HandlePostSkill(context *gin.Context) {
	payload, err := decodeJSON[createSkillRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	item, err := handler.registry.Create(context.Request.Context(), payload.Name, payload.Content)
	if err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, skillHTTPResponse(item))
}

// HandleDeleteSkill deletes an existing user skill.
func (handler Skills) HandleDeleteSkill(context *gin.Context) {
	if err := handler.registry.Delete(context.Request.Context(), context.Param("name")); err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, deleteSkillResponse{Deleted: true})
}

func decodeRawMarkdown(context *gin.Context) (string, error) {
	data, err := io.ReadAll(context.Request.Body)
	if err != nil {
		return "", fmt.Errorf("reading request body: %w", err)
	}
	if len(data) == 0 {
		return "", fmt.Errorf("skill markdown is required")
	}
	contentType := context.GetHeader("Content-Type")
	if strings.Contains(contentType, "application/json") {
		var raw string
		if err := json.Unmarshal(data, &raw); err == nil {
			return raw, nil
		}
	}
	return string(data), nil
}

func skillHTTPResponse(item serviceskill.Skill) skillResponse {
	return skillResponse{
		Name:        item.Name,
		Title:       item.Title,
		Description: item.Description,
		Source:      item.Source,
		Hint:        item.Hint,
		Content:     item.Raw,
	}
}

func writeSkillError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, serviceskill.ErrInvalidSkill):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, serviceskill.ErrBuiltinSkillReadonly):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, serviceskill.ErrSkillExists):
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
	case errors.Is(err, serviceskill.ErrSkillNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}
