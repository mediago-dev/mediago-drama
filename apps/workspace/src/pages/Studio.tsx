import type React from "react";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Image, Video } from "lucide-react";
import useSWR from "swr";
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
	const navigate = useNavigate();
	const entries = [
		{
			description: "角色、场景、产品、关键帧和参考图迁移后的画面。",
			icon: Image,
			kind: "image",
			label: "图片生成",
		},
		{
			description: "镜头动态、图生视频、动作和运镜测试。",
			icon: Video,
			kind: "video",
			label: "视频生成",
		},
	] as const;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto max-w-5xl">
					<header className="border-b border-border/70 pb-5">
						<p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							Create
						</p>
						<h1 className="mt-1 text-xl font-semibold text-foreground">生成中心</h1>
						<p className="mt-1.5 text-xs leading-5 text-muted-foreground">
							快速生成独立素材；正式镜头请从项目内发起，系统会自动保存资产、版本和镜头关系。
						</p>
					</header>
					<div className="mt-5 grid gap-4 sm:grid-cols-2">
						{entries.map((entry) => {
							const Icon = entry.icon;
							return (
								<button
									key={entry.kind}
									type="button"
									className={`creator-launch-card creator-launch-card-${entry.kind} group flex min-h-36 w-full items-center gap-4 rounded-xl border border-white/80 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
									onClick={() => navigate(studioTabPath(entry.kind))}
								>
									<span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/80 text-primary shadow-sm">
										<Icon className="size-5" />
									</span>
									<span className="min-w-0 flex-1">
										<strong className="block text-sm font-medium text-foreground">
											{entry.label}
										</strong>
										<span className="mt-1 block text-xs leading-5 text-muted-foreground">
											{entry.description}
										</span>
									</span>
									<span className="text-xs text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground">
										打开 →
									</span>
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
};

export const StudioImage: React.FC = () => <StudioGenerationPage kind="image" />;

export const StudioVideo: React.FC = () => <StudioGenerationPage kind="video" />;

export const StudioText: React.FC = () => <StudioGenerationPage kind="text" />;

export const StudioAudio: React.FC = () => <StudioGenerationPage kind="audio" />;

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
							<span className="text-xs font-medium text-muted-foreground">即将上线</span>
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
