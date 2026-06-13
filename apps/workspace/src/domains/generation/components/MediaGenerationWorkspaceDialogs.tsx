import type React from "react";
import { ReferenceSelectionDialog } from "@/domains/generation/components/MediaGenerationDialogs";
import type { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

type GenerationWorkspaceState = ReturnType<typeof useGenerationWorkspace>;

export const MediaGenerationWorkspaceDialogs: React.FC<{
	generationEntries: GenerationEntry[];
	onReferenceDialogOpenChange: (open: boolean) => void;
	referenceDialogOpen: boolean;
	workspace: GenerationWorkspaceState;
}> = ({ generationEntries, onReferenceDialogOpenChange, referenceDialogOpen, workspace }) => {
	return (
		<>
			<ReferenceSelectionDialog
				disabled={
					!workspace.hasConfiguredRoutesForKind || !workspace.selectedRoute.supportsReferenceUrls
				}
				entries={generationEntries}
				inputId={`${workspace.uploadIdPrefix}-reference-dialog-upload`}
				isUploading={workspace.isUploadingAsset}
				mediaAssets={workspace.mediaAssets}
				open={referenceDialogOpen}
				references={workspace.selectedReferenceAssets}
				requiresReference={false}
				selectableKinds={workspace.selectableReferenceKinds}
				selectedAssetIds={workspace.selectedReferenceAssetIds}
				onOpenChange={onReferenceDialogOpenChange}
				onRefreshAssets={() => {
					void workspace.mutateMediaAssets();
				}}
				onRemoveReference={workspace.toggleReferenceAsset}
				onToggleReference={workspace.toggleReferenceAsset}
				onUpload={workspace.uploadReferenceAsset}
			/>
		</>
	);
};
