import type React from "react";
import { MentionSectionCreateDialog } from "@/domains/documents/components/MentionSectionCreateDialog";
import { MentionSectionTargetDialog } from "@/domains/documents/components/MentionSectionTargetDialog";
import { ProjectRenameDialog } from "@/domains/projects/components/ProjectRenameDialog";
import { AgentProjectCreateDialog } from "@/domains/workspace/components/AgentProjectCreateDialog";
import { GenerationConversationCreateDialog } from "@/domains/workspace/components/GenerationConversationCreateDialog";
import { NewDocumentDialog } from "@/domains/workspace/components/NewDocumentDialog";
import { NewReferenceDocumentDialog } from "@/domains/workspace/components/NewReferenceDocumentDialog";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";

export const DialogCallHost: React.FC = () => (
	<>
		<ConfirmDialog />
		<NewDocumentDialog />
		<NewReferenceDocumentDialog />
		<GenerationConversationCreateDialog />
		<AgentProjectCreateDialog />
		<ProjectRenameDialog />
		<MentionSectionCreateDialog />
		<MentionSectionTargetDialog />
	</>
);
