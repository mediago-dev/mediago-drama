import { Archive, CheckCircle2, ClipboardCheck, History, Save, ShieldAlert } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type {
	ProjectProductionState,
	ProjectQCEntityType,
	ProjectQCResult,
	ProjectQCStatus,
	ProjectRetrospective,
	ProjectVersionRecord,
} from "@/domains/projects/api/projects";
import type { ProjectProductionContext } from "@/lib/production/project-context";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

interface ProductionControlPanelProps {
	context: ProjectProductionContext;
	tasks: { total: number; pending: number; failed: number };
	onProductionPatch: (patch: Partial<ProjectProductionState>) => Promise<void>;
}

const qcStatuses: Array<{ value: ProjectQCStatus; label: string }> = [
	{ value: "PASS", label: "已通过" },
	{ value: "NEEDS_FIX", label: "需修改" },
	{ value: "BLOCKED", label: "被阻塞" },
	{ value: "MISSING", label: "缺失" },
];

const versionStatuses = [
	["DRAFT", "草稿"],
	["PASS", "已通过"],
	["FAIL", "失败"],
	["REGEN", "待重做"],
	["MISSING", "缺失"],
] as const;

const now = () => new Date().toISOString();

export const ProductionControlPanel: React.FC<ProductionControlPanelProps> = ({
	context,
	tasks,
	onProductionPatch,
}) => {
	const production = context.production;
	const [qcOpen, setQcOpen] = useState(false);
	const [versionOpen, setVersionOpen] = useState(false);
	const [retroOpen, setRetroOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [qcEntityType, setQcEntityType] = useState<ProjectQCEntityType>("asset");
	const [qcEntityId, setQcEntityId] = useState("");
	const [qcStageId, setQcStageId] = useState("");
	const [qcStatus, setQcStatus] = useState<ProjectQCStatus>("PASS");
	const [qcIssues, setQcIssues] = useState("");
	const [versionEntityType, setVersionEntityType] =
		useState<ProjectVersionRecord["entityType"]>("asset");
	const [versionEntityId, setVersionEntityId] = useState("");
	const [versionLabel, setVersionLabel] = useState("");
	const [versionStatus, setVersionStatus] = useState<ProjectVersionRecord["status"]>("DRAFT");
	const [versionPrompt, setVersionPrompt] = useState("");
	const [versionModel, setVersionModel] = useState("");
	const [versionNote, setVersionNote] = useState("");
	const [retro, setRetro] = useState<ProjectRetrospective>(
		production?.retrospective ?? {
			status: "DRAFT",
			successes: [],
			failures: [],
			reusablePrompts: [],
			reusableRules: [],
			nextProjectNotes: [],
			updatedAt: now(),
		},
	);

	const qcIssueCount = context.qcIssueCount;
	const stageRiskCount = useMemo(
		() =>
			Object.values(production?.stageStates ?? {}).filter(
				(state) =>
					state.status === "NEEDS_FIX" || state.status === "BLOCKED" || state.status === "REVIEW",
			).length,
		[production?.stageStates],
	);

	const patch = async (next: Partial<ProjectProductionState>) => {
		setSaving(true);
		try {
			await onProductionPatch(next);
		} finally {
			setSaving(false);
		}
	};

	const saveQC = async () => {
		if (!qcEntityId.trim()) return;
		const result: ProjectQCResult = {
			id: `qc-${Date.now()}`,
			entityType: qcEntityType,
			entityId: qcEntityId.trim(),
			stageId: qcStageId || (qcEntityType === "stage" ? qcEntityId.trim() : undefined),
			status: qcStatus,
			checks: [],
			issues: qcIssues
				.split("\n")
				.map((item) => item.trim())
				.filter(Boolean),
			reviewedAt: now(),
		};
		await patch({
			qcResults: { ...production?.qcResults, [result.id]: result },
			updatedAt: now(),
		});
		setQcEntityId("");
		setQcStageId("");
		setQcIssues("");
	};

	const saveVersion = async () => {
		if (!versionEntityId.trim()) return;
		const existing = production?.versions ?? [];
		const sameEntity = existing.filter(
			(item) => item.entityType === versionEntityType && item.entityId === versionEntityId.trim(),
		);
		const nextVersion = `V${String(sameEntity.length + 1).padStart(2, "0")}`;
		const record: ProjectVersionRecord = {
			id: `version-${Date.now()}`,
			entityType: versionEntityType,
			entityId: versionEntityId.trim(),
			version: nextVersion,
			status: versionStatus,
			label: versionLabel.trim() || undefined,
			prompt: versionPrompt.trim() || undefined,
			model: versionModel.trim() || undefined,
			note: versionNote.trim() || undefined,
			createdAt: now(),
		};
		await patch({ versions: [...existing, record], updatedAt: now() });
		setVersionEntityId("");
		setVersionLabel("");
		setVersionPrompt("");
		setVersionModel("");
		setVersionNote("");
	};

	const saveRetro = async () => {
		await patch({ retrospective: { ...retro, updatedAt: now() }, updatedAt: now() });
	};

	return (
		<section
			className="rounded-2xl border border-border bg-card p-5 shadow-sm"
			aria-label="制作控制台"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="text-xs font-medium text-primary">制作控制台</p>
					<h2 className="mt-1 text-base font-semibold text-foreground">
						事实、风险和版本都在这里留痕
					</h2>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						生成结果不会只停留在对话里：任务、QC、版本和复盘会归档到当前项目。
					</p>
				</div>
				{context.sharedMemoryReady ? (
					<Badge variant="secondary">项目记忆已建立</Badge>
				) : (
					<Badge variant="outline">还没有共享记忆</Badge>
				)}
			</div>

			<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
				<Metric
					icon={<CheckCircle2 className="size-4" />}
					label="生成任务"
					value={`${tasks.total} 个`}
					hint={tasks.pending ? `${tasks.pending} 个进行中` : "没有进行中的任务"}
				/>
				<Metric
					icon={<ShieldAlert className="size-4" />}
					label="需要处理"
					value={`${context.blockerCount + qcIssueCount + tasks.failed} 项`}
					hint={`${context.blockerCount} 个阻塞 · ${qcIssueCount} 个 QC`}
					danger={context.blockerCount + qcIssueCount + tasks.failed > 0}
				/>
				<Metric
					icon={<ClipboardCheck className="size-4" />}
					label="阶段风险"
					value={`${stageRiskCount} 个`}
					hint="待审核 / 需修改 / 被阻塞"
				/>
				<Metric
					icon={<History className="size-4" />}
					label="版本记录"
					value={`${context.versionCount} 个`}
					hint="保留 V01、V02、V03，不覆盖历史"
				/>
				<Metric
					icon={<Archive className="size-4" />}
					label="已归档输出"
					value={`${context.outputArchiveCount} 个`}
					hint={context.outputDirectory ? `目录：${context.outputDirectory}` : "尚未指定输出目录"}
				/>
			</div>

			<div className="mt-4 grid gap-2 lg:grid-cols-3">
				<details
					className="rounded-xl border border-border bg-background"
					open={qcOpen}
					onToggle={(event) => setQcOpen(event.currentTarget.open)}
				>
					<summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
						记录一次 QC
					</summary>
					<div className="grid gap-2 border-t border-border p-4">
						<div className="grid grid-cols-2 gap-2">
							<select
								value={qcEntityType}
								onChange={(event) => setQcEntityType(event.target.value as ProjectQCEntityType)}
								className="h-8 rounded-md border border-input bg-background px-2 text-xs"
							>
								<option value="asset">资产</option>
								<option value="shot">镜头</option>
								<option value="video">视频</option>
								<option value="stage">阶段</option>
								<option value="output">交付</option>
							</select>
							<select
								value={qcStatus}
								onChange={(event) => setQcStatus(event.target.value as ProjectQCStatus)}
								className="h-8 rounded-md border border-input bg-background px-2 text-xs"
							>
								{qcStatuses.map((item) => (
									<option key={item.value} value={item.value}>
										{item.label}
									</option>
								))}
							</select>
						</div>
						<input
							value={qcEntityId}
							onChange={(event) => setQcEntityId(event.target.value)}
							placeholder="对象 ID，例如 Asset_01 / P08"
							className="h-8 rounded-md border border-input bg-background px-2 text-xs"
						/>
						<select
							value={qcStageId}
							onChange={(event) => setQcStageId(event.target.value)}
							className="h-8 rounded-md border border-input bg-background px-2 text-xs"
						>
							<option value="">不绑定具体阶段</option>
							{(production?.template.stages ?? []).map((stage) => (
								<option key={stage.id} value={stage.id}>
									{String(stage.order).padStart(2, "0")} {stage.title}
								</option>
							))}
						</select>
						<Textarea
							value={qcIssues}
							onChange={(event) => setQcIssues(event.target.value)}
							placeholder="每行写一个问题；没有问题可以留空"
							className="min-h-20 text-xs"
						/>
						<Button size="sm" disabled={saving || !qcEntityId.trim()} onClick={() => void saveQC()}>
							<Save className="size-3.5" />
							保存 QC
						</Button>
					</div>
				</details>

				<details
					className="rounded-xl border border-border bg-background"
					open={versionOpen}
					onToggle={(event) => setVersionOpen(event.currentTarget.open)}
				>
					<summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
						记录一个版本
					</summary>
					<div className="grid gap-2 border-t border-border p-4">
						<div className="grid grid-cols-2 gap-2">
							<select
								value={versionEntityType}
								onChange={(event) =>
									setVersionEntityType(event.target.value as ProjectVersionRecord["entityType"])
								}
								className="h-8 rounded-md border border-input bg-background px-2 text-xs"
							>
								<option value="asset">资产</option>
								<option value="shot">镜头</option>
								<option value="task">生成任务</option>
								<option value="output">交付</option>
							</select>
							<select
								value={versionStatus}
								onChange={(event) =>
									setVersionStatus(event.target.value as ProjectVersionRecord["status"])
								}
								className="h-8 rounded-md border border-input bg-background px-2 text-xs"
							>
								{versionStatuses.map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</div>
						<input
							value={versionEntityId}
							onChange={(event) => setVersionEntityId(event.target.value)}
							placeholder="对象 ID，例如 P08 / WHITE_HORSE_01"
							className="h-8 rounded-md border border-input bg-background px-2 text-xs"
						/>
						<input
							value={versionLabel}
							onChange={(event) => setVersionLabel(event.target.value)}
							placeholder="版本说明（可选）"
							className="h-8 rounded-md border border-input bg-background px-2 text-xs"
						/>
						<input
							value={versionModel}
							onChange={(event) => setVersionModel(event.target.value)}
							placeholder="模型名称（可选）"
							className="h-8 rounded-md border border-input bg-background px-2 text-xs"
						/>
						<Textarea
							value={versionPrompt}
							onChange={(event) => setVersionPrompt(event.target.value)}
							placeholder="Prompt（可选）"
							className="min-h-16 text-xs"
						/>
						<Textarea
							value={versionNote}
							onChange={(event) => setVersionNote(event.target.value)}
							placeholder="这版为什么保留 / 为什么淘汰"
							className="min-h-16 text-xs"
						/>
						<Button
							size="sm"
							disabled={saving || !versionEntityId.trim()}
							onClick={() => void saveVersion()}
						>
							<Save className="size-3.5" />
							保存版本
						</Button>
					</div>
				</details>

				<details
					className="rounded-xl border border-border bg-background"
					open={retroOpen}
					onToggle={(event) => setRetroOpen(event.currentTarget.open)}
				>
					<summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
						沉淀复盘
					</summary>
					<div className="grid gap-2 border-t border-border p-4">
						<select
							value={retro.status}
							onChange={(event) =>
								setRetro((current) => ({
									...current,
									status: event.target.value as ProjectRetrospective["status"],
								}))
							}
							className="h-8 rounded-md border border-input bg-background px-2 text-xs"
						>
							<option value="DRAFT">草稿</option>
							<option value="READY">可复用</option>
							<option value="ARCHIVED">已归档</option>
						</select>
						<Textarea
							value={retro.conclusion ?? ""}
							onChange={(event) =>
								setRetro((current) => ({ ...current, conclusion: event.target.value }))
							}
							placeholder="这次项目最重要的结论"
							className="min-h-20 text-xs"
						/>
						<Textarea
							value={retro.reusablePrompts.join("\n")}
							onChange={(event) =>
								setRetro((current) => ({
									...current,
									reusablePrompts: event.target.value
										.split("\n")
										.map((item) => item.trim())
										.filter(Boolean),
								}))
							}
							placeholder="可复用 Prompt，每行一条"
							className="min-h-16 text-xs"
						/>
						<Textarea
							value={retro.reusableRules.join("\n")}
							onChange={(event) =>
								setRetro((current) => ({
									...current,
									reusableRules: event.target.value
										.split("\n")
										.map((item) => item.trim())
										.filter(Boolean),
								}))
							}
							placeholder="下次必须遵守的规则，每行一条"
							className="min-h-16 text-xs"
						/>
						<Button size="sm" disabled={saving} onClick={() => void saveRetro()}>
							<Save className="size-3.5" />
							保存复盘
						</Button>
					</div>
				</details>
			</div>
		</section>
	);
};

const Metric: React.FC<{
	icon: React.ReactNode;
	label: string;
	value: string;
	hint: string;
	danger?: boolean;
}> = ({ icon, label, value, hint, danger }) => (
	<div
		className={cn(
			"rounded-xl border border-border bg-background p-3",
			danger && "border-warning-border bg-warning-surface/40",
		)}
	>
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			{icon}
			<span>{label}</span>
		</div>
		<p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{value}</p>
		<p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
	</div>
);
