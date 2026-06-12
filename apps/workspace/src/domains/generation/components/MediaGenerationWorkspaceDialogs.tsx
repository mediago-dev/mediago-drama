import type React from "react";
import {
	AdvancedSettingsDialog,
	ReferenceSelectionDialog,
} from "@/domains/generation/components/MediaGenerationDialogs";
import type { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

type GenerationWorkspaceState = ReturnType<typeof useGenerationWorkspace>;

export const MediaGenerationWorkspaceDialogs: React.FC<{
	advancedOpen: boolean;
	advancedRouteParams: React.ComponentProps<
		typeof AdvancedSettingsDialog
	>["paramControlsProps"]["params"];
	generationEntries: GenerationEntry[];
	modelSummary: string;
	onAdvancedOpenChange: (open: boolean) => void;
	onReferenceDialogOpenChange: (open: boolean) => void;
	referenceDialogOpen: boolean;
	workspace: GenerationWorkspaceState;
}> = ({
	advancedOpen,
	advancedRouteParams,
	generationEntries,
	modelSummary,
	onAdvancedOpenChange,
	onReferenceDialogOpenChange,
	referenceDialogOpen,
	workspace,
}) => {
	const routeSelectorsProps = {
		compact: true,
		showKindToggle: false,
		kind: workspace.kind,
		families: workspace.visibleFamilies,
		versions: workspace.visibleVersions,
		routes: workspace.visibleRoutes,
		selectedFamily: workspace.selectedFamily,
		selectedVersion: workspace.selectedVersion,
		selectedRoute: workspace.selectedRoute,
		onKindChange: workspace.setKind,
		onFamilyChange: workspace.updateFamily,
		onVersionChange: workspace.updateVersion,
		onRouteChange: workspace.updateRoute,
	} satisfies React.ComponentProps<typeof AdvancedSettingsDialog>["routeSelectorsProps"];

	return (
		<>
			<AdvancedSettingsDialog
				hasConfiguredRoutesForKind={workspace.hasConfiguredRoutesForKind}
				modelSummary={modelSummary}
				open={advancedOpen}
				paramControlsProps={{
					compact: true,
					params: advancedRouteParams,
					values: workspace.selectedParams,
					onChange: workspace.updateParam,
				}}
				routeSelectorsProps={routeSelectorsProps}
				onOpenChange={onAdvancedOpenChange}
			/>
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
