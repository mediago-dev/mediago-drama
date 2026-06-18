import type React from "react";
import {
	ReferenceSelectionDialog,
	type ReferenceSelectionShortcutGroup,
} from "@/domains/generation/components/MediaGenerationDialogs";
import type { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

type GenerationWorkspaceState = ReturnType<typeof useGenerationWorkspace>;

export const MediaGenerationWorkspaceDialogs: React.FC<{
	generationEntries: GenerationEntry[];
	inlineReferenceAssetIds?: string[];
	onReferenceDialogOpenChange: (open: boolean) => void;
	onToggleInlineReference?: (asset: GenerationWorkspaceState["mediaAssets"][number]) => void;
	referenceDialogOpen: boolean;
	referenceShortcutGroups?: ReferenceSelectionShortcutGroup[];
	workspace: GenerationWorkspaceState;
}> = ({
	generationEntries,
	inlineReferenceAssetIds = [],
	onReferenceDialogOpenChange,
	onToggleInlineReference,
	referenceDialogOpen,
	referenceShortcutGroups = [],
	workspace,
}) => {
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
				selectedShortcutAssetIds={inlineReferenceAssetIds}
				shortcutGroups={referenceShortcutGroups}
				title={workspace.kind === "video" ? "选择参考素材" : "选择参考图"}
				onOpenChange={onReferenceDialogOpenChange}
				onRefreshAssets={() => {
					void workspace.mutateMediaAssets();
				}}
				onRemoveReference={workspace.toggleReferenceAsset}
				onToggleShortcutReference={onToggleInlineReference}
				onToggleReference={workspace.toggleReferenceAsset}
				onUpload={workspace.uploadReferenceAsset}
			/>
		</>
	);
};
