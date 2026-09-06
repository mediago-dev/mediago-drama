import {
	ArrowLeft,
	ArrowRight,
	Boxes,
	Check,
	Copy,
	ImagePlus,
	Layers3,
	Map,
	Package,
	RefreshCcw,
	ShoppingBag,
	Sparkles,
	Trash2,
	Upload,
	UserRound,
	WandSparkles,
	type LucideIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { getProjectAssets, uploadProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	getProjectConfig,
	updateProjectProduction,
	type ProjectProductionGraphEdge,
	type ProjectProductionGraphNode,
} from "@/domains/projects/api/projects";
import { createWorkspaceDocument } from "@/domains/workspace/api/workspace";
import { apiResourceURL } from "@/shared/lib/api-base";
import {
	buildReferenceTransferPrompts,
	referenceEvidenceDimensions,
	type ReferenceEvidenceItem,
	type ReferenceTransferInput,
} from "@/lib/production/reference-transfer";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";

const steps = [
	{ label: "参考图素材池", short: "素材", icon: ImagePlus },
	{ label: "证据 + Visual DNA", short: "证据 DNA", icon: Layers3 },
	{ label: "映射项目资产", short: "映射", icon: Boxes },
	{ label: "生成结构化提示词", short: "提示词", icon: Copy },
	{ label: "输出到制作环节", short: "输出", icon: Sparkles },
];
const emptyEvidence = (): ReferenceEvidenceItem[] =>
	referenceEvidenceDimensions.map(({ id }) => ({
		dimension: id,
		observation: "",
		confidence: "medium",
		unknowns: "",
	}));
const emptyDraft: ReferenceTransferInput = {
	targetCharacter: "",
	targetEnvironment: "",
	targetProps: "",
	targetProduct: "",
	evidence: emptyEvidence(),
	rendering: "",
	style: "",
	doNotCopy: "参考图中的人物身份、面孔、品牌标识、文字与独特设计",
};

const normalizeDraft = (value: unknown): ReferenceTransferInput => {
	const candidate =
		value && typeof value === "object" ? (value as Partial<ReferenceTransferInput>) : {};
	const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
	const evidenceByDimension = new globalThis.Map(
		evidence
			.filter((item): item is ReferenceEvidenceItem =>
				Boolean(item && typeof item === "object" && "dimension" in item),
			)
			.map((item) => [item.dimension, item]),
	);
	return {
		...emptyDraft,
		targetCharacter: typeof candidate.targetCharacter === "string" ? candidate.targetCharacter : "",
		targetEnvironment:
			typeof candidate.targetEnvironment === "string" ? candidate.targetEnvironment : "",
		targetProps: typeof candidate.targetProps === "string" ? candidate.targetProps : "",
		targetProduct: typeof candidate.targetProduct === "string" ? candidate.targetProduct : "",
		rendering: typeof candidate.rendering === "string" ? candidate.rendering : "",
		style: typeof candidate.style === "string" ? candidate.style : "",
		doNotCopy: typeof candidate.doNotCopy === "string" ? candidate.doNotCopy : emptyDraft.doNotCopy,
		evidence: emptyEvidence().map((item) => ({
			...item,
			...evidenceByDimension.get(item.dimension),
		})),
	};
};
const promptTypes = {
	image: "生图",
	action: "动作设计",
	setDesign: "布景",
	lighting: "灯光",
	imageToVideo: "图生视频",
} as const;

const referencePurposes = [
	"人物形象",
	"人物比例",
	"姿势动作",
	"场景环境",
	"构图镜位",
	"灯光氛围",
	"材质质感",
	"渲染风格",
	"道具产品",
] as const;
type ReferencePurpose = (typeof referencePurposes)[number];
interface ReferenceImage {
	id: string;
	name: string;
	purposes: ReferencePurpose[];
	url: string;
}

const getReferencePurposes = (reference: Partial<ReferenceImage>): ReferencePurpose[] =>
	Array.isArray(reference.purposes) ? reference.purposes : [];

const normalizeReferences = (value: unknown): ReferenceImage[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const candidate = item as Partial<ReferenceImage>;
		if (!candidate.id || !candidate.name || !candidate.url) return [];
		return [
			{
				id: String(candidate.id),
				name: String(candidate.name),
				url: String(candidate.url),
				purposes: Array.isArray(candidate.purposes)
					? candidate.purposes.filter((purpose): purpose is ReferencePurpose =>
							referencePurposes.includes(purpose as ReferencePurpose),
						)
					: [],
			},
		];
	});
};

export const ReferenceTransferModule: React.FC<{ projectId: string }> = ({ projectId }) => {
	const storageKey = `production-reference-transfer.v2:${projectId}`;
	// 进入“参考图迁移”就是进入实际工作区，不再先停在介绍卡片。
	const [isOpen, setIsOpen] = useState(true);
	const [step, setStep] = useState(0);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [draft, setDraft] = useState<ReferenceTransferInput>(emptyDraft);
	const [references, setReferences] = useState<ReferenceImage[]>([]);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadError, setUploadError] = useState("");
	const [copied, setCopied] = useState<string | null>(null);
	const [archiveState, setArchiveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [activePrompt, setActivePrompt] = useState<keyof typeof promptTypes>("image");
	const [isHydrated, setIsHydrated] = useState(false);
	// 用户可能在项目配置仍在恢复时就开始上传。记录这类本地操作，避免稍后返回的
	// 旧快照覆盖刚加入的参考图；恢复数据与本地数据按资产 ID 合并。
	const referencesEditedRef = useRef(false);
	// Autosave 与“输出并归档”可能在同一时间窗口内排队。用 ref 保留
	// 最新文档 ID，避免旧的草稿 autosave 把刚归档的 ID 覆盖为空值。
	const styleTransferDocumentIdRef = useRef<string | undefined>(undefined);
	const setAgentPanelSize = useAgentLayoutStore((state) => state.setPanelSize);
	const setAgentTab = useAgentLayoutStore((state) => state.setTab);
	const openProductionConversation = () => {
		setAgentTab("agent");
		setAgentPanelSize("expanded");
	};

	useEffect(() => {
		let cancelled = false;
		const applyHydratedReferences = (next: ReferenceImage[]) => {
			if (cancelled) return;
			setReferences((current) => {
				if (!referencesEditedRef.current) return next;
				const merged = new globalThis.Map<string, ReferenceImage>(
					next.map((reference) => [reference.id, reference]),
				);
				for (const reference of current) merged.set(reference.id, reference);
				return [...merged.values()];
			});
		};
		(async () => {
			try {
				const config = await getProjectConfig(projectId);
				const persisted = config.overview.production?.referenceTransfer;
				if (!cancelled && persisted) {
					styleTransferDocumentIdRef.current = persisted.styleTransferDocumentId;
					setDraft(normalizeDraft(persisted.draft));
					const persistedReferences = normalizeReferences(persisted.references);
					// 旧版本可能已经把参考图传到项目资产目录，但没有把
					// referenceTransfer.references 写回项目配置。优先恢复这批图片，
					// 避免用户看到“素材池为空”而误以为文件丢失。
					if (persistedReferences.length > 0) {
						applyHydratedReferences(persistedReferences);
					} else {
						const assets = await getProjectAssets(projectId);
						applyHydratedReferences(
							normalizeReferences(
								assets.assets
									.filter((asset) => asset.kind === "image")
									.map((asset) => ({
										id: asset.id,
										name: asset.filename,
										purposes: [],
										url: apiResourceURL(asset.url),
									})),
							),
						);
					}
					setIsHydrated(true);
					return;
				}
				const stored = localStorage.getItem(storageKey);
				if (stored) {
					const parsed = JSON.parse(stored) as {
						draft?: Partial<ReferenceTransferInput>;
						references?: ReferenceImage[];
					};
					if (!cancelled) {
						setDraft(normalizeDraft(parsed.draft));
						applyHydratedReferences(normalizeReferences(parsed.references));
					}
				}
				const legacy = localStorage.getItem(`production-reference-transfer.v1:${projectId}`);
				if (legacy && !stored && !cancelled) setDraft(normalizeDraft(JSON.parse(legacy)));
			} catch {
				if (!cancelled) {
					setDraft(emptyDraft);
					if (!referencesEditedRef.current) setReferences([]);
				}
			} finally {
				if (!cancelled) setIsHydrated(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectId, storageKey]);
	useEffect(() => {
		if (!isHydrated) return;
		localStorage.setItem(storageKey, JSON.stringify({ draft, references }));
		const timer = window.setTimeout(() => {
			void updateProjectProduction(projectId, (production) => {
				const now = new Date().toISOString();
				return {
					...production,
					referenceTransfer: {
						draft,
						references,
						styleTransferDocumentId:
							styleTransferDocumentIdRef.current ??
							production.referenceTransfer?.styleTransferDocumentId,
						updatedAt: now,
					},
					updatedAt: now,
				};
			}).catch(() => undefined);
		}, 700);
		return () => window.clearTimeout(timer);
	}, [draft, isHydrated, projectId, references, storageKey]);

	const archiveTransfer = async () => {
		if (references.length === 0) return;
		setArchiveState("saving");
		try {
			const id = `style-transfer-${projectId}-${Date.now()}`;
			const evidenceText = draft.evidence
				.filter((item) => item.observation.trim())
				.map(
					(item) =>
						`- ${item.dimension}（${item.confidence}）：${item.observation}${item.unknowns ? `；未知：${item.unknowns}` : ""}`,
				)
				.join("\n");
			const promptText = Object.entries(prompts)
				.map(([key, value]) => `### ${promptTypes[key as keyof typeof promptTypes]}\n${value}`)
				.join("\n\n");
			const document = await createWorkspaceDocument(
				{
					id,
					title: `风格迁移｜${new Date().toLocaleDateString("zh-CN")}`,
					category: "reference",
					content: `<!-- style-transfer:${id} -->\n# 风格迁移记录\n\n## 参考图分工\n${references.map((reference, index) => `- 参考图 ${index + 1}：${reference.name}｜${getReferencePurposes(reference).join("、") || "补充参考"}（资产 ${reference.id}）`).join("\n")}\n\n## 证据化拆解\n${evidenceText || "尚未填写"}\n\n## Visual DNA\n- 渲染效果：${draft.rendering || "未确认"}\n- 风格与氛围：${draft.style || "未确认"}\n- 不可照搬：${draft.doNotCopy || "人物身份、品牌标识、文字和独特设计"}\n\n## 目标资产映射\n- 角色：${draft.targetCharacter || "未指定"}\n- 环境：${draft.targetEnvironment || "未指定"}\n- 道具：${draft.targetProps || "未指定"}\n- 产品：${draft.targetProduct || "未指定"}\n\n## 结构化提示词\n${promptText}\n`,
				},
				projectId,
			);
			const now = new Date().toISOString();
			styleTransferDocumentIdRef.current = document.document.id;
			const referenceNodes = references.map((reference) => ({
				id: `reference:${reference.id}`,
				type: "reference" as const,
				title: reference.name,
				assetId: reference.id,
				path: reference.url,
				metadata: { purposes: getReferencePurposes(reference) },
				createdAt: now,
			}));
			const dnaNode = {
				id: `visual-dna:${id}`,
				type: "visual-dna" as const,
				title: "Visual DNA｜证据与迁移规则",
				documentId: document.document.id,
				createdAt: now,
			};
			const promptNode = {
				id: `document:${document.document.id}`,
				type: "document" as const,
				title: document.document.title,
				documentId: document.document.id,
				createdAt: now,
			};
			await updateProjectProduction(projectId, (production) => {
				const graph = production.productionGraph ?? { nodes: [], edges: [], updatedAt: now };
				// 参考图是同一份项目资产，反复归档迁移记录时只更新节点元数据，
				// 不要把同一个 reference:<assetId> 追加成多份。Visual DNA 和文档
				// 则保留为版本节点，方便回溯每次迁移结果。
				const nodesById = new globalThis.Map<string, ProjectProductionGraphNode>(
					graph.nodes
						.filter((node) => node.id !== dnaNode.id && node.id !== promptNode.id)
						.map((node) => [node.id, node]),
				);
				for (const node of referenceNodes) nodesById.set(node.id, node);
				nodesById.set(dnaNode.id, dnaNode);
				nodesById.set(promptNode.id, promptNode);
				const nextEdges = [
					...graph.edges.filter(
						(edge) =>
							!edge.to.startsWith(`visual-dna:${id}`) &&
							!edge.to.startsWith(`document:${document.document.id}`),
					),
					...references.map((reference) => ({
						from: `reference:${reference.id}`,
						to: dnaNode.id,
						relation: "derived-from" as const,
						createdAt: now,
					})),
					{
						from: dnaNode.id,
						to: promptNode.id,
						relation: "generated-by" as const,
						createdAt: now,
					},
				];
				const edgesByKey = new globalThis.Map<string, ProjectProductionGraphEdge>(
					nextEdges.map((edge) => [`${edge.from}\u0000${edge.to}\u0000${edge.relation}`, edge]),
				);
				const nodes = Array.from(nodesById.values());
				const edges = Array.from(edgesByKey.values());
				return {
					...production,
					sharedContext: {
						...production.sharedContext,
						visualDNA: {
							rendering: draft.rendering,
							style: draft.style,
							evidence: draft.evidence,
							doNotCopy: draft.doNotCopy,
						},
						prompts: { ...production.sharedContext?.prompts, ...prompts },
						updatedAt: now,
					},
					referenceTransfer: {
						draft,
						references,
						styleTransferDocumentId: document.document.id,
						updatedAt: now,
					},
					productionGraph: { nodes, edges, updatedAt: now },
					updatedAt: now,
				};
			});
			setArchiveState("saved");
			setStep(4);
		} catch {
			setArchiveState("error");
		}
	};

	const addReferenceImages = async (files: File[]) => {
		if (files.length === 0) return;
		referencesEditedRef.current = true;
		setIsUploading(true);
		setUploadError("");
		try {
			const uploaded: ReferenceImage[] = [];
			for (const file of files) {
				const asset = await uploadProjectAsset(projectId, file);
				uploaded.push({
					id: asset.id,
					name: asset.filename || file.name,
					purposes: [],
					url: apiResourceURL(asset.url),
				});
			}
			setReferences((current) => [...current, ...uploaded]);
		} catch (error) {
			setUploadError(error instanceof Error ? error.message : "参考图上传失败，请重试。");
		} finally {
			setIsUploading(false);
		}
	};
	const toggleReferencePurpose = (id: string, purpose: ReferencePurpose) => {
		referencesEditedRef.current = true;
		setReferences((current) =>
			current.map((reference) =>
				reference.id === id
					? {
							...reference,
							purposes: getReferencePurposes(reference).includes(purpose)
								? getReferencePurposes(reference).filter((item) => item !== purpose)
								: [...getReferencePurposes(reference), purpose],
						}
					: reference,
			),
		);
	};

	const prompts = useMemo(() => {
		const built = buildReferenceTransferPrompts(draft);
		const referenceMap = references
			.map(
				(reference, index) =>
					`参考图 ${index + 1}：${reference.purposes?.length ? reference.purposes.join("、") : "仅作补充参考"}`,
			)
			.join("\n");
		if (!referenceMap) return built;
		const withReferenceMap = (value: string) => `【参考图分工】\n${referenceMap}\n\n${value}`;
		return {
			action: withReferenceMap(built.action),
			image: withReferenceMap(built.image),
			imageToVideo: withReferenceMap(built.imageToVideo),
			lighting: withReferenceMap(built.lighting),
			setDesign: withReferenceMap(built.setDesign),
		};
	}, [draft, references]);
	const confirmedCount = draft.evidence.filter(
		(item) => item.observation.trim() && item.confidence !== "low",
	).length;
	const targetCount = [
		draft.targetCharacter,
		draft.targetEnvironment,
		draft.targetProps,
		draft.targetProduct,
	].filter((value) => value.trim()).length;
	const updateEvidence = (index: number, patch: Partial<ReferenceEvidenceItem>) =>
		setDraft((current) => ({
			...current,
			evidence: current.evidence.map((item, itemIndex) =>
				itemIndex === index ? { ...item, ...patch } : item,
			),
		}));

	if (!isOpen)
		return (
			<section className="overflow-hidden rounded-md border border-border bg-card p-5">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-center">
					<div className="grid size-12 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
						<WandSparkles className="size-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-xs font-medium text-primary">视觉迁移助手</p>
						<h2 className="mt-1 text-base font-semibold">多张参考图，五步变成可用制作指令</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							不用懂专业术语。放图、确认看到的内容、选择自己的资产，然后复制结果。
						</p>
					</div>
					<Button className="h-10 shrink-0 gap-2 px-5" onClick={() => setIsOpen(true)}>
						开始处理
						<ArrowRight className="size-4" />
					</Button>
				</div>
			</section>
		);

	return (
		<section className="overflow-hidden rounded-md border border-border bg-card">
			<header className="border-b border-border bg-muted/30 px-5 py-4">
				<div className="flex items-center justify-between gap-4">
					<div>
						<p className="text-xs text-muted-foreground">第 01 阶段 · 创意与分镜定稿</p>
						<h2 className="mt-0.5 text-base font-semibold">
							{showAdvanced ? steps[step].label : "参考图与创作沟通"}
						</h2>
						{!showAdvanced ? (
							<p className="mt-1 text-sm text-muted-foreground">
								上传多张参考图并标明各自用途，然后直接在下方对话中沟通故事、脚本与分镜。
							</p>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setShowAdvanced((value) => !value);
								setStep(0);
							}}
						>
							{showAdvanced ? "返回创作沟通" : "高级调整"}
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
							暂时收起
						</Button>
					</div>
				</div>
				{showAdvanced ? (
					<div className="mt-4 grid grid-cols-5 gap-2">
						{steps.map((item, index) => {
							const Icon = item.icon;
							return (
								<button
									key={item.short}
									type="button"
									onClick={() => setStep(index)}
									className="text-left"
								>
									<div
										className={`h-1.5 rounded-full ${index <= step ? "bg-primary" : "bg-muted"}`}
									/>
									<div
										className={`mt-2 flex items-center gap-1.5 text-xs ${index === step ? "font-medium text-foreground" : "text-muted-foreground"}`}
									>
										{index < step ? (
											<Check className="size-3.5 text-primary" />
										) : (
											<Icon className="size-3.5" />
										)}
										<span className="hidden sm:inline">{item.short}</span>
									</div>
								</button>
							);
						})}
					</div>
				) : null}
			</header>

			<div className="mx-auto min-h-[420px] max-w-3xl p-5 sm:p-7">
				{step === 0 ? (
					<div className="grid gap-5">
						<div>
							<h3 className="text-lg font-semibold">把参考图放进当前项目</h3>
							<p className="mt-1 text-sm text-muted-foreground">
								每张图可以承担多个用途。助理会区分可见事实与推测，并把结论带入脚本、分镜和后续资产制作。
							</p>
						</div>
						<label className="group flex min-h-28 cursor-pointer items-center justify-center gap-3 rounded-md border-2 border-dashed border-border bg-muted/20 px-5 text-center transition hover:border-primary/50 hover:bg-primary/5">
							<span className="grid size-11 shrink-0 place-items-center rounded-md border border-border bg-background">
								{isUploading ? (
									<RefreshCcw className="size-5 animate-spin text-primary" />
								) : (
									<Upload className="size-5 text-primary" />
								)}
							</span>
							<span>
								<strong className="block text-sm text-foreground">
									{isUploading ? "正在加入素材池" : "选择多张参考图"}
								</strong>
								<span className="mt-1 block text-xs text-muted-foreground">JPG、PNG、WebP</span>
							</span>
							<input
								type="file"
								aria-label="选择多张参考图"
								accept="image/*"
								multiple
								disabled={isUploading}
								className="sr-only"
								onChange={(event) => {
									void addReferenceImages(Array.from(event.target.files ?? []));
									event.target.value = "";
								}}
							/>
						</label>
						{uploadError ? <p className="text-sm text-error-foreground">{uploadError}</p> : null}
						{references.length > 0 ? (
							<div className="grid gap-3 sm:grid-cols-2">
								{references.map((reference, index) => (
									<article
										key={reference.id}
										className="overflow-hidden rounded-md border border-border bg-background"
									>
										<div className="relative aspect-[4/3] bg-muted">
											<img
												src={reference.url}
												alt={`参考图 ${index + 1}`}
												className="size-full object-contain"
											/>
											<span className="absolute left-2 top-2 rounded-sm bg-background/90 px-2 py-1 text-xs font-medium">
												参考 {index + 1}
											</span>
											<Button
												type="button"
												variant="secondary"
												size="icon"
												className="absolute right-2 top-2 size-8"
												aria-label={`移除 ${reference.name}`}
												onClick={() => {
													referencesEditedRef.current = true;
													setReferences((current) =>
														current.filter((item) => item.id !== reference.id),
													);
												}}
											>
												<Trash2 className="size-4" />
											</Button>
										</div>
										<div className="p-3">
											<p className="truncate text-xs font-medium" title={reference.name}>
												{reference.name}
											</p>
											<p className="mt-2 text-2xs text-muted-foreground">
												这张图提供什么依据？可多选
											</p>
											<div className="mt-2 flex flex-wrap gap-1.5">
												{referencePurposes.map((purpose) => {
													const selected = getReferencePurposes(reference).includes(purpose);
													return (
														<button
															key={purpose}
															type="button"
															aria-pressed={selected}
															onClick={() => toggleReferencePurpose(reference.id, purpose)}
															className={`rounded-sm border px-2 py-1 text-2xs transition ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
														>
															{purpose}
														</button>
													);
												})}
											</div>
										</div>
									</article>
								))}
							</div>
						) : null}
						<div className="rounded-md border border-primary/25 bg-primary/5 p-4">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<p className="text-sm font-semibold">下一步直接和制作助理沟通</p>
									<p className="mt-1 text-xs leading-5 text-muted-foreground">
										助理自动完成证据拆解、Visual
										DNA、迁移边界和结构化提示词；先向你汇报，确认后再写故事、脚本并生成 10–20
										张分镜图。
									</p>
								</div>
								<Button
									className="shrink-0 gap-2"
									disabled={references.length === 0 || isUploading}
									onClick={openProductionConversation}
								>
									开始沟通剧本
									<ArrowRight className="size-4" />
								</Button>
							</div>
						</div>
					</div>
				) : null}

				{step === 1 ? (
					<div className="grid gap-5">
						<div>
							<h3 className="text-lg font-semibold">只写你确实看到的</h3>
							<p className="mt-1 text-sm text-muted-foreground">
								不确定就留空，不需要猜。已确认 {confirmedCount}/7 项。
							</p>
						</div>
						<div className="flex gap-2 overflow-x-auto pb-1">
							{references.map((reference, index) => (
								<div
									key={reference.id}
									className="flex min-w-48 items-center gap-2 rounded-md border border-border bg-background p-2"
								>
									<img src={reference.url} alt="" className="size-12 rounded-sm object-cover" />
									<div className="min-w-0">
										<p className="text-xs font-medium">参考 {index + 1}</p>
										<p className="mt-0.5 truncate text-2xs text-muted-foreground">
											{getReferencePurposes(reference).length > 0
												? getReferencePurposes(reference).join(" · ")
												: "尚未指定用途"}
										</p>
									</div>
								</div>
							))}
						</div>
						<div className="grid gap-3">
							{referenceEvidenceDimensions.map((dimension, index) => {
								const item = draft.evidence[index];
								return (
									<div
										key={dimension.id}
										className="rounded-md border border-border bg-background p-4"
									>
										<div className="mb-2 flex items-center justify-between">
											<label className="text-sm font-medium">{dimension.label}</label>
											{item.observation.trim() ? (
												<span className="flex items-center gap-1 text-xs text-success-foreground">
													<Check className="size-3.5" />
													已填写
												</span>
											) : null}
										</div>
										<Textarea
											aria-label={`${dimension.label}可见证据`}
											className="min-h-16 resize-none text-sm"
											placeholder={dimension.question}
											value={item.observation}
											onChange={(event) =>
												updateEvidence(index, { observation: event.target.value })
											}
										/>
										<details className="mt-2 text-xs text-muted-foreground">
											<summary className="cursor-pointer select-none">
												不确定？标注一下（可选）
											</summary>
											<div className="mt-2 grid gap-2 sm:grid-cols-[150px_1fr]">
												<select
													value={item.confidence}
													onChange={(event) =>
														updateEvidence(index, {
															confidence: event.target.value as ReferenceEvidenceItem["confidence"],
														})
													}
													className="h-9 rounded-control border border-input bg-background px-2"
												>
													<option value="high">我很确定</option>
													<option value="medium">基本确定</option>
													<option value="low">只是猜测，不采用</option>
												</select>
												<Input
													aria-label={`${dimension.label}未知项`}
													placeholder="哪里无法从图片确认？"
													value={item.unknowns}
													onChange={(event) =>
														updateEvidence(index, { unknowns: event.target.value })
													}
												/>
											</div>
										</details>
									</div>
								);
							})}
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<SimpleField
								label="渲染效果"
								hint="例如：电影级写实、细腻插画"
								value={draft.rendering}
								onChange={(rendering) => setDraft((v) => ({ ...v, rendering }))}
							/>
							<SimpleField
								label="风格与氛围"
								hint="例如：克制、优雅、冷暖对照"
								value={draft.style}
								onChange={(style) => setDraft((v) => ({ ...v, style }))}
							/>
						</div>
						<label className="grid gap-2 rounded-md border border-border bg-background p-4 text-sm font-medium">
							明确不能照搬的内容
							<Textarea
								value={draft.doNotCopy}
								onChange={(event) => setDraft((v) => ({ ...v, doNotCopy: event.target.value }))}
							/>
							<span className="text-xs font-normal text-muted-foreground">
								默认排除人物身份、面孔、品牌标识、文字和独特设计。
							</span>
						</label>
					</div>
				) : null}

				{step === 2 ? (
					<div className="grid gap-5">
						<div>
							<h3 className="text-lg font-semibold">把画面元素换成你的项目资产</h3>
							<p className="mt-1 text-sm text-muted-foreground">
								动作、构图和灯光可以迁移，但人物、场景、道具与产品必须使用项目自己的版本。已关联{" "}
								{targetCount}/4 类资产。
							</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<SimpleField
								icon={UserRound}
								label="画面里换成谁？"
								hint="例如：女主 Look02"
								value={draft.targetCharacter}
								onChange={(targetCharacter) => setDraft((v) => ({ ...v, targetCharacter }))}
							/>
							<SimpleField
								icon={Map}
								label="换成哪个场景？"
								hint="例如：月夜草原 Scene03"
								value={draft.targetEnvironment}
								onChange={(targetEnvironment) => setDraft((v) => ({ ...v, targetEnvironment }))}
							/>
							<SimpleField
								icon={Package}
								label="要使用什么道具？"
								hint="例如：蓝色丝线 Prop01"
								value={draft.targetProps}
								onChange={(targetProps) => setDraft((v) => ({ ...v, targetProps }))}
							/>
							<SimpleField
								icon={ShoppingBag}
								label="要展示什么产品？"
								hint="例如：主推手袋 Product01"
								value={draft.targetProduct}
								onChange={(targetProduct) => setDraft((v) => ({ ...v, targetProduct }))}
							/>
						</div>
					</div>
				) : null}

				{step === 3 || step === 4 ? (
					<div className="grid gap-5">
						<div className="rounded-md bg-success-surface p-4">
							<div className="flex items-center gap-2 text-sm font-medium text-success-foreground">
								<Check className="size-4" />
								{step === 3 ? "检查提示词结构" : "提示词已经可以用于制作"}
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								{step === 3
									? "逐项检查参考图分工、可迁移内容和项目资产是否对应正确。"
									: "选择制作环节，复制后直接粘贴到对应的生成工具。"}
							</p>
						</div>
						<div className="flex gap-2 overflow-x-auto pb-1">
							{Object.entries(promptTypes).map(([key, label]) => (
								<button
									key={key}
									type="button"
									onClick={() => setActivePrompt(key as keyof typeof promptTypes)}
									className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium ${activePrompt === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
								>
									{label}
								</button>
							))}
						</div>
						<div className="rounded-md border border-border bg-background p-4">
							<Textarea
								readOnly
								value={prompts[activePrompt]}
								className="min-h-64 resize-none border-0 bg-transparent p-0 text-sm shadow-none"
							/>
							{step === 4 ? (
								<Button
									className="mt-4 h-10 w-full gap-2"
									variant="secondary"
									onClick={() => {
										void navigator.clipboard.writeText(prompts[activePrompt]);
										setCopied(activePrompt);
										window.setTimeout(() => setCopied(null), 1200);
									}}
								>
									{copied === activePrompt ? (
										<Check className="size-4" />
									) : (
										<Copy className="size-4" />
									)}
									{copied === activePrompt
										? "已复制，可以去使用了"
										: `复制${promptTypes[activePrompt]}提示词`}
								</Button>
							) : null}
							{step === 3 ? (
								<Button
									className="mt-3 h-10 w-full gap-2"
									onClick={() => void archiveTransfer()}
									disabled={archiveState === "saving" || references.length === 0}
								>
									{archiveState === "saving"
										? "正在输出并归档…"
										: archiveState === "saved"
											? "已归档到项目"
											: "输出并归档到项目"}
									<Sparkles className="size-4" />
								</Button>
							) : null}
						</div>
						{step === 4 ? (
							<Button
								variant="ghost"
								className="mx-auto gap-2 text-xs"
								onClick={() => {
									referencesEditedRef.current = true;
									setStep(0);
									setReferences([]);
									setDraft(emptyDraft);
								}}
							>
								<RefreshCcw className="size-3.5" />
								处理另一张参考图
							</Button>
						) : null}
					</div>
				) : null}
			</div>

			{showAdvanced ? (
				<footer className="flex items-center justify-between border-t border-border bg-muted/20 px-5 py-4">
					<Button
						variant="ghost"
						className="gap-2"
						disabled={step === 0}
						onClick={() => setStep((value) => Math.max(0, value - 1))}
					>
						<ArrowLeft className="size-4" />
						上一步
					</Button>
					{step < 4 ? (
						<Button
							className="gap-2 px-5"
							disabled={step === 0 && (references.length === 0 || isUploading)}
							onClick={() => setStep((value) => Math.min(4, value + 1))}
						>
							{step === 0
								? "开始证据拆解"
								: step === 1
									? "确认 DNA，映射项目资产"
									: step === 2
										? "生成结构化提示词"
										: "确认并输出"}
							<ArrowRight className="size-4" />
						</Button>
					) : (
						<Button variant="outline" onClick={() => setIsOpen(false)}>
							完成
						</Button>
					)}
				</footer>
			) : null}
		</section>
	);
};

const SimpleField: React.FC<{
	icon?: LucideIcon;
	label: string;
	hint: string;
	value: string;
	onChange: (value: string) => void;
}> = ({ icon: Icon, label, hint, value, onChange }) => (
	<label className="grid gap-2 rounded-md border border-border bg-background p-4 text-sm font-medium">
		{Icon ? <Icon className="size-5 text-muted-foreground" /> : null}
		<span>{label}</span>
		<Input
			className="h-10 text-sm"
			placeholder={hint}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	</label>
);
