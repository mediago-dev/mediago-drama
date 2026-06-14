import type React from "react";
import { CommentsGutter } from "@/domains/documents/components/CommentsGutter";
import { ProjectAssetPreviewPane } from "@/domains/documents/components/ProjectAssetPreviewPane";
import {
	prewarmWritingEditorDocument,
	WritingEditor,
} from "@/domains/documents/components/WritingEditor";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import { useDocumentsStore } from "@/domains/documents/stores";

export const prewarmWritingDocumentEditor = prewarmWritingEditorDocument;

export const WritingWorkspace: React.FC = () => {
	const activeAssetId = useDocumentsStore((state) => state.activeAssetId);
	const assets = useDocumentsStore((state) => state.assets);
	const projectId = useDocumentsStore((state) => state.projectId);
	const activeAsset = assets.find((asset) => asset.id === activeAssetId) ?? null;

	return (
		<ProjectWorkspaceShell>
			<div className="relative flex h-full min-h-0 w-full overflow-hidden bg-ide-editor">
				{activeAsset ? (
					<ProjectAssetPreviewPane asset={activeAsset} projectId={projectId} />
				) : (
					<>
						<WritingEditor />
						<CommentsGutter />
					</>
				)}
			</div>
		</ProjectWorkspaceShell>
	);
};
