package runtimeactivity

import (
	"context"
	"errors"
	"testing"
)

func TestSourcesReport(t *testing.T) {
	databaseFiles := []string{"/tmp/app.db", "/tmp/settings.db"}

	testCases := []struct {
		name          string
		tasks         int64
		tasksErr      error
		agentRuns     int
		expectBusy    bool
		expectedTasks int64
		expectedRuns  int
	}{
		{name: "idle", tasks: 0, agentRuns: 0, expectBusy: false},
		{name: "generation task running", tasks: 2, agentRuns: 0, expectBusy: true, expectedTasks: 2},
		{name: "agent run active", tasks: 0, agentRuns: 1, expectBusy: true, expectedRuns: 1},
		{name: "both active", tasks: 1, agentRuns: 3, expectBusy: true, expectedTasks: 1, expectedRuns: 3},
		{name: "task count error fails busy", tasksErr: errors.New("db closed"), expectBusy: true},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			sources := Sources{
				ActiveGenerationTasks: func(context.Context) (int64, error) {
					return testCase.tasks, testCase.tasksErr
				},
				ActiveAgentRuns: func() int { return testCase.agentRuns },
				DatabaseFiles:   func() []string { return databaseFiles },
			}

			report := sources.Report(context.Background())

			if report.Busy != testCase.expectBusy {
				t.Fatalf("Busy = %v, want %v", report.Busy, testCase.expectBusy)
			}
			if testCase.tasksErr == nil {
				if report.RunningGenerationTasks != testCase.expectedTasks {
					t.Fatalf("RunningGenerationTasks = %d, want %d", report.RunningGenerationTasks, testCase.expectedTasks)
				}
				if report.ActiveAgentRuns != testCase.expectedRuns {
					t.Fatalf("ActiveAgentRuns = %d, want %d", report.ActiveAgentRuns, testCase.expectedRuns)
				}
			}
			if len(report.DatabaseFiles) != len(databaseFiles) {
				t.Fatalf("DatabaseFiles = %v, want %v", report.DatabaseFiles, databaseFiles)
			}
		})
	}
}

func TestSourcesReportWithoutSources(t *testing.T) {
	report := Sources{}.Report(context.Background())
	if report.Busy {
		t.Fatalf("Busy = true, want false when no sources are wired")
	}
	if report.DatabaseFiles == nil || len(report.DatabaseFiles) != 0 {
		t.Fatalf("DatabaseFiles = %v, want empty slice", report.DatabaseFiles)
	}
}
