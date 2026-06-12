import type React from "react";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { CapabilityGrid } from "@/domains/capabilities/components/CapabilityGrid";
import {
	defaultGenerationConversationScopeId,
	generationConversationsQueryKey,
	getGenerationConversations,
} from "@/domains/generation/api/generation";
import { GenerationWorkspace } from "@/domains/generation/components/GenerationWorkspace";
import { studioTabPath } from "@/domains/workspace/lib/workbench-route";
import type { StudioTab } from "@/domains/workspace/components/ProjectNavigatorTypes";
import { useWorkModeStore } from "@/lib/stores/work-mode";

export const StudioHome: React.FC = () => {
	useStudioMode();

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<CapabilityGrid projectMode={false} />
		</div>
	);
};

export const StudioImage: React.FC = () => <StudioGenerationPage kind="image" />;

export const StudioVideo: React.FC = () => <StudioGenerationPage kind="video" />;

export const StudioText: React.FC = () => <StudioGenerationPage kind="text" />;

export const StudioNovelUnderstand: React.FC = () => <StudioComingSoonPage title="小说理解" />;

export const StudioVideoUnderstand: React.FC = () => <StudioComingSoonPage title="视频理解" />;

export const StudioAudioTranscribe: React.FC = () => <StudioComingSoonPage title="音频转录" />;

const StudioGenerationPage: React.FC<{ kind: StudioTab }> = ({ kind }) => {
	useStudioMode();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const conversationId = searchParams.get("conversation");
	const { data } = useSWR(
		generationConversationsQueryKey(kind, defaultGenerationConversationScopeId, {
			allScopes: true,
		}),
		() =>
			getGenerationConversations(kind, defaultGenerationConversationScopeId, { allScopes: true }),
	);
	const latestConversationId = data?.conversations[0]?.id ?? "";
	const activeConversation = data?.conversations.find(
		(conversation) => conversation.id === conversationId,
	);

	useEffect(() => {
		if (conversationId || !latestConversationId) return;
		navigate(studioTabPath(kind, { conversationId: latestConversationId }), { replace: true });
	}, [conversationId, kind, latestConversationId, navigate]);

	if (!conversationId) {
		return (
			<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground" />
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<GenerationWorkspace
				conversationId={conversationId}
				conversationScopeId={activeConversation?.scopeId ?? defaultGenerationConversationScopeId}
				initialKind={kind}
				lockKind
				projectHistory={false}
				requireConversation
				uploadIdPrefix={`studio-${kind}-generation`}
			/>
		</div>
	);
};

const StudioComingSoonPage: React.FC<{ title: string }> = ({ title }) => {
	useStudioMode();

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
				<div className="mx-auto max-w-6xl">
					<section className="rounded-sm border border-border bg-card px-4 py-6 text-foreground">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<h1 className="text-base font-semibold">{title}</h1>
							<span className="text-xs font-medium text-muted-foreground">Coming soon</span>
						</div>
						<p className="mt-2 text-xs leading-5 text-muted-foreground">
							该能力暂未开放，当前仅保留前端入口状态。
						</p>
					</section>
				</div>
			</div>
		</div>
	);
};

const useStudioMode = () => {
	const setWorkMode = useWorkModeStore((state) => state.setMode);

	useEffect(() => {
		setWorkMode("studio");
	}, [setWorkMode]);
};
