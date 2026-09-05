import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
	ChevronDown,
	Clapperboard,
	Film,
	Image as ImageIcon,
	Layers3,
	Link2,
	Lock,
	MoreHorizontal,
	Play,
	ShieldCheck,
} from "lucide-react";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import type { ProjectProductionState, ProjectShotRecord } from "@/domains/projects/api/projects";
import type { ProjectProductionContext } from "@/lib/production/project-context";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import {
	buildCreatorWorkspaceView,
	type CreatorShotView,
} from "@/domains/creator/lib/creator-workspace-adapter";

interface CreatorProjectWorkspaceProps {
	assets: SelectedGenerationAsset[];
	context: ProjectProductionContext;
	onGenerate: (kind: "image" | "video", shot: ProjectShotRecord) => void;
	onOpenWorkspace: () => void;
	onProductionPatch: (patch: Partial<ProjectProductionState>) => void | Promise<void>;
}

export const CreatorProjectWorkspace: React.FC<CreatorProjectWorkspaceProps> = ({
	assets,
	context,
	onGenerate,
	onOpenWorkspace,
	onProductionPatch,
}) => {
	const production = context.production;
	const [activeShotId, setActiveShotId] = useState<string | null>(null);
	const view = useMemo(
		() =>
			buildCreatorWorkspaceView({
				shots: production?.shots,
				graph: production?.productionGraph,
				versions: production?.versions,
				qcResults: production?.qcResults,
				assets,
				activeShotId,
			}),
		[activeShotId, assets, production],
	);

	useEffect(() => {
		if (!activeShotId && view.activeShot) setActiveShotId(view.activeShot.shot.id);
	}, [activeShotId, view.activeShot]);

	const updateShot = async (shotId: string, patch: Partial<ProjectShotRecord>) => {
		if (!production) return;
		await onProductionPatch({
			shots: (production.shots ?? []).map((shot) =>
				shot.id === shotId ? { ...shot, ...patch, updatedAt: new Date().toISOString() } : shot,
			),
		});
	};

	return (
		<div className="flex h-full min-h-[680px] flex-col overflow-hidden bg-ide-editor">
			<header className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-foreground">{context.name}</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-muted-foreground">镜头工作台</span>
					<Button size="sm" variant="ghost" onClick={onOpenWorkspace}>
						返回制作流程
					</Button>
					<Button size="sm" variant="ghost" aria-label="更多">
						<MoreHorizontal className="size-4" />
					</Button>
				</div>
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-[176px_minmax(360px,1fr)_340px]">
				<ShotRail
					shots={view.shots}
					activeShotId={view.activeShot?.shot.id}
					onSelect={setActiveShotId}
				/>
				<MediaViewport shot={view.activeShot} />
				<ShotInspector shot={view.activeShot} onChange={updateShot} onGenerate={onGenerate} />
			</div>

			<CreatorTimeline
				shots={view.shots}
				activeShotId={view.activeShot?.shot.id}
				onSelect={setActiveShotId}
			/>
		</div>
	);
};

interface ShotRailProps {
	shots: CreatorShotView[];
	activeShotId?: string;
	onSelect: (shotId: string) => void;
}

export const ShotRail: React.FC<ShotRailProps> = ({ shots, activeShotId, onSelect }) => (
	<aside className="min-h-0 overflow-y-auto border-r border-border/70 bg-ide-sidebar/55 p-2">
		<div className="flex items-center justify-between px-2 py-2">
			<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
				镜头
			</span>
			<span className="text-[11px] tabular-nums text-muted-foreground">{shots.length}</span>
		</div>
		<div className="space-y-1">
			{shots.map((item) => {
				const selected = item.shot.id === activeShotId;
				return (
					<button
						key={item.shot.id}
						type="button"
						onClick={() => onSelect(item.shot.id)}
						className={cn(
							"flex w-full items-center gap-2 px-2 py-2 text-left transition-colors",
							selected
								? "bg-primary/12 text-foreground"
								: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
						)}
					>
						<div className="grid size-9 shrink-0 place-items-center overflow-hidden bg-muted">
							{item.media[0]?.kind === "image" ? (
								<img src={item.media[0].source} alt="" className="size-full object-cover" />
							) : (
								<Clapperboard className="size-4 opacity-55" />
							)}
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-xs font-semibold">{item.shot.shotCode}</p>
							<p className="truncate text-[11px] opacity-70">{item.shot.title}</p>
						</div>
						{item.qc.some((qc) => qc.status !== "PASS") ? (
							<span
								className="size-1.5 rounded-full bg-warning-foreground"
								title="存在待处理审核项"
							/>
						) : null}
					</button>
				);
			})}
			{shots.length === 0 ? (
				<p className="px-2 py-8 text-center text-xs text-muted-foreground">尚无镜头</p>
			) : null}
		</div>
	</aside>
);

export const MediaViewport: React.FC<{ shot?: CreatorShotView }> = ({ shot }) => {
	const [mediaIndex, setMediaIndex] = useState(0);
	useEffect(() => setMediaIndex(0), [shot?.shot.id]);
	const media = shot?.media[mediaIndex] ?? shot?.media[0];
	return (
		<section className="relative flex min-h-0 flex-col bg-ide-editor">
			<div className="flex min-h-0 flex-1 items-center justify-center p-5">
				<div className="relative flex aspect-video max-h-full w-full max-w-5xl items-center justify-center overflow-hidden bg-background shadow-2xl">
					{media?.kind === "image" ? (
						<img src={media.source} alt={media.title} className="size-full object-contain" />
					) : null}
					{media?.kind === "video" ? (
						<video src={media.source} controls className="size-full object-contain" />
					) : null}
					{!media ? (
						<div className="flex flex-col items-center gap-3 text-muted-foreground">
							<ImageIcon className="size-10 opacity-35" />
							<p className="text-xs">
								{shot ? "生成或绑定画面后将在这里预览" : "选择一个镜头开始创作"}
							</p>
						</div>
					) : null}
				</div>
			</div>
			{shot && shot.media.length > 1 ? (
				<div className="flex h-16 shrink-0 items-center justify-center gap-2 border-t border-border/60 px-3">
					{shot.media.map((item, index) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setMediaIndex(index)}
							className={cn(
								"h-10 w-16 overflow-hidden bg-muted",
								index === mediaIndex && "ring-2 ring-primary",
							)}
						>
							{item.kind === "image" ? (
								<img src={item.source} alt="" className="size-full object-cover" />
							) : (
								<Play className="m-auto size-4" />
							)}
						</button>
					))}
				</div>
			) : null}
		</section>
	);
};

interface ShotInspectorProps {
	shot?: CreatorShotView;
	onChange: (shotId: string, patch: Partial<ProjectShotRecord>) => void | Promise<void>;
	onGenerate: (kind: "image" | "video", shot: ProjectShotRecord) => void;
}

export const ShotInspector: React.FC<ShotInspectorProps> = ({ shot, onChange, onGenerate }) => {
	if (!shot) return <aside className="border-l border-border/70 bg-ide-sidebar/35" />;
	const record = shot.shot;
	return (
		<aside className="min-h-0 overflow-y-auto border-l border-border/70 bg-ide-sidebar/35">
			<div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-ide-sidebar/95 px-4 py-3 backdrop-blur">
				<div>
					<p className="text-sm font-semibold">{record.shotCode}</p>
					<p className="max-w-56 truncate text-[11px] text-muted-foreground">{record.title}</p>
				</div>
				<span className="text-[11px] text-muted-foreground">{record.completion || 0}%</span>
			</div>
			<div className="space-y-5 p-4">
				<InspectorTextarea
					label="画面 Prompt"
					value={record.executionPrompt ?? record.prompt ?? ""}
					placeholder="描述构图、主体、光线和画面风格"
					onCommit={(value) => onChange(record.id, { executionPrompt: value })}
				/>
				<InspectorTextarea
					label="视频 Prompt"
					value={record.motionPrompt ?? ""}
					placeholder="描述动作、节奏和镜头运动"
					onCommit={(value) => onChange(record.id, { motionPrompt: value })}
				/>
				<InspectorTextarea
					label="镜头运动"
					value={record.cameraLanguage ?? ""}
					placeholder="景别、机位、焦点与运镜"
					rows={2}
					onCommit={(value) => onChange(record.id, { cameraLanguage: value })}
				/>

				<InspectorMediaGroup title="角色 / 场景资产" items={shot.assets} empty="尚未绑定资产" />
				<InspectorMediaGroup title="参考图" items={shot.references} empty="尚未关联参考图" />

				<div>
					<p className="mb-2 text-[11px] font-medium text-muted-foreground">首帧 / 尾帧</p>
					<div className="grid grid-cols-2 gap-2">
						<FrameSlot label="首帧" ready={Boolean(record.firstFrameAssetId)} />
						<FrameSlot label="尾帧" ready={Boolean(record.lastFrameAssetId)} />
					</div>
				</div>

				<div className="grid grid-cols-2 gap-2 pt-1">
					<Button onClick={() => onGenerate("image", record)}>
						<ImageIcon className="mr-1.5 size-4" />
						生成图片
					</Button>
					<Button onClick={() => onGenerate("video", record)}>
						<Film className="mr-1.5 size-4" />
						生成视频
					</Button>
				</div>

				<details className="group border-t border-border/60 pt-3">
					<summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs text-muted-foreground hover:text-foreground">
						<span className="flex items-center gap-2">
							<MoreHorizontal className="size-4" />
							Advanced / More
						</span>
						<ChevronDown className="size-4 transition-transform group-open:rotate-180" />
					</summary>
					<div className="mt-3 space-y-3 text-xs">
						<AdvancedRow
							icon={Link2}
							label="连续性"
							value={record.continuityIn || record.continuityOut || "未设置"}
						/>
						<AdvancedRow
							icon={Lock}
							label="锁定"
							value={record.status === "PASS" ? "已确认" : "未锁定"}
						/>
						<AdvancedRow icon={ShieldCheck} label="审核 / QC" value={`${shot.qc.length} 条记录`} />
						<AdvancedRow icon={Layers3} label="版本" value={`${shot.versions.length} 个版本`} />
						<AdvancedRow icon={Link2} label="依赖" value={`${shot.dependencies.length} 条关系`} />
					</div>
				</details>
			</div>
		</aside>
	);
};

export const CreatorTimeline: React.FC<ShotRailProps> = ({ shots, activeShotId, onSelect }) => (
	<div className="flex h-20 shrink-0 items-center gap-2 overflow-x-auto border-t border-border/70 bg-ide-sidebar/55 px-3">
		{shots.map((item) => (
			<button
				key={item.shot.id}
				type="button"
				onClick={() => onSelect(item.shot.id)}
				className={cn(
					"group relative h-12 w-24 shrink-0 overflow-hidden bg-muted text-left",
					item.shot.id === activeShotId && "ring-2 ring-primary",
				)}
			>
				{item.media[0]?.kind === "image" ? (
					<img
						src={item.media[0].source}
						alt=""
						className="absolute inset-0 size-full object-cover opacity-65"
					/>
				) : null}
				<span className="absolute inset-x-0 bottom-0 bg-background/75 px-1.5 py-1 text-[10px] font-semibold backdrop-blur">
					{item.shot.shotCode}
				</span>
			</button>
		))}
	</div>
);

const InspectorTextarea: React.FC<{
	label: string;
	value: string;
	placeholder: string;
	rows?: number;
	onCommit: (value: string) => void | Promise<void>;
}> = ({ label, value, placeholder, rows = 4, onCommit }) => (
	<label className="block">
		<span className="mb-2 block text-[11px] font-medium text-muted-foreground">{label}</span>
		<textarea
			key={value}
			defaultValue={value}
			rows={rows}
			placeholder={placeholder}
			onBlur={(event) => void onCommit(event.currentTarget.value.trim())}
			className="w-full resize-y bg-background/60 px-3 py-2 text-xs leading-5 text-foreground outline-none ring-1 ring-border/70 transition focus:ring-primary"
		/>
	</label>
);

const InspectorMediaGroup: React.FC<{
	title: string;
	items: SelectedGenerationAsset[];
	empty: string;
}> = ({ title, items, empty }) => (
	<div>
		<div className="mb-2 flex items-center justify-between">
			<p className="text-[11px] font-medium text-muted-foreground">{title}</p>
			<span className="text-[10px] text-muted-foreground">{items.length}</span>
		</div>
		{items.length ? (
			<div className="flex gap-2 overflow-x-auto pb-1">
				{items.slice(0, 8).map((asset) => (
					<div
						key={asset.id}
						className="grid size-14 shrink-0 place-items-center overflow-hidden bg-muted"
					>
						<ImageIcon className="size-4 text-muted-foreground" />
					</div>
				))}
			</div>
		) : (
			<p className="py-2 text-[11px] text-muted-foreground">{empty}</p>
		)}
	</div>
);

const FrameSlot: React.FC<{ label: string; ready: boolean }> = ({ label, ready }) => (
	<div className="flex h-16 items-center justify-center bg-background/60 text-[11px] text-muted-foreground ring-1 ring-border/60">
		{ready ? `${label}已就绪` : label}
	</div>
);

const AdvancedRow: React.FC<{
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
}> = ({ icon: Icon, label, value }) => (
	<div className="flex items-center justify-between gap-3">
		<span className="flex items-center gap-2 text-muted-foreground">
			<Icon className="size-3.5" />
			{label}
		</span>
		<span className="max-w-44 truncate text-foreground">{value}</span>
	</div>
);
