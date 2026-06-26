import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Images } from "lucide-react";
import type {
	GenerationAsset,
	GenerationMessageResponse,
	SelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { DocumentSectionGenerator } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { sectionGenerationIdentityKey } from "@/domains/documents/lib/section-generation";
import { Button } from "@/shared/components/ui/button";

interface ImageGenerationDialogProps {
	onGenerationComplete: (
		section: MarkdownSectionContext,
		pendingId: string,
		assets: GenerationAsset[],
		sourceTaskId: string,
	) => void;
	onGenerationError: (section: MarkdownSectionContext, pendingId: string) => void;
	onGenerationResponse?: (
		section: MarkdownSectionContext,
		pendingId: string,
		response: GenerationMessageResponse,
	) => void;
	onGenerationStart: (section: MarkdownSectionContext, pendingId: string, prompt: string) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	onToggleImage?: (
		section: MarkdownSectionContext,
		asset: GenerationAsset,
		selected: boolean,
	) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId?: string;
	resolveLatestSection?: boolean;
	selectedAssetKeys?: string[] | ((section: MarkdownSectionContext) => string[]);
	selectedGenerationAssets?: SelectedGenerationAsset[];
	section: MarkdownSectionContext | null;
}

interface ImageGenerationDialogController {
	dialogs: ImageGenerationDialogPanelController[];
}

interface ImageGenerationDialogPanelController {
	dialogId: string;
	generatorKey: string;
	materialLibraryOpen: boolean;
	onGenerationComplete: (
		pendingId: string,
		assets: GenerationAsset[],
		sourceTaskId: string,
	) => void;
	onGenerationError: (pendingId: string) => void;
	onGenerationResponse: (pendingId: string, response: GenerationMessageResponse) => void;
	onGenerationStart: (pendingId: string, prompt: string) => void;
	onMaterialLibraryImportOpenChange: (open: boolean) => void;
	onOpenChange: (open: boolean) => void;
	onOpenMaterialLibrary: () => void;
	onOpenReferenceGeneration: (section: MarkdownSectionContext) => void;
	onToggleImage?: (asset: GenerationAsset, selected: boolean) => void;
	open: boolean;
	projectId?: string;
	resolveLatestSection?: boolean;
	section: MarkdownSectionContext;
	selectedAssetKeys: string[];
	selectedGenerationAssets?: SelectedGenerationAsset[];
	title: string;
	titleId: string;
}

export const ImageGenerationDialog: React.FC<ImageGenerationDialogProps> = (props) => {
	const controller = useImageGenerationDialogController(props);
	return <ImageGenerationDialogView controller={controller} />;
};

const useImageGenerationDialogController = ({
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onToggleImage,
	open,
	onOpenChange,
	projectId,
	resolveLatestSection,
	selectedAssetKeys,
	selectedGenerationAssets,
	section,
}: ImageGenerationDialogProps): ImageGenerationDialogController => {
	const [lastSection, setLastSection] = useState<MarkdownSectionContext | null>(section);
	const [referenceSections, setReferenceSections] = useState<MarkdownSectionContext[]>([]);
	const [materialLibraryOpenByDialog, setMaterialLibraryOpenByDialog] = useState<
		Record<string, boolean>
	>({});

	useEffect(() => {
		if (section) setLastSection(section);
	}, [section]);

	const dialogSection = section ?? lastSection;
	const dialogSectionKey = dialogSection ? sectionGenerationIdentityKey(dialogSection) : "";

	useEffect(() => {
		if (!open) {
			clearDialogStackState(setMaterialLibraryOpenByDialog, setReferenceSections);
		}
	}, [open]);

	useEffect(() => {
		clearDialogStackState(setMaterialLibraryOpenByDialog, setReferenceSections);
	}, [dialogSectionKey]);

	const setDialogMaterialLibraryOpen = useCallback((dialogId: string, nextOpen: boolean) => {
		setMaterialLibraryOpenByDialog((current) => {
			if (!nextOpen) {
				const { [dialogId]: _removed, ...rest } = current;
				if (Object.keys(rest).length === Object.keys(current).length) return current;
				return rest;
			}
			if (current[dialogId]) return current;
			return { ...current, [dialogId]: true };
		});
	}, []);

	const closeReferenceDialog = useCallback((referenceIndex: number) => {
		setReferenceSections((current) =>
			current.length === referenceIndex ? current : current.slice(0, referenceIndex),
		);
		clearMaterialLibraryOpenState(setMaterialLibraryOpenByDialog);
	}, []);

	const openReferenceGenerationDialog = useCallback(
		(dialogIndex: number, nextSection: MarkdownSectionContext) => {
			setReferenceSections((current) => {
				const next = [...current.slice(0, dialogIndex), nextSection];
				return sameSectionStack(current, next) ? current : next;
			});
			clearMaterialLibraryOpenState(setMaterialLibraryOpenByDialog);
		},
		[],
	);

	if (!dialogSection) return { dialogs: [] };

	const sections = [dialogSection, ...referenceSections];

	return {
		dialogs: sections.map((currentSection, dialogIndex) => {
			const sectionKey = sectionGenerationIdentityKey(currentSection);
			const dialogId = `${dialogIndex}:${sectionKey}`;

			return {
				dialogId,
				generatorKey: `${sectionKey}:${currentSection.markdown}`,
				materialLibraryOpen: Boolean(materialLibraryOpenByDialog[dialogId]),
				onGenerationComplete: (pendingId, assets, sourceTaskId) =>
					onGenerationComplete(currentSection, pendingId, assets, sourceTaskId),
				onGenerationError: (pendingId) => onGenerationError(currentSection, pendingId),
				onGenerationResponse: (pendingId, response) =>
					onGenerationResponse?.(currentSection, pendingId, response),
				onGenerationStart: (pendingId, prompt) =>
					onGenerationStart(currentSection, pendingId, prompt),
				onMaterialLibraryImportOpenChange: (nextOpen) =>
					setDialogMaterialLibraryOpen(dialogId, nextOpen),
				onOpenChange: (nextOpen) => {
					if (dialogIndex === 0) {
						onOpenChange(nextOpen);
						return;
					}
					if (!nextOpen) closeReferenceDialog(dialogIndex - 1);
				},
				onOpenMaterialLibrary: () => setDialogMaterialLibraryOpen(dialogId, true),
				onOpenReferenceGeneration: (nextSection) =>
					openReferenceGenerationDialog(dialogIndex, nextSection),
				onToggleImage: onToggleImage
					? (asset, selected) => onToggleImage(currentSection, asset, selected)
					: undefined,
				open: dialogIndex === 0 ? open : true,
				projectId,
				resolveLatestSection,
				section: currentSection,
				selectedAssetKeys: resolveSelectedAssetKeys(selectedAssetKeys, currentSection),
				selectedGenerationAssets,
				title: `生成视觉素材 · ${currentSection.headingText}`,
				titleId: `section-generation-title-${dialogIndex}`,
			};
		}),
	};
};

const ImageGenerationDialogView: React.FC<{ controller: ImageGenerationDialogController }> = ({
	controller,
}) => (
	<>
		{controller.dialogs.map((dialog) => (
			<ImageGenerationDialogPanel key={dialog.dialogId} controller={dialog} />
		))}
	</>
);

const ImageGenerationDialogPanel: React.FC<{
	controller: ImageGenerationDialogPanelController;
}> = ({ controller }) => (
	<GenerationModalShell
		open={controller.open}
		title={controller.title}
		titleId={controller.titleId}
		titleAside={
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-8 shrink-0 rounded-md px-2.5 text-xs active:border-primary focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
				onClick={controller.onOpenMaterialLibrary}
			>
				<Images className="size-4" />
				<span>从素材库中选择</span>
			</Button>
		}
		onOpenChange={controller.onOpenChange}
	>
		<DocumentSectionGenerator
			key={controller.generatorKey}
			materialLibraryImportOpen={controller.materialLibraryOpen}
			projectId={controller.projectId}
			resolveLatestSection={controller.resolveLatestSection}
			section={controller.section}
			selectedAssetKeys={controller.selectedAssetKeys}
			selectedGenerationAssets={controller.selectedGenerationAssets}
			viewMode="history"
			onGenerationComplete={controller.onGenerationComplete}
			onGenerationError={controller.onGenerationError}
			onGenerationResponse={controller.onGenerationResponse}
			onGenerationStart={controller.onGenerationStart}
			onMaterialLibraryImportOpenChange={controller.onMaterialLibraryImportOpenChange}
			onOpenReferenceGeneration={controller.onOpenReferenceGeneration}
			onToggleAsset={controller.onToggleImage}
		/>
	</GenerationModalShell>
);

const resolveSelectedAssetKeys = (
	selectedAssetKeys: ImageGenerationDialogProps["selectedAssetKeys"],
	section: MarkdownSectionContext,
) =>
	typeof selectedAssetKeys === "function" ? selectedAssetKeys(section) : (selectedAssetKeys ?? []);

const clearDialogStackState = (
	setMaterialLibraryOpenByDialog: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
	setReferenceSections: React.Dispatch<React.SetStateAction<MarkdownSectionContext[]>>,
) => {
	clearMaterialLibraryOpenState(setMaterialLibraryOpenByDialog);
	setReferenceSections((current) => (current.length === 0 ? current : []));
};

const clearMaterialLibraryOpenState = (
	setMaterialLibraryOpenByDialog: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
) => {
	setMaterialLibraryOpenByDialog((current) => (Object.keys(current).length === 0 ? current : {}));
};

const sameSectionStack = (current: MarkdownSectionContext[], next: MarkdownSectionContext[]) => {
	if (current.length !== next.length) return false;
	return current.every(
		(section, index) =>
			sectionGenerationIdentityKey(section) === sectionGenerationIdentityKey(next[index]),
	);
};
