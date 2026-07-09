package handlers

import (
	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
)

// RuntimeActivitySources provides the runtime facts the activity probe reports.
// Function fields keep the handler decoupled and trivially testable.
type RuntimeActivitySources struct {
	// ActiveGenerationTasks returns the number of generation tasks with in-flight work.
	ActiveGenerationTasks func() (int64, error)
	// ActiveAgentRuns returns the number of non-terminal agent runs.
	ActiveAgentRuns func() int
	// DatabaseFiles returns the absolute SQLite paths the desktop shell must snapshot
	// before switching server binaries.
	DatabaseFiles func() []string
}

// RuntimeActivity reports whether the server is busy, for the desktop hot-update
// orchestrator: updates are only applied while nothing is running.
type RuntimeActivity struct {
	sources RuntimeActivitySources
}

// NewRuntimeActivity creates the runtime activity handler.
func NewRuntimeActivity(sources RuntimeActivitySources) RuntimeActivity {
	return RuntimeActivity{sources: sources}
}

type runtimeActivityResponse struct {
	Busy                   bool     `json:"busy"`
	RunningGenerationTasks int64    `json:"runningGenerationTasks"`
	ActiveAgentRuns        int      `json:"activeAgentRuns"`
	DatabaseFiles          []string `json:"databaseFiles"`
}

// HandleGetRuntimeActivity godoc
// @Summary 运行时活动状态
// @Description 返回服务是否有进行中的生成任务或 Agent 运行，以及需要快照的数据库位置。
// @Tags System
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Router /api/v1/runtime/activity [get]
func (handler RuntimeActivity) HandleGetRuntimeActivity(context *gin.Context) {
	runningTasks := int64(0)
	if handler.sources.ActiveGenerationTasks != nil {
		count, err := handler.sources.ActiveGenerationTasks()
		if err != nil {
			// Fail busy: when we cannot verify, the desktop must not apply updates.
			httpresponse.OK(context, runtimeActivityResponse{
				Busy:          true,
				DatabaseFiles: handler.databaseFiles(),
			})
			return
		}
		runningTasks = count
	}

	activeRuns := 0
	if handler.sources.ActiveAgentRuns != nil {
		activeRuns = handler.sources.ActiveAgentRuns()
	}

	httpresponse.OK(context, runtimeActivityResponse{
		Busy:                   runningTasks > 0 || activeRuns > 0,
		RunningGenerationTasks: runningTasks,
		ActiveAgentRuns:        activeRuns,
		DatabaseFiles:          handler.databaseFiles(),
	})
}

func (handler RuntimeActivity) databaseFiles() []string {
	if handler.sources.DatabaseFiles == nil {
		return []string{}
	}
	files := handler.sources.DatabaseFiles()
	if files == nil {
		return []string{}
	}
	return files
}
