package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	servicecodexskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/codexskill"
)

type fakeCodexSkillService struct {
	list func(context.Context) (servicecodexskill.ListResponse, error)
	get  func(context.Context, string) (servicecodexskill.Detail, error)
}

func (service fakeCodexSkillService) List(ctx context.Context) (servicecodexskill.ListResponse, error) {
	return service.list(ctx)
}

func (service fakeCodexSkillService) Get(ctx context.Context, id string) (servicecodexskill.Detail, error) {
	return service.get(ctx, id)
}

func TestCodexSkillsListReturnsPartialRootIssuesAsSuccess(t *testing.T) {
	service := fakeCodexSkillService{
		list: func(context.Context) (servicecodexskill.ListResponse, error) {
			return servicecodexskill.ListResponse{
				Summary: servicecodexskill.Summary{Total: 1, MediaGoAvailable: 1},
				Roots: []servicecodexskill.Root{{
					Source:      servicecodexskill.SourceAdmin,
					DisplayPath: "/etc/codex/skills",
					Exists:      true,
					Error:       "无法读取此来源。",
				}},
				Issues: []servicecodexskill.Issue{{
					Code:        servicecodexskill.IssueRootUnreadable,
					Message:     "无法读取 Skill 来源。",
					Source:      servicecodexskill.SourceAdmin,
					DisplayPath: "/etc/codex/skills",
				}},
				Skills: []servicecodexskill.SkillSummary{{
					ID:          "csk_0123456789abcdef0123456789abcdef",
					Name:        "shared",
					DisplayPath: "~/.agents/skills/shared/SKILL.md",
					Source:      servicecodexskill.SourceUserShared,
					Valid:       true,
				}},
			}, nil
		},
		get: func(context.Context, string) (servicecodexskill.Detail, error) {
			return servicecodexskill.Detail{}, servicecodexskill.ErrNotFound
		},
	}
	recorder := serveCodexSkillsRequest(t, service, http.MethodGet, "/codex-skills")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var envelope struct {
		Data servicecodexskill.ListResponse `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if envelope.Data.Summary.Total != 1 || len(envelope.Data.Issues) != 1 || envelope.Data.Issues[0].Code != servicecodexskill.IssueRootUnreadable {
		t.Fatalf("data = %#v, want successful partial inventory", envelope.Data)
	}
	if strings.Contains(recorder.Body.String(), "absolutePath") || strings.Contains(recorder.Body.String(), "resolvedPath") {
		t.Fatalf("list response leaks absolute paths: %s", recorder.Body.String())
	}
}

func TestCodexSkillsDetailReturnsBoundedContent(t *testing.T) {
	const id = "csk_0123456789abcdef0123456789abcdef"
	service := fakeCodexSkillService{
		list: func(context.Context) (servicecodexskill.ListResponse, error) {
			return servicecodexskill.ListResponse{}, nil
		},
		get: func(_ context.Context, gotID string) (servicecodexskill.Detail, error) {
			if gotID != id {
				t.Fatalf("id = %q, want %q", gotID, id)
			}
			return servicecodexskill.Detail{
				SkillSummary:     servicecodexskill.SkillSummary{ID: id, Name: "shared"},
				AbsolutePath:     "/tmp/shared/SKILL.md",
				RawContent:       "---\nname: shared\ndescription: Shared.\n---\n",
				PreviewAvailable: true,
				Dependencies:     []servicecodexskill.ToolDependency{{Type: "mcp", Value: "docs"}},
				Issues:           []servicecodexskill.Issue{},
			}, nil
		},
	}
	recorder := serveCodexSkillsRequest(t, service, http.MethodGet, "/codex-skills/"+id)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"rawContent":"---\nname: shared`) || !strings.Contains(recorder.Body.String(), `"absolutePath":"/tmp/shared/SKILL.md"`) {
		t.Fatalf("response = %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestCodexSkillsReturnsNotFoundForUnknownID(t *testing.T) {
	service := fakeCodexSkillService{
		list: func(context.Context) (servicecodexskill.ListResponse, error) {
			return servicecodexskill.ListResponse{}, nil
		},
		get: func(context.Context, string) (servicecodexskill.Detail, error) {
			return servicecodexskill.Detail{}, servicecodexskill.ErrNotFound
		},
	}
	recorder := serveCodexSkillsRequest(t, service, http.MethodGet, "/codex-skills/unknown")
	if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), "Codex Skill 不存在") {
		t.Fatalf("response = %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestCodexSkillsReturnsInternalErrorForFatalScan(t *testing.T) {
	service := fakeCodexSkillService{
		list: func(context.Context) (servicecodexskill.ListResponse, error) {
			return servicecodexskill.ListResponse{}, errors.New("home provider failed with secret")
		},
		get: func(context.Context, string) (servicecodexskill.Detail, error) {
			return servicecodexskill.Detail{}, errors.New("scan failed with secret")
		},
	}
	for _, path := range []string{"/codex-skills", "/codex-skills/csk_0123456789abcdef0123456789abcdef"} {
		recorder := serveCodexSkillsRequest(t, service, http.MethodGet, path)
		if recorder.Code != http.StatusInternalServerError || !strings.Contains(recorder.Body.String(), "internal error") || strings.Contains(recorder.Body.String(), "secret") {
			t.Fatalf("response for %s = %d %s", path, recorder.Code, recorder.Body.String())
		}
	}
}

func serveCodexSkillsRequest(t *testing.T, service CodexSkillService, method string, path string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	handler := NewCodexSkills(service)
	router.GET("/codex-skills", handler.HandleListCodexSkills)
	router.GET("/codex-skills/:id", handler.HandleGetCodexSkill)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(method, path, nil))
	return recorder
}
