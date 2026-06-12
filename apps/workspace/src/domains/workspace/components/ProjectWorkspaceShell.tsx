import type React from "react";

interface ProjectWorkspaceShellProps {
	children: React.ReactNode;
}

export const ProjectWorkspaceShell: React.FC<ProjectWorkspaceShellProps> = ({ children }) => (
	<div className="h-full min-h-0 bg-ide-editor text-ide-editor-foreground">{children}</div>
);
