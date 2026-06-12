import type { AgentDocumentContext } from "@/domains/agent/api/agent";
import type { DocumentComment, MarkdownDocument } from "@/domains/documents/stores";

export interface AgentExecutionContext {
	activeDocument: MarkdownDocument;
	documentSnapshots: AgentDocumentContext[];
	projectId: string | null;
	comments: DocumentComment[];
	selection: string;
	anchorText: string;
	isStructuredScopedEdit: boolean;
	commentId?: string;
}
