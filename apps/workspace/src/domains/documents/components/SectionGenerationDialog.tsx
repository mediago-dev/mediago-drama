import type React from "react";
import { useEffect, useState } from "react";
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
	selectedAssetKeys?: string[];
	section: MarkdownSectionContext | null;
}

export const SectionGenerationDialog: React.FC<SectionGenerationDialogProps> = ({
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onOpenReferenceGeneration,
	onToggleImage,
	open,
	onOpenChange,
	projectId,
	selectedAssetKeys,
	section,
}) => {
	const [lastSection, setLastSection] = useState<MarkdownSectionContext | null>(section);
	const [materialLibraryOpen, setMaterialLibraryOpen] = useState(false);

	useEffect(() => {
		if (section) setLastSection(section);
	}, [section]);

	const dialogSection = section ?? lastSection;
	const dialogSectionKey = dialogSection ? sectionGenerationIdentityKey(dialogSection) : "";

	useEffect(() => {
		if (!open) setMaterialLibraryOpen(false);
	}, [open]);

	useEffect(() => {
		setMaterialLibraryOpen(false);
	}, [dialogSectionKey]);

	if (!dialogSection) return null;

	return (
		<GenerationModalShell
			open={open}
			title={`生成视觉素材 · ${dialogSection.headingText}`}
			titleId="section-generation-title"
			titleAside={
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-8 shrink-0 rounded-md px-2.5 text-xs"
					onClick={() => setMaterialLibraryOpen(true)}
				>
					<Images className="size-4" />
					<span>从素材库中选择</span>
				</Button>
			}
			onOpenChange={onOpenChange}
		>
			<DocumentSectionGenerator
				key={`${sectionGenerationIdentityKey(dialogSection)}:${dialogSection.markdown}`}
				materialLibraryImportOpen={materialLibraryOpen}
				projectId={projectId}
				section={dialogSection}
				selectedAssetKeys={selectedAssetKeys ?? []}
				viewMode="history"
				onGenerationComplete={(pendingId, assets, sourceTaskId) =>
					onGenerationComplete(dialogSection, pendingId, assets, sourceTaskId)
				}
				onGenerationError={(pendingId) => onGenerationError(dialogSection, pendingId)}
				onGenerationResponse={(pendingId, response) =>
					onGenerationResponse?.(dialogSection, pendingId, response)
				}
				onGenerationStart={(pendingId, prompt) =>
					onGenerationStart(dialogSection, pendingId, prompt)
				}
				onMaterialLibraryImportOpenChange={setMaterialLibraryOpen}
				onOpenReferenceGeneration={onOpenReferenceGeneration}
				onToggleImage={(asset, selected) => onToggleImage(dialogSection, asset, selected)}
			/>
		</GenerationModalShell>
	);
};
