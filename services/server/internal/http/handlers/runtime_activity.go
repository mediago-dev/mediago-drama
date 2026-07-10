package handlers

import (
	"context"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	serviceruntimeactivity "github.com/mediago-dev/mediago-drama/services/server/internal/service/runtimeactivity"
)

// RuntimeActivityReporter computes the aggregated runtime activity snapshot.
type RuntimeActivityReporter func(ctx context.Context) serviceruntimeactivity.Report

// RuntimeActivity exposes the busy/idle probe consumed by the desktop hot-update
// orchestrator: updates are only applied while nothing is running.
type RuntimeActivity struct {
	report RuntimeActivityReporter
}

// NewRuntimeActivity creates the runtime activity handler.
func NewRuntimeActivity(report RuntimeActivityReporter) RuntimeActivity {
	return RuntimeActivity{report: report}
}

type runtimeActivityResponse struct {
	Busy                       bool     `json:"busy"`
	RunningGenerationTasks     int64    `json:"runningGenerationTasks"`
	InFlightGenerationRequests int64    `json:"inFlightGenerationRequests"`
	ActiveAgentRuns            int      `json:"activeAgentRuns"`
	DatabaseFiles              []string `json:"databaseFiles"`
}

// HandleGetRuntimeActivity godoc
// @Summary 运行时活动状态
// @Description 返回服务是否有进行中的生成任务或 Agent 运行，以及需要快照的数据库位置。
// @Tags System
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/runtime/activity [get]
func (handler RuntimeActivity) HandleGetRuntimeActivity(context *gin.Context) {
	report := handler.report(context.Request.Context())
	httpresponse.OK(context, runtimeActivityResponse{
		Busy:                       report.Busy,
		RunningGenerationTasks:     report.RunningGenerationTasks,
		InFlightGenerationRequests: report.InFlightGenerationRequests,
		ActiveAgentRuns:            report.ActiveAgentRuns,
		DatabaseFiles:              report.DatabaseFiles,
	})
}
