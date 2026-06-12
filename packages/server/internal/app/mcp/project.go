package mcp

import (
	"context"
	"fmt"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func (adapter *Adapter) ListProjects(ctx context.Context) (mediamcp.ProjectList, error) {
	_ = ctx
	if adapter == nil || adapter.store == nil {
		return mediamcp.ProjectList{}, fmt.Errorf("workspace store is not configured")
	}
	return adapter.store.ListProjects()
}

func (adapter *Adapter) GetProjectConfig(ctx context.Context, projectID string) (mediamcp.ProjectConfigToolOutput, error) {
	_ = ctx
	if adapter == nil || adapter.store == nil {
		return mediamcp.ProjectConfigToolOutput{}, fmt.Errorf("workspace store is not configured")
	}
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.ProjectConfigToolOutput{}, err
	}
	config, err := adapter.store.LoadProjectConfig(server.projectID)
	if err != nil {
		return mediamcp.ProjectConfigToolOutput{}, err
	}
	return mediamcp.ProjectConfigToolOutput{
		Status:  "ok",
		Message: "项目配置已读取。",
		Config:  config,
	}, nil
}

func (adapter *Adapter) UpdateProjectConfig(ctx context.Context, projectID string, input mediamcp.ProjectConfigPatchInput) (mediamcp.ProjectConfigToolOutput, error) {
	_ = ctx
	if adapter == nil || adapter.store == nil {
		return mediamcp.ProjectConfigToolOutput{}, fmt.Errorf("workspace store is not configured")
	}
	server, err := adapter.documentServerForProject(projectID)
	if err != nil {
		return mediamcp.ProjectConfigToolOutput{}, err
	}
	result, err := adapter.store.SaveProjectConfigPatchInput(server.projectID, input)
	if err != nil {
		return mediamcp.ProjectConfigToolOutput{}, err
	}
	message := "项目配置已更新。"
	if !result.Changed {
		message = "项目配置没有变化。"
	}
	return mediamcp.ProjectConfigToolOutput{
		Status:  "applied",
		Message: message,
		Config:  result.Config,
	}, nil
}
