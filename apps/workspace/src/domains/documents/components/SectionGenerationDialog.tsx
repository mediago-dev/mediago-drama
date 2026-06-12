import type React from "react";
import { useEffect, useState } from "react";
import type {
	GenerationAsset,
	GenerationMessageResponse,
} from "@/domains/generation/api/generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { DocumentSectionGenerator } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { sectionGenerationIdentityKey } from "@/domains/documents/lib/section-generation";
import type { MediaGenerationWorkspaceViewMode } from "@/domains/generation/components/MediaGenerationWorkspace";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

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
	onToggleImage,
	open,
	onOpenChange,
	projectId,
	selectedAssetKeys,
	section,
}) => {
	const [lastSection, setLastSection] = useState<MarkdownSectionContext | null>(section);
	const [viewMode, setViewMode] = useState<MediaGenerationWorkspaceViewMode>("edit");
	const [historyCount, setHistoryCount] = useState(0);

	useEffect(() => {
		if (section) setLastSection(section);
	}, [section]);

	useEffect(() => {
		if (open) setViewMode("edit");
	}, [open, section?.blockId, section?.documentId, section?.headingOccurrence]);

	const dialogSection = section ?? lastSection;
	if (!dialogSection) return null;

	return (
		<GenerationModalShell
			open={open}
			title={`生成视觉素材 · ${dialogSection.headingText}`}
			titleAside={
				<SectionGenerationViewTabs
					historyCount={historyCount}
					value={viewMode}
					onValueChange={setViewMode}
				/>
			}
			titleId="section-generation-title"
			onOpenChange={onOpenChange}
		>
			<DocumentSectionGenerator
				key={`${sectionGenerationIdentityKey(dialogSection)}:${dialogSection.markdown}`}
				projectId={projectId}
				section={dialogSection}
				selectedAssetKeys={selectedAssetKeys ?? []}
				viewMode={viewMode}
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
				onHistoryCountChange={setHistoryCount}
				onToggleImage={(asset, selected) => onToggleImage(dialogSection, asset, selected)}
				onViewModeChange={setViewMode}
			/>
		</GenerationModalShell>
	);
};

const SectionGenerationViewTabs: React.FC<{
	historyCount: number;
	onValueChange: (value: MediaGenerationWorkspaceViewMode) => void;
	value: MediaGenerationWorkspaceViewMode;
}> = ({ historyCount, onValueChange, value }) => (
	<Tabs
		value={value}
		onValueChange={(nextValue) => onValueChange(nextValue as MediaGenerationWorkspaceViewMode)}
	>
		<TabsList className="h-7">
			<TabsTrigger value="history" className="h-5 px-2">
				历史记录 {historyCount}
			</TabsTrigger>
			<TabsTrigger value="edit" className="h-5 px-2">
				编辑
			</TabsTrigger>
		</TabsList>
	</Tabs>
);
