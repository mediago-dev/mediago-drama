import type React from "react";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { ProjectRenameDialog } from "@/domains/projects/components/ProjectRenameDialog";
import { AgentProjectCreateDialog } from "@/domains/workspace/components/AgentProjectCreateDialog";
import { GenerationConversationCreateDialog } from "@/domains/workspace/components/GenerationConversationCreateDialog";
import { NewDocumentDialog } from "@/domains/workspace/components/NewDocumentDialog";
import { NewReferenceDocumentDialog } from "@/domains/workspace/components/NewReferenceDocumentDialog";

export const DialogCallHost: React.FC = () => (
	<>
		<ConfirmDialog />
		<NewDocumentDialog />
		<NewReferenceDocumentDialog />
		<GenerationConversationCreateDialog />
		<AgentProjectCreateDialog />
		<ProjectRenameDialog />
	</>
);
