import type React from "react";
import { useEffect, useState } from "react";
import { Images } from "lucide-react";
import type { GenerationAsset, SelectedGenerationAsset } from "@/domains/generation/api/generation";
import {
	AudioReferenceSelectionPanel,
	type AudioReferenceSelectionTab,
} from "@/shared/components/generation-dialogs/AudioReferenceSelectionPanel";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { GlobalToolboxButton } from "@/domains/workspace/components/GlobalToolboxDrawer";
import { Button } from "@/shared/components/ui/button";

interface AudioGenerationDialogProps {
	onAssetSelectionPersisted?: () => void;
	onCommitAssetSelection?: (asset: GenerationAsset | null) => Promise<void> | void;
	onGenerationComplete?: (
		pendingId: string,
		assets: GenerationAsset[],
		sourceTaskId: string,
	) => void;
	onGenerationError?: (pendingId: string) => void;
	onGenerationStart?: (pendingId: string, prompt: string) => void;
	onOpenChange: (open: boolean) => void;
	onOpenReferenceGeneration?: (section: MarkdownSectionContext) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	open: boolean;
	projectId?: string;
	resolveLatestSection?: boolean;
	selectedAssetKeys?: string[];
	selectedGenerationAssets?: SelectedGenerationAsset[];
	section: MarkdownSectionContext | null;
	title?: string;
	titleId?: string;
}

const defaultAudioTitleId = "audio-generation-title";

export const AudioGenerationDialog: React.FC<AudioGenerationDialogProps> = ({
	onCommitAssetSelection,
	onOpenChange,
	onToggleAsset,
	open,
	projectId,
	selectedAssetKeys,
	section,
	title,
	titleId = defaultAudioTitleId,
}) => {
	const [lastSection, setLastSection] = useState<MarkdownSectionContext | null>(section);
	const [activeTab, setActiveTab] = useState<AudioReferenceSelectionTab>("all");
	const [materialLibraryOpen, setMaterialLibraryOpen] = useState(false);

	useEffect(() => {
		if (section) setLastSection(section);
	}, [section]);

	useEffect(() => {
		if (!open) {
			setActiveTab("all");
			setMaterialLibraryOpen(false);
		}
	}, [open]);

	const activeSection = section ?? lastSection;
	if (!activeSection) return null;

	return (
		<GenerationModalShell
			open={open}
			title={title ?? `选择音频素材 · ${activeSection.headingText}`}
			titleId={titleId}
			titleAside={
				<div className="flex items-center gap-2">
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
					<GlobalToolboxButton kind="audio" variant="inline" />
				</div>
			}
			onOpenChange={onOpenChange}
		>
			<AudioReferenceSelectionPanel
				activeTab={activeTab}
				open={open}
				materialLibraryOpen={materialLibraryOpen}
				projectId={projectId}
				selectedAssetKeys={selectedAssetKeys}
				onActiveTabChange={setActiveTab}
				onCancelSelection={() => onOpenChange(false)}
				onConfirmSelection={async (asset) => {
					if (onCommitAssetSelection) {
						await onCommitAssetSelection(asset);
						return;
					}
					if (asset) onToggleAsset?.(asset, true);
				}}
				onMaterialLibraryOpenChange={setMaterialLibraryOpen}
			/>
		</GenerationModalShell>
	);
};
