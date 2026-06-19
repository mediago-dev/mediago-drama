package app

import (
	"context"
	"time"
)

const (
	defaultGenerationWorkerInterval = 20 * time.Second
	defaultGenerationWorkerLimit    = 5
)

func (handler *apiHandler) startGenerationWorker(config Config) {
	interval := config.GenerationWorkerInterval
	if interval <= 0 {
		interval = defaultGenerationWorkerInterval
	}
	limit := config.GenerationWorkerLimit
	if limit <= 0 {
		limit = defaultGenerationWorkerLimit
	}

	ctx := handler.shutdownContext()
	handler.workers.Add(1)
	go func() {
		defer handler.workers.Done()
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				handler.pollPendingGenerationTasks(ctx, limit)
				timer.Reset(interval)
			}
		}
	}()
}

func (handler *apiHandler) pollPendingGenerationTasks(ctx context.Context, limit int) {
	handler.generation.PollPendingGenerationTasks(ctx, limit)
}

func (handler *apiHandler) pollGenerationTask(ctx context.Context, task generationTaskRecord) {
	handler.generation.PollGenerationTask(ctx, task)
}
