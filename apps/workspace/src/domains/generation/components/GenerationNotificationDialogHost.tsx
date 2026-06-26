import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	type GenerationNotificationOpenKind,
	type PendingGenerationNotificationOpenRequest,
	useGenerationNotificationStore,
} from "@/domains/generation/stores/generation-notifications";
import { AudioGenerationDialog } from "@/shared/components/generation-dialogs/AudioGenerationDialog";
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";

interface ActiveNotificationGeneration {
	kind: GenerationNotificationOpenKind;
	projectId: string;
	section: MarkdownSectionContext;
}

export const GenerationNotificationDialogHost: React.FC = () => {
	const pendingOpenRequest = useGenerationNotificationStore((state) => state.pendingOpenRequest);
	const consumeOpenRequest = useGenerationNotificationStore((state) => state.consumeOpenRequest);
	const [activeGeneration, setActiveGeneration] = useState<ActiveNotificationGeneration | null>(
		null,
	);

	useEffect(() => {
		if (!pendingOpenRequest) return;

		setActiveGeneration(activeGenerationFromOpenRequest(pendingOpenRequest));
		consumeOpenRequest(pendingOpenRequest.notificationId);
	}, [consumeOpenRequest, pendingOpenRequest]);

	const closeGeneration = useCallback((open: boolean) => {
		if (!open) setActiveGeneration(null);
	}, []);
	const openReferenceGeneration = useCallback((section: MarkdownSectionContext) => {
		setActiveGeneration((current) => (current ? { ...current, kind: "image", section } : null));
	}, []);

	return (
		<>
			<ImageGenerationDialog
				open={activeGeneration?.kind === "image"}
				projectId={activeGeneration?.projectId}
				resolveLatestSection={false}
				section={activeGeneration?.kind === "image" ? activeGeneration.section : null}
				onGenerationComplete={() => undefined}
				onGenerationError={() => undefined}
				onGenerationStart={() => undefined}
				onOpenChange={closeGeneration}
			/>
			<VideoGenerationDialog
				open={activeGeneration?.kind === "video"}
				projectId={activeGeneration?.projectId}
				resolveLatestSection={false}
				section={activeGeneration?.kind === "video" ? activeGeneration.section : null}
				onOpenChange={closeGeneration}
				onOpenReferenceGeneration={openReferenceGeneration}
			/>
			<AudioGenerationDialog
				open={activeGeneration?.kind === "audio"}
				projectId={activeGeneration?.projectId}
				resolveLatestSection={false}
				section={activeGeneration?.kind === "audio" ? activeGeneration.section : null}
				onOpenChange={closeGeneration}
				onOpenReferenceGeneration={openReferenceGeneration}
			/>
		</>
	);
};

const activeGenerationFromOpenRequest = (
	request: PendingGenerationNotificationOpenRequest,
): ActiveNotificationGeneration => ({
	kind: request.kind,
	projectId: request.target.projectId,
	section: request.target.section,
});
