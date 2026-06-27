import type React from "react";
import { useEffect, useState } from "react";
import { Images } from "lucide-react";
import type { GenerationAsset, SelectedGenerationAsset } from "@/domains/generation/api/generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { DocumentSectionGenerator } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	MediaGenerationWorkspace,
	type MediaGenerationWorkspaceProps,
} from "@/domains/generation/components/MediaGenerationWorkspace";
import { Button } from "@/shared/components/ui/button";

type VideoWorkspaceProps = Omit<MediaGenerationWorkspaceProps, "kind">;

interface VideoGenerationDialogProps {
	onAssetSelectionPersisted?: () => void;
	onOpenChange: (open: boolean) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	open: boolean;
	projectId?: string;
	resolveLatestSection?: boolean;
	selectedAssetKeys?: string[];
	selectedGenerationAssets?: SelectedGenerationAsset[];
	section?: MarkdownSectionContext | null;
	title?: string;
	titleId?: string;
	workspaceProps?: VideoWorkspaceProps;
}

const defaultVideoTitleId = "video-generation-title";

export const VideoGenerationDialog: React.FC<VideoGenerationDialogProps> = ({
	onAssetSelectionPersisted,
	onOpenChange,
	onOpenReferenceGeneration,
	onToggleAsset,
	open,
	projectId,
	resolveLatestSection,
	selectedAssetKeys,
	selectedGenerationAssets,
	section,
	title,
	titleId = defaultVideoTitleId,
	workspaceProps,
}) => {
	const [lastSection, setLastSection] = useState<MarkdownSectionContext | null>(section ?? null);
	const [materialLibraryOpen, setMaterialLibraryOpen] = useState(false);

	useEffect(() => {
		if (section) setLastSection(section);
	}, [section]);

	useEffect(() => {
		if (!open) setMaterialLibraryOpen(false);
	}, [open]);

	if (workspaceProps) {
		return (
			<GenerationModalShell
				open={open}
				title={title ?? "生成视频"}
				titleId={titleId}
				onOpenChange={onOpenChange}
			>
				<MediaGenerationWorkspace {...workspaceProps} kind="video" />
			</GenerationModalShell>
		);
	}

	const activeSection = section ?? lastSection;
	if (!activeSection) return null;

	return (
		<GenerationModalShell
			open={open}
			title={title ?? `生成视频素材 · ${activeSection.headingText}`}
			titleId={titleId}
			titleAside={
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-8 shrink-0 rounded-md px-2.5 text-xs active:border-primary focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
					onClick={() => setMaterialLibraryOpen(true)}
				>
					<Images className="size-4" />
					<span>从素材库中选择</span>
				</Button>
			}
			onOpenChange={onOpenChange}
		>
			<DocumentSectionGenerator
				kind="video"
				materialLibraryImportOpen={materialLibraryOpen}
				projectId={projectId}
				resolveLatestSection={resolveLatestSection}
				section={activeSection}
				selectedAssetKeys={selectedAssetKeys}
				selectedGenerationAssets={selectedGenerationAssets}
				viewMode="history"
				onAssetSelectionPersisted={onAssetSelectionPersisted}
				onGenerationComplete={() => undefined}
				onGenerationError={() => undefined}
				onGenerationStart={() => undefined}
				onMaterialLibraryImportOpenChange={setMaterialLibraryOpen}
				onOpenReferenceGeneration={onOpenReferenceGeneration}
				onToggleAsset={onToggleAsset}
			/>
		</GenerationModalShell>
	);
};
