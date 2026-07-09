// Package runtimeactivity aggregates whether the server currently has in-flight work.
// The desktop hot-update orchestrator only applies staged updates while the server is
// idle; this package owns that busy/idle business rule so HTTP handlers stay thin.
package runtimeactivity

import "context"

// Sources provides the runtime facts the report is derived from. Function fields keep
// the aggregation decoupled from concrete services and trivially testable.
type Sources struct {
	// ActiveGenerationTasks returns the number of generation tasks with in-flight work.
	ActiveGenerationTasks func(ctx context.Context) (int64, error)
	// ActiveAgentRuns returns the number of non-terminal agent runs.
	ActiveAgentRuns func() int
	// DatabaseFiles returns the absolute SQLite paths the desktop shell must snapshot
	// before switching server binaries.
	DatabaseFiles func() []string
}

// Report is the aggregated runtime activity snapshot.
type Report struct {
	Busy                   bool
	RunningGenerationTasks int64
	ActiveAgentRuns        int
	DatabaseFiles          []string
}

// Report computes the activity snapshot. When the generation-task count cannot be
// determined the report fails busy: the desktop must never apply an update while the
// server's state is unknown.
func (sources Sources) Report(ctx context.Context) Report {
	report := Report{DatabaseFiles: []string{}}
	if sources.DatabaseFiles != nil {
		if files := sources.DatabaseFiles(); files != nil {
			report.DatabaseFiles = files
		}
	}

	if sources.ActiveGenerationTasks != nil {
		count, err := sources.ActiveGenerationTasks(ctx)
		if err != nil {
			report.Busy = true
			return report
		}
		report.RunningGenerationTasks = count
	}
	if sources.ActiveAgentRuns != nil {
		report.ActiveAgentRuns = sources.ActiveAgentRuns()
	}
	report.Busy = report.RunningGenerationTasks > 0 || report.ActiveAgentRuns > 0
	return report
}
