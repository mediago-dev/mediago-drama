package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
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
	Overridden  bool                `json:"overridden,omitempty"`
	TemplateID  string              `json:"templateId,omitempty"`
	Template    *skillTemplate      `json:"template,omitempty"`
	Hint        map[string]string   `json:"hint,omitempty"`
	Content     string              `json:"content"`
	PackID      string              `json:"packId,omitempty"`
	ReleaseID   string              `json:"releaseId,omitempty"`
}

type skillTemplate struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Description      string `json:"description,omitempty"`
	DocumentCategory string `json:"documentCategory"`
}

type createSkillRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
	PackID  string `json:"packId"`
}

type deleteSkillResponse struct {
	Deleted bool `json:"deleted"`
}

// HandleListSkills godoc
// @Summary 获取 Skills 列表
// @Description 返回来自技能包和用户自定义的 Agent Skills。
// @Tags Skills
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/skills [get]
func (handler Skills) HandleListSkills(context *gin.Context) {
	metas, err := handler.registry.List(context.Request.Context())
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, skillListResponse{Skills: metas})
}

// HandleGetSkill godoc
// @Summary 获取 Skill 内容
// @Description 返回一个 Skill 的原始 Markdown 内容。
// @Tags Skills
// @Produce json
// @Param name path string true "Skill name"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/skills/{name} [get]
func (handler Skills) HandleGetSkill(context *gin.Context) {
	item, err := handler.registry.GetRaw(context.Request.Context(), context.Param("name"))
	if err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, skillHTTPResponse(item))
}

// HandlePutSkill godoc
// @Summary 保存 Skill
// @Description 保存 Skill Markdown，必要时为包内 Skill 创建用户覆盖。
// @Tags Skills
// @Accept text/plain
// @Produce json
// @Param name path string true "Skill name"
// @Param body body string true "Skill Markdown"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/skills/{name} [put]
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

// HandlePostSkill godoc
// @Summary 创建 Skill
// @Description 创建一个用户自定义 Skill。
// @Tags Skills
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Skill payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/skills [post]
func (handler Skills) HandlePostSkill(context *gin.Context) {
	payload, err := decodeJSON[createSkillRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	item, err := handler.registry.CreateInPack(context.Request.Context(), payload.Name, payload.Content, payload.PackID)
	if err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, skillHTTPResponse(item))
}

// HandleDeleteSkill godoc
// @Summary 删除 Skill
// @Description 删除一个用户自定义 Skill，或隐藏一个包内 Skill。
// @Tags Skills
// @Produce json
// @Param name path string true "Skill name"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/skills/{name} [delete]
func (handler Skills) HandleDeleteSkill(context *gin.Context) {
	if err := handler.registry.Delete(context.Request.Context(), context.Param("name")); err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, deleteSkillResponse{Deleted: true})
}

// HandleResetSkill godoc
// @Summary 恢复 Skill
// @Description 将一个包内 Skill 恢复为所属技能包的默认内容。
// @Tags Skills
// @Produce json
// @Param name path string true "Skill name"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/skills/{name}/reset [post]
func (handler Skills) HandleResetSkill(context *gin.Context) {
	item, err := handler.registry.Reset(context.Request.Context(), context.Param("name"))
	if err != nil {
		writeSkillError(context, err)
		return
	}
	httpresponse.OK(context, skillHTTPResponse(item))
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
		Overridden:  item.Overridden,
		TemplateID:  item.TemplateID,
		Hint:        item.Hint,
		Content:     item.Raw,
		PackID:      item.PackID,
		ReleaseID:   item.ReleaseID,
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
