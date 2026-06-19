import type React from "react";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { AgentProjectCreateDialog } from "@/domains/workspace/components/AgentProjectCreateDialog";
import { GenerationConversationCreateDialog } from "@/domains/workspace/components/GenerationConversationCreateDialog";
import { NewDocumentDialog } from "@/domains/workspace/components/NewDocumentDialog";
import { NewSourceMaterialDialog } from "@/domains/workspace/components/NewSourceMaterialDialog";

export const DialogCallHost: React.FC = () => (
	<>
		<ConfirmDialog />
		<NewDocumentDialog />
		<NewSourceMaterialDialog />
		<GenerationConversationCreateDialog />
		<AgentProjectCreateDialog />
	</>
);
