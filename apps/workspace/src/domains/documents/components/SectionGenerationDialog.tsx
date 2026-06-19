import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Images } from "lucide-react";
import type {
	GenerationAsset,
	GenerationMessageResponse,
} from "@/domains/generation/api/generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { DocumentSectionGenerator } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { sectionGenerationIdentityKey } from "@/domains/documents/lib/section-generation";
import { Button } from "@/shared/components/ui/button";

interface SectionGenerationDialogProps {
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
	onToggleImage: (
		section: MarkdownSectionContext,
		asset: GenerationAsset,
		selected: boolean,
	) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId?: string;
	selectedAssetKeys?: string[] | ((section: MarkdownSectionContext) => string[]);
	section: MarkdownSectionContext | null;
}

interface SectionGenerationDialogController {
	dialogs: SectionGenerationDialogPanelController[];
}

interface SectionGenerationDialogPanelController {
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
	onToggleImage: (asset: GenerationAsset, selected: boolean) => void;
	open: boolean;
	projectId?: string;
	section: MarkdownSectionContext;
	selectedAssetKeys: string[];
	title: string;
	titleId: string;
}

export const SectionGenerationDialog: React.FC<SectionGenerationDialogProps> = (props) => {
	const controller = useSectionGenerationDialogController(props);
	return <SectionGenerationDialogView controller={controller} />;
};

const useSectionGenerationDialogController = ({
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onToggleImage,
	open,
	onOpenChange,
	projectId,
	selectedAssetKeys,
	section,
}: SectionGenerationDialogProps): SectionGenerationDialogController => {
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
			setMaterialLibraryOpenByDialog({});
			setReferenceSections([]);
		}
	}, [open]);

	useEffect(() => {
		setMaterialLibraryOpenByDialog({});
		setReferenceSections([]);
	}, [dialogSectionKey]);

	const setDialogMaterialLibraryOpen = useCallback((dialogId: string, nextOpen: boolean) => {
		setMaterialLibraryOpenByDialog((current) => {
			if (!nextOpen) {
				const { [dialogId]: _removed, ...rest } = current;
				return rest;
			}
			return { ...current, [dialogId]: true };
		});
	}, []);

	const closeReferenceDialog = useCallback((referenceIndex: number) => {
		setReferenceSections((current) => current.slice(0, referenceIndex));
		setMaterialLibraryOpenByDialog({});
	}, []);

	const openReferenceGenerationDialog = useCallback(
		(dialogIndex: number, nextSection: MarkdownSectionContext) => {
			setReferenceSections((current) => [...current.slice(0, dialogIndex), nextSection]);
			setMaterialLibraryOpenByDialog({});
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
				onToggleImage: (asset, selected) => onToggleImage(currentSection, asset, selected),
				open: dialogIndex === 0 ? open : true,
				projectId,
				section: currentSection,
				selectedAssetKeys: resolveSelectedAssetKeys(selectedAssetKeys, currentSection),
				title: `生成视觉素材 · ${currentSection.headingText}`,
				titleId: `section-generation-title-${dialogIndex}`,
			};
		}),
	};
};

const SectionGenerationDialogView: React.FC<{ controller: SectionGenerationDialogController }> = ({
	controller,
}) => (
	<>
		{controller.dialogs.map((dialog) => (
			<SectionGenerationDialogPanel key={dialog.dialogId} controller={dialog} />
		))}
	</>
);

const SectionGenerationDialogPanel: React.FC<{
	controller: SectionGenerationDialogPanelController;
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
				className="h-8 shrink-0 rounded-md px-2.5 text-xs"
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
			section={controller.section}
			selectedAssetKeys={controller.selectedAssetKeys}
			viewMode="history"
			onGenerationComplete={controller.onGenerationComplete}
			onGenerationError={controller.onGenerationError}
			onGenerationResponse={controller.onGenerationResponse}
			onGenerationStart={controller.onGenerationStart}
			onMaterialLibraryImportOpenChange={controller.onMaterialLibraryImportOpenChange}
			onOpenReferenceGeneration={controller.onOpenReferenceGeneration}
			onToggleImage={controller.onToggleImage}
		/>
	</GenerationModalShell>
);

const resolveSelectedAssetKeys = (
	selectedAssetKeys: SectionGenerationDialogProps["selectedAssetKeys"],
	section: MarkdownSectionContext,
) =>
	typeof selectedAssetKeys === "function" ? selectedAssetKeys(section) : (selectedAssetKeys ?? []);
