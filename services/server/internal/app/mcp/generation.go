package mcp

import (
	"context"
	"fmt"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
)

func (server *GenerationServer) CreateGenerationMessage(ctx context.Context, projectID string, input mediamcp.GenerationMessageInput) (mediamcp.GenerationMessageOutput, error) {
	service, err := server.requireService()
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	defaultProjectID, err := server.generationMessageProjectID(projectID, input)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	prepared, authorizationRequired, err := server.prepareAgentGenerationMessage(input, defaultProjectID)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	if !authorizationRequired {
		request := generationMessageRequestFromMCP(input, defaultProjectID)
		output, status, action, executionErr := server.executeGenerationMessage(ctx, service, request)
		if executionErr != nil {
			return mediamcp.GenerationMessageOutput{}, generationStatusError(action, status, executionErr)
		}
		return output, nil
	}

	claim, err := server.claimAgentGenerationUse(prepared.SelectionID, prepared.Fingerprint)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	switch claim.Status {
	case serviceselection.GenerationUseReplay:
		return replayGenerationMessageOutcome(claim.Outcome)
	case serviceselection.GenerationUseInProgressOrUnknown:
		return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"this confirmed generation was already submitted and its outcome is still processing or unknown",
			nil,
		)
	case serviceselection.GenerationUseConflict:
		return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
			GenerationConfirmationConsumed,
			"this confirmation has already been consumed by another generation request",
			nil,
		)
	case serviceselection.GenerationUseClaimed:
		// The external side effect is permitted only after this atomic claim.
	default:
		return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation confirmation returned an unknown claim state",
			nil,
		)
	}

	output, status, action, executionErr := server.executeGenerationMessage(ctx, service, prepared.Request)
	if executionErr != nil {
		failure := stableGenerationExecutionFailure(action, status)
		outcome, encodeErr := encodeGenerationMessageFailureOutcome(failure)
		if encodeErr != nil {
			return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
				GenerationConfirmationOutcomeUnknown,
				"generation failed and its replay outcome could not be encoded",
				encodeErr,
			)
		}
		if err := server.completeAgentGenerationUse(prepared.SelectionID, prepared.Fingerprint, outcome); err != nil {
			return mediamcp.GenerationMessageOutput{}, err
		}
		return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
			failure.Code,
			failure.Message,
			executionErr,
		)
	}

	outcome, err := encodeGenerationMessageSuccessOutcome(output)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation succeeded but its replay outcome could not be encoded",
			err,
		)
	}
	if err := server.completeAgentGenerationUse(prepared.SelectionID, prepared.Fingerprint, outcome); err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	return output, nil
}

func (server *GenerationServer) executeGenerationMessage(
	ctx context.Context,
	service GenerationService,
	request servicegeneration.GenerationMessageRequest,
) (mediamcp.GenerationMessageOutput, int, string, error) {
	server.logToolInvocation(mediamcp.GenerationTools.Generate.Name, "kind", request.Kind, "route_id", request.RouteID, "optimize", request.PromptOptimization != nil)
	if request.PromptOptimization != nil {
		response, status, err := service.CreatePromptOptimizedGenerationMessage(ctx, request)
		if err != nil {
			return mediamcp.GenerationMessageOutput{}, status, "optimize and generate", err
		}
		output := generationMessageOutputFromService(response.Generation)
		output.OptimizedPrompt = response.OptimizedPrompt
		return output, status, "optimize and generate", nil
	}
	response, status, err := service.CreateGenerationMessage(ctx, request)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, status, "create generation message", err
	}
	return generationMessageOutputFromService(response), status, "create generation message", nil
}

// CreateGenerationBatch submits multiple generation requests through the shared batch service.
func (server *GenerationServer) CreateGenerationBatch(ctx context.Context, projectID string, input mediamcp.GenerationBatchInput) (mediamcp.GenerationBatchOutput, error) {
	service, err := server.requireService()
	if err != nil {
		return mediamcp.GenerationBatchOutput{}, err
	}
	defaultProjectID, err := server.generationBatchProjectID(projectID, input)
	if err != nil {
		return mediamcp.GenerationBatchOutput{}, err
	}
	prepared, authorizationRequired, err := server.prepareAgentGenerationBatch(input, defaultProjectID)
	if err != nil {
		return mediamcp.GenerationBatchOutput{}, err
	}
	if !authorizationRequired {
		request := generationBatchRequestFromMCP(input, defaultProjectID)
		output, status, action, executionErr := server.executeGenerationBatch(ctx, service, request)
		if executionErr != nil {
			return mediamcp.GenerationBatchOutput{}, generationStatusError(action, status, executionErr)
		}
		return output, nil
	}

	claim, err := server.claimAgentGenerationUse(prepared.SelectionID, prepared.Fingerprint)
	if err != nil {
		return mediamcp.GenerationBatchOutput{}, err
	}
	switch claim.Status {
	case serviceselection.GenerationUseReplay:
		return replayGenerationBatchOutcome(claim.Outcome)
	case serviceselection.GenerationUseInProgressOrUnknown:
		return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"this confirmed generation batch was already submitted and its outcome is still processing or unknown",
			nil,
		)
	case serviceselection.GenerationUseConflict:
		return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
			GenerationConfirmationConsumed,
			"this confirmation has already been consumed by another generation request",
			nil,
		)
	case serviceselection.GenerationUseClaimed:
		// The complete ordered batch is permitted only after this atomic claim.
	default:
		return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation batch confirmation returned an unknown claim state",
			nil,
		)
	}

	output, status, action, executionErr := server.executeGenerationBatch(ctx, service, prepared.Request)
	if executionErr != nil {
		failure := stableGenerationExecutionFailure(action, status)
		outcome, encodeErr := encodeGenerationBatchFailureOutcome(failure)
		if encodeErr != nil {
			return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
				GenerationConfirmationOutcomeUnknown,
				"generation batch failed and its replay outcome could not be encoded",
				encodeErr,
			)
		}
		if err := server.completeAgentGenerationUse(prepared.SelectionID, prepared.Fingerprint, outcome); err != nil {
			return mediamcp.GenerationBatchOutput{}, err
		}
		return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
			failure.Code,
			failure.Message,
			executionErr,
		)
	}

	outcome, err := encodeGenerationBatchSuccessOutcome(output)
	if err != nil {
		return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation batch succeeded but its replay outcome could not be encoded",
			err,
		)
	}
	if err := server.completeAgentGenerationUse(prepared.SelectionID, prepared.Fingerprint, outcome); err != nil {
		return mediamcp.GenerationBatchOutput{}, err
	}
	return output, nil
}

func (server *GenerationServer) executeGenerationBatch(
	ctx context.Context,
	service GenerationService,
	request servicegeneration.GenerationBatchRequest,
) (mediamcp.GenerationBatchOutput, int, string, error) {
	server.logToolInvocation(mediamcp.GenerationTools.GenerateBatch.Name, "item_count", len(request.Items), "project_id", request.ProjectID)
	response, status, err := service.CreateGenerationBatch(ctx, request)
	if err != nil {
		return mediamcp.GenerationBatchOutput{}, status, "create generation batch", err
	}
	return generationBatchOutputFromService(response), status, "create generation batch", nil
}

func (server *GenerationServer) generationMessageProjectID(projectID string, input mediamcp.GenerationMessageInput) (string, error) {
	return server.resolveProjectID(projectID, generationMessageProjectIDs(input)...)
}

func (server *GenerationServer) generationBatchProjectID(projectID string, input mediamcp.GenerationBatchInput) (string, error) {
	values := []string{input.ProjectID}
	for _, item := range input.Items {
		values = append(values, generationMessageProjectIDs(item.Request)...)
	}
	return server.resolveProjectID(projectID, values...)
}

func generationMessageProjectIDs(input mediamcp.GenerationMessageInput) []string {
	values := []string{input.ProjectID}
	if input.DocumentContext != nil {
		values = append(values, input.DocumentContext.ProjectID)
	}
	if input.NotificationTarget != nil {
		values = append(values, input.NotificationTarget.ProjectID)
	}
	if input.PromptOptimization != nil {
		values = append(values, input.PromptOptimization.ProjectID)
	}
	return values
}

func (server *GenerationServer) resolveProjectID(projectID string, overrides ...string) (string, error) {
	scopedProjectID := server.scopedProjectID(projectID)
	resolved := ""
	for _, override := range overrides {
		override = domain.CleanProjectID(override)
		if override == "" {
			continue
		}
		if scopedProjectID != "" && override != scopedProjectID {
			return "", fmt.Errorf("projectId %q is outside generation mcp scope %q", override, scopedProjectID)
		}
		if resolved != "" && override != resolved {
			return "", fmt.Errorf("conflicting projectId values: %q and %q", resolved, override)
		}
		resolved = override
	}
	if scopedProjectID != "" {
		return scopedProjectID, nil
	}
	return resolved, nil
}

func (server *GenerationServer) scopedProjectID(projectID string) string {
	if server == nil {
		return domain.CleanProjectID(projectID)
	}
	return domain.CleanProjectID(firstNonEmpty(projectID, server.projectID))
}
