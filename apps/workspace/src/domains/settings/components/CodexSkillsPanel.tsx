import {
	AlertTriangle,
	Blocks,
	CheckCircle2,
	CircleHelp,
	CircleOff,
	Code2,
	FileWarning,
	FolderSearch,
	Loader2,
	RefreshCw,
	Search,
	Unplug,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
	codexSkillKey,
	codexSkillsKey,
	getCodexSkill,
	listCodexSkills,
	type CodexSkillAvailability,
	type CodexSkillAvailabilityState,
	type CodexSkillDetail,
	type CodexSkillIssue,
	type CodexSkillListItem,
	type CodexSkillSource,
} from "@/domains/settings/api/codex-skills";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { revealNativePath } from "@/shared/desktop/actions";
import { isDesktopRuntime } from "@/shared/desktop/runtime";
import { cn } from "@/shared/lib/utils";

type StatusFilter = "all" | "available" | "attention" | "unknown";
type SourceFilter = "all" | CodexSkillSource;

const statusLabels: Record<CodexSkillAvailabilityState, string> = {
	available: "可用",
	disabled: "已禁用",
	not_shared: "未共享",
	invalid: "无效",
	unknown: "未确认",
};

const sourceLabels: Record<CodexSkillSource, string> = {
	user_shared: "个人共享",
	codex_home: "Codex Home（兼容目录）",
	admin: "管理员",
	system: "系统",
};

export const CodexSkillsPanel: React.FC = () => {
	const {
		data,
		error,
		isLoading,
		isValidating,
		mutate: mutateList,
	} = useSWR(codexSkillsKey, listCodexSkills, { shouldRetryOnError: false });
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
	const [selectedID, setSelectedID] = useState("");
	const [staleSkillID, setStaleSkillID] = useState("");
	const [staleMessage, setStaleMessage] = useState("");
	const [staleRecoveryPending, setStaleRecoveryPending] = useState(false);
	const [manualRefreshPending, setManualRefreshPending] = useState(false);
	const [revealError, setRevealError] = useState("");
	const staleSkillIDRef = useRef("");
	const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});

	const visibleSkills = useMemo(
		() =>
			(data?.skills ?? []).filter((skill) => {
				const normalizedQuery = query.trim().toLocaleLowerCase("zh-Hans-CN");
				const matchesQuery =
					!normalizedQuery ||
					[
						skill.displayName,
						skill.name,
						skill.description,
						skill.shortDescription,
						skill.displayPath,
					]
						.filter(Boolean)
						.some((value) => value?.toLocaleLowerCase("zh-Hans-CN").includes(normalizedQuery));
				const matchesSource =
					sourceFilter === "all" ||
					skill.source === sourceFilter ||
					skill.origins.some((origin) => origin.source === sourceFilter);
				const matchesStatus = matchesStatusFilter(skill, statusFilter);
				return matchesQuery && matchesSource && matchesStatus;
			}),
		[data?.skills, query, sourceFilter, statusFilter],
	);

	useEffect(() => {
		if (!data || staleRecoveryPending || manualRefreshPending) return;
		if (selectedID && visibleSkills.some((skill) => skill.id === selectedID)) return;
		const suppressedID = staleSkillIDRef.current || staleSkillID;
		const firstAvailable = visibleSkills.find((skill) => skill.id !== suppressedID);
		setSelectedID(firstAvailable?.id ?? "");
	}, [data, manualRefreshPending, selectedID, staleRecoveryPending, staleSkillID, visibleSkills]);

	const {
		data: detail,
		error: detailError,
		isLoading: detailLoading,
		isValidating: detailValidating,
		mutate: mutateDetail,
	} = useSWR(
		selectedID ? codexSkillKey(selectedID) : null,
		selectedID ? () => getCodexSkill(selectedID) : null,
		{ shouldRetryOnError: false },
	);

	useEffect(() => {
		if (!selectedID || !detailError || errorCode(detailError) !== 404) return;
		const missingID = selectedID;
		staleSkillIDRef.current = missingID;
		setStaleSkillID(missingID);
		setSelectedID("");
		setStaleMessage("该 Skill 已移动或删除，列表已重新扫描。");
		setStaleRecoveryPending(true);
		void mutateList()
			.catch(() => undefined)
			.finally(() => setStaleRecoveryPending(false));
	}, [detailError, mutateList, selectedID]);

	const partialIssues = useMemo(
		() => collectPartialIssues(data?.issues ?? [], data?.roots ?? []),
		[data],
	);

	const refresh = async () => {
		setManualRefreshPending(true);
		setStaleMessage("");
		setRevealError("");
		try {
			const [listResult] = await Promise.allSettled([
				mutateList(),
				selectedID ? mutateDetail() : Promise.resolve(),
			]);
			if (listResult.status === "fulfilled") {
				staleSkillIDRef.current = "";
				setStaleSkillID("");
			}
		} finally {
			setManualRefreshPending(false);
		}
	};
	const refreshBusy =
		manualRefreshPending ||
		staleRecoveryPending ||
		isValidating ||
		(Boolean(selectedID) && detailValidating);
	const statusAnnouncement = inventoryStatusAnnouncement({
		dataTotal: data?.summary.total,
		error,
		isLoading,
		isRefreshing: refreshBusy && !isLoading,
	});

	const revealDetail = async (selectedDetail: CodexSkillDetail) => {
		setRevealError("");
		try {
			await revealNativePath(selectedDetail.absolutePath);
		} catch (revealPathError) {
			setRevealError(errorMessage(revealPathError, "无法在文件管理器中定位该文件。"));
		}
	};

	return (
		<SettingsPanelLayout
			title="Codex 全局技能"
			description="只读展示 MediaGo 服务进程所在设备检测到的 Codex Skill；Codex App/CLI 使用不同 CODEX_HOME 时结果可能不同，且本清单与技能包相互独立。"
			icon={<Blocks className="size-4" />}
			contentClassName="flex flex-col overflow-y-hidden"
			actions={
				<Button
					type="button"
					variant="outline"
					aria-busy={refreshBusy}
					disabled={refreshBusy}
					onClick={() => void refresh()}
				>
					<RefreshCw className={cn("size-3.5", refreshBusy && "animate-spin")} />
					重新扫描
				</Button>
			}
		>
			<div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
				<div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
					{statusAnnouncement}
				</div>
				{isLoading ? <InventoryLoading /> : null}
				{!isLoading && error ? (
					<FatalError error={error} onRetry={() => void mutateList()} />
				) : null}
				{!isLoading && !error && data ? (
					<>
						{staleMessage ? (
							<div className="rounded-sm border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
								{staleMessage}
							</div>
						) : null}
						{data.skills.length === 0 ? (
							<>
								{partialIssues.length > 0 ? (
									<div className="flex justify-end">
										<PartialIssueIndicator issues={partialIssues} />
									</div>
								) : null}
								<EmptyInventory />
							</>
						) : (
							<>
								<InventoryFilters
									issues={partialIssues}
									query={query}
									onQueryChange={setQuery}
									source={sourceFilter}
									onSourceChange={setSourceFilter}
									status={statusFilter}
									onStatusChange={setStatusFilter}
								/>
								<div
									data-testid="codex-skill-results"
									className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(10rem,0.9fr)_minmax(0,1.1fr)] overflow-hidden rounded-sm border border-border bg-ide-panel lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-1"
								>
									<SkillList
										skills={visibleSkills}
										selectedID={selectedID}
										onSelect={setSelectedID}
										rowRefs={rowRefs}
									/>
									<SkillDetail
										detail={detail}
										error={detailError}
										isLoading={detailLoading}
										onRetry={() => void mutateDetail()}
										onReveal={revealDetail}
										revealError={revealError}
									/>
								</div>
							</>
						)}
					</>
				) : null}
			</div>
		</SettingsPanelLayout>
	);
};

const InventoryLoading: React.FC = () => (
	<div aria-label="正在扫描 Codex 技能" aria-busy="true" className="space-y-4">
		<div className="h-8 animate-pulse rounded-sm border border-border bg-muted" />
		<div className="h-[34rem] animate-pulse rounded-sm border border-border bg-muted" />
	</div>
);

const FatalError: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => (
	<Alert variant="destructive">
		<AlertTriangle />
		<AlertTitle>无法读取 Codex 技能</AlertTitle>
		<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
			<span>{errorMessage(error, "扫描服务暂时不可用。")}</span>
			<Button type="button" size="sm" variant="outline" onClick={onRetry}>
				重试
			</Button>
		</AlertDescription>
	</Alert>
);

const PartialIssueIndicator: React.FC<{ issues: CodexSkillIssue[] }> = ({ issues }) => (
	<TooltipProvider delayDuration={160}>
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="img"
					tabIndex={0}
					aria-label={`部分来源未能扫描，${issues.length} 条`}
					className="inline-flex size-8 shrink-0 cursor-help items-center justify-center rounded-control border border-warning-border bg-warning-surface text-warning-foreground shadow-sm transition-colors hover:bg-warning-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<AlertTriangle className="size-4" aria-hidden="true" />
				</span>
			</TooltipTrigger>
			<TooltipContent
				side="bottom"
				align="end"
				className="max-w-[min(32rem,calc(100vw-2rem))] p-3 text-left font-normal leading-5"
			>
				<div className="space-y-2">
					<p className="font-semibold">部分来源未能扫描</p>
					<ul className="space-y-1.5">
						{issues.map((issue, index) => (
							<li
								key={`${issue.code}-${issue.displayPath ?? issue.source ?? index}`}
								className="break-words"
							>
								{issue.displayPath ? (
									<span className="font-mono">{issue.displayPath}：</span>
								) : null}
								{issue.message}
							</li>
						))}
					</ul>
				</div>
			</TooltipContent>
		</Tooltip>
	</TooltipProvider>
);

const EmptyInventory: React.FC = () => (
	<div className="flex min-h-80 flex-col items-center justify-center rounded-sm border border-dashed border-border bg-ide-panel px-6 text-center">
		<FolderSearch className="size-8 text-muted-foreground" />
		<h3 className="mt-3 text-sm font-semibold text-foreground">尚未发现全局 Skill</h3>
		<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
			建议把需要在 Codex App、CLI 与 MediaGo 之间共享的个人 Skill 放入：
		</p>
		<code className="mt-3 rounded-sm border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground">
			~/.agents/skills/&lt;name&gt;/SKILL.md
		</code>
	</div>
);

const InventoryFilters: React.FC<{
	issues: CodexSkillIssue[];
	query: string;
	onQueryChange: (value: string) => void;
	source: SourceFilter;
	onSourceChange: (value: SourceFilter) => void;
	status: StatusFilter;
	onStatusChange: (value: StatusFilter) => void;
}> = ({ issues, query, onQueryChange, source, onSourceChange, status, onStatusChange }) => (
	<div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_minmax(9rem,auto)_minmax(9rem,auto)_auto]">
		<label className="relative block">
			<span className="sr-only">搜索 Codex 技能</span>
			<Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
			<Input
				type="search"
				aria-label="搜索 Codex 技能"
				className="pl-8"
				placeholder="搜索名称、描述或路径"
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
			/>
		</label>
		<Select value={status} onValueChange={(value) => onStatusChange(value as StatusFilter)}>
			<SelectTrigger aria-label="诊断状态">
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				<SelectItem value="all">全部状态</SelectItem>
				<SelectItem value="available">MediaGo 可用</SelectItem>
				<SelectItem value="attention">需处理</SelectItem>
				<SelectItem value="unknown">未确认</SelectItem>
			</SelectContent>
		</Select>
		<Select value={source} onValueChange={(value) => onSourceChange(value as SourceFilter)}>
			<SelectTrigger aria-label="Skill 来源">
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				<SelectItem value="all">全部来源</SelectItem>
				<SelectItem value="user_shared">个人共享</SelectItem>
				<SelectItem value="codex_home">Codex Home（兼容目录）</SelectItem>
				<SelectItem value="admin">管理员</SelectItem>
				<SelectItem value="system">系统</SelectItem>
			</SelectContent>
		</Select>
		{issues.length > 0 ? (
			<div className="justify-self-end">
				<PartialIssueIndicator issues={issues} />
			</div>
		) : null}
	</div>
);

const SkillList: React.FC<{
	skills: CodexSkillListItem[];
	selectedID: string;
	onSelect: (id: string) => void;
	rowRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
}> = ({ skills, selectedID, onSelect, rowRefs }) => {
	if (skills.length === 0) {
		return (
			<div className="flex min-h-52 items-center justify-center border-b border-border px-5 text-center text-xs text-muted-foreground lg:border-b-0 lg:border-r">
				没有匹配当前筛选条件的 Skill。
			</div>
		);
	}

	const focusableID = skills.some((skill) => skill.id === selectedID) ? selectedID : skills[0]?.id;

	const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
		let nextIndex = index;
		if (event.key === "ArrowDown") nextIndex = Math.min(index + 1, skills.length - 1);
		else if (event.key === "ArrowUp") nextIndex = Math.max(index - 1, 0);
		else if (event.key === "Home") nextIndex = 0;
		else if (event.key === "End") nextIndex = skills.length - 1;
		else return;
		event.preventDefault();
		const nextSkill = skills[nextIndex];
		if (!nextSkill) return;
		onSelect(nextSkill.id);
		window.requestAnimationFrame(() => rowRefs.current[nextSkill.id]?.focus());
	};

	return (
		<div
			data-testid="codex-skill-list"
			className="h-full min-h-0 overflow-y-auto border-b border-border lg:border-b-0 lg:border-r"
		>
			<div className="divide-y divide-border">
				{skills.map((skill, index) => (
					<button
						key={skill.id}
						ref={(node) => {
							rowRefs.current[skill.id] = node;
						}}
						type="button"
						aria-label={`${skill.displayName || skill.name}，${statusLabels[skill.mediaGo.state]}`}
						aria-current={selectedID === skill.id ? "true" : undefined}
						tabIndex={focusableID === skill.id ? 0 : -1}
						className={cn(
							"group flex w-full flex-col gap-2 px-3 py-3 text-left transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
							selectedID === skill.id && "bg-ide-list-active text-ide-list-active-foreground",
						)}
						onClick={() => onSelect(skill.id)}
						onKeyDown={(event) => handleKeyDown(event, index)}
					>
						<div className="flex w-full items-start justify-between gap-2">
							<div className="min-w-0">
								<p className="truncate text-xs font-semibold text-foreground">
									{skill.displayName || skill.name}
								</p>
								<p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
									{skill.name}
								</p>
							</div>
							<AvailabilityBadge availability={skill.mediaGo} compact />
						</div>
						<p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
							{skill.shortDescription || skill.description || "暂无描述"}
						</p>
						<div className="flex w-full flex-wrap items-center gap-1.5">
							<Badge variant="outline" className="text-2xs text-muted-foreground">
								{sourceLabels[skill.source]}
							</Badge>
							{skill.sameNameCount > 1 ? (
								<Badge className="border-warning-border bg-warning-surface text-2xs text-warning-foreground">
									同名 {skill.sameNameCount} 项
								</Badge>
							) : null}
							{skill.aliasCount > 1 ? (
								<Badge variant="outline" className="text-2xs text-muted-foreground">
									多入口 {skill.aliasCount}
								</Badge>
							) : null}
							{skill.deprecated ? (
								<Badge variant="outline" className="text-2xs text-warning-foreground">
									兼容来源
								</Badge>
							) : null}
						</div>
					</button>
				))}
			</div>
		</div>
	);
};

const SkillDetail: React.FC<{
	detail?: CodexSkillDetail;
	error: unknown;
	isLoading: boolean;
	onRetry: () => void;
	onReveal: (detail: CodexSkillDetail) => Promise<void>;
	revealError: string;
}> = ({ detail, error, isLoading, onRetry, onReveal, revealError }) => {
	if (isLoading) {
		return (
			<div
				aria-busy="true"
				className="flex min-h-64 items-center justify-center gap-2 text-xs text-muted-foreground"
			>
				<Loader2 className="size-4 animate-spin" />
				正在读取 SKILL.md
			</div>
		);
	}
	if (error && errorCode(error) !== 404) {
		return (
			<div className="flex min-h-64 flex-col items-center justify-center gap-3 px-5 text-center">
				<FileWarning className="size-7 text-error-foreground" />
				<div>
					<p className="text-sm font-medium text-foreground">无法读取 Skill 详情</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{errorMessage(error, "详情请求失败。")}
					</p>
				</div>
				<Button type="button" variant="outline" size="sm" onClick={onRetry}>
					重试详情
				</Button>
			</div>
		);
	}
	if (!detail) {
		return (
			<div className="flex min-h-64 items-center justify-center px-5 text-center text-xs text-muted-foreground">
				选择左侧 Skill 查看可用性诊断与原始文件。
			</div>
		);
	}

	return (
		<article
			data-testid="codex-skill-detail"
			className="min-h-0 min-w-0 space-y-5 overflow-y-auto p-4"
		>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-base font-semibold text-foreground">
							{detail.displayName || detail.name}
						</h3>
						{detail.sameNameCount > 1 ? (
							<Badge className="border-warning-border bg-warning-surface text-warning-foreground">
								同名 {detail.sameNameCount} 项
							</Badge>
						) : null}
					</div>
					<p className="mt-1 font-mono text-2xs text-muted-foreground">{detail.name}</p>
					<p className="mt-2 text-xs leading-5 text-muted-foreground">
						{detail.description || "暂无描述"}
					</p>
				</div>
				{isDesktopRuntime() ? (
					<Button type="button" variant="outline" size="sm" onClick={() => void onReveal(detail)}>
						<FolderSearch />
						在文件管理器中显示
					</Button>
				) : null}
			</header>

			{revealError ? (
				<div className="rounded-sm border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					{revealError}
				</div>
			) : null}

			<section aria-label="可用性诊断" className="grid gap-2 md:grid-cols-2">
				<AvailabilityCard
					title="本机 Codex（当前进程）"
					description="Codex App/CLI 需与该进程使用相同的 HOME 与 CODEX_HOME 才能得到一致结果。"
					availability={detail.appCli}
				/>
				<AvailabilityCard
					title="MediaGo Codex 运行时"
					description="基于当前中转隔离目录与 Codex 配置的预计结果。"
					availability={detail.mediaGo}
				/>
			</section>

			<section className="space-y-2">
				<h4 className="text-xs font-semibold text-foreground">发现信息</h4>
				<dl className="grid gap-x-4 gap-y-2 rounded-sm border border-border bg-muted/40 p-3 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
					<MetaRow label="来源" value={sourceLabels[detail.source]} />
					<MetaRow label="发现入口" value={`${detail.aliasCount} 个`} />
					<MetaRow
						label="隐式调用"
						value={
							detail.allowImplicitInvocation === undefined
								? "未声明"
								: detail.allowImplicitInvocation
									? "允许"
									: "不允许"
						}
					/>
					<MetaRow label="依赖" value={`${detail.dependencyCount} 项`} />
					{detail.products && detail.products.length > 0 ? (
						<MetaRow label="限定产品" value={detail.products.join("、")} />
					) : null}
					<MetaRow label="附加目录" value={resourceSummary(detail) || "无"} />
				</dl>
				<SkillOrigins detail={detail} />
			</section>

			{detail.dependencies.length > 0 ? (
				<section className="space-y-2">
					<h4 className="text-xs font-semibold text-foreground">工具依赖</h4>
					<ul className="divide-y divide-border overflow-hidden rounded-sm border border-border">
						{detail.dependencies.map((dependency, index) => (
							<li
								key={`${dependency.type}-${dependency.value}-${index}`}
								className="px-3 py-2 text-xs"
							>
								<p className="font-mono text-foreground">
									{dependency.type}: {dependency.value}
								</p>
								{dependency.description ? (
									<p className="mt-0.5 text-muted-foreground">{dependency.description}</p>
								) : null}
							</li>
						))}
					</ul>
				</section>
			) : null}

			{detail.issues.length > 0 ? (
				<section className="space-y-2">
					<h4 className="text-xs font-semibold text-foreground">Skill 诊断</h4>
					<ul className="space-y-1 rounded-sm border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
						{detail.issues.map((issue, index) => (
							<li key={`${issue.code}-${index}`}>{issue.message}</li>
						))}
					</ul>
				</section>
			) : null}

			<section className="space-y-2">
				<div className="flex items-center gap-2">
					<Code2 className="size-4 text-muted-foreground" />
					<h4 className="text-xs font-semibold text-foreground">原始 SKILL.md</h4>
				</div>
				<pre
					tabIndex={0}
					data-testid="codex-skill-raw"
					className="whitespace-pre-wrap break-words rounded-sm border border-border bg-muted p-3 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{detail.previewAvailable === false
						? previewUnavailableMessage(detail)
						: detail.rawContent || "SKILL.md 内容为空"}
				</pre>
			</section>
		</article>
	);
};

const SkillOrigins: React.FC<{ detail: CodexSkillDetail }> = ({ detail }) => {
	const origins =
		detail.origins.length > 0
			? detail.origins
			: [
					{
						deprecated: detail.deprecated,
						displayPath: detail.displayPath,
						linked: detail.linked,
						source: detail.source,
					},
				];

	return (
		<div className="overflow-hidden rounded-sm border border-border bg-ide-panel">
			<h5 className="border-b border-border px-3 py-2 text-xs font-medium text-foreground">
				全部发现入口
			</h5>
			<ul className="divide-y divide-border">
				{origins.map((origin, index) => (
					<li
						key={`${origin.source}-${origin.displayPath}-${index}`}
						className="space-y-1.5 px-3 py-2"
					>
						<div className="flex flex-wrap items-center gap-1.5">
							<Badge variant="outline" className="text-2xs text-muted-foreground">
								{sourceLabels[origin.source]}
							</Badge>
							{origin.linked ? (
								<Badge variant="outline" className="text-2xs text-muted-foreground">
									符号链接
								</Badge>
							) : null}
							{origin.deprecated ? (
								<Badge variant="outline" className="text-2xs text-warning-foreground">
									兼容来源
								</Badge>
							) : null}
						</div>
						<code className="block break-all font-mono text-xs text-foreground">
							{origin.displayPath}
						</code>
					</li>
				))}
			</ul>
		</div>
	);
};

const AvailabilityCard: React.FC<{
	title: string;
	description: string;
	availability: CodexSkillAvailability;
}> = ({ title, description, availability }) => (
	<div className="rounded-sm border border-border bg-ide-panel p-3">
		<div className="flex items-start justify-between gap-2">
			<h4 className="text-xs font-semibold text-foreground">{title}</h4>
			<AvailabilityBadge availability={availability} />
		</div>
		<p className="mt-1 text-2xs leading-4 text-muted-foreground">{description}</p>
		<p className="mt-2 text-xs leading-5 text-foreground">{availability.message}</p>
	</div>
);

const AvailabilityBadge: React.FC<{
	availability: CodexSkillAvailability;
	compact?: boolean;
}> = ({ availability, compact = false }) => {
	const Icon = statusIcon(availability.state);
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-control border px-1.5 py-0.5 font-medium",
				compact ? "text-2xs" : "text-xs",
				statusClassName(availability.state),
			)}
		>
			<Icon className="size-3" />
			{statusLabels[availability.state]}
		</span>
	);
};

const MetaRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
	label,
	value,
	mono,
}) => (
	<>
		<dt className="text-muted-foreground">{label}</dt>
		<dd className={cn("min-w-0 break-all text-foreground", mono && "font-mono")}>{value}</dd>
	</>
);

const matchesStatusFilter = (skill: CodexSkillListItem, filter: StatusFilter) => {
	if (filter === "all") return true;
	if (filter === "available") return skill.mediaGo.state === "available";
	if (filter === "unknown") {
		return skill.appCli.state === "unknown" || skill.mediaGo.state === "unknown";
	}
	return [skill.appCli.state, skill.mediaGo.state].some(
		(state) => state === "disabled" || state === "not_shared" || state === "invalid",
	);
};

const statusIcon = (state: CodexSkillAvailabilityState) => {
	if (state === "available") return CheckCircle2;
	if (state === "disabled") return CircleOff;
	if (state === "not_shared") return Unplug;
	if (state === "invalid") return FileWarning;
	return CircleHelp;
};

const statusClassName = (state: CodexSkillAvailabilityState) => {
	if (state === "available") {
		return "border-success-border bg-success-surface text-success-foreground";
	}
	if (state === "disabled" || state === "not_shared") {
		return "border-warning-border bg-warning-surface text-warning-foreground";
	}
	if (state === "invalid") return "border-error-border bg-error-surface text-error-foreground";
	return "border-info-border bg-info-surface text-info-foreground";
};

const collectPartialIssues = (
	issues: CodexSkillIssue[],
	roots: Array<{
		source: CodexSkillSource;
		displayPath: string;
		error?: string;
	}>,
) => {
	const collected = [...issues];
	for (const root of roots) {
		if (!root.error) continue;
		const alreadyReported = collected.some(
			(issue) => issue.source === root.source && issue.displayPath === root.displayPath,
		);
		if (alreadyReported) continue;
		collected.push({
			code: "root_unreadable",
			displayPath: root.displayPath,
			message: root.error,
			source: root.source,
		});
	}
	return collected;
};

const resourceSummary = (detail: CodexSkillDetail) =>
	[
		detail.hasScripts ? "scripts" : "",
		detail.hasReferences ? "references" : "",
		detail.hasAssets ? "assets" : "",
	]
		.filter(Boolean)
		.join("、");

const previewUnavailableMessage = (detail: CodexSkillDetail) =>
	detail.issues.find((issue) => issue.code === "preview_unavailable")?.message ??
	"原始 SKILL.md 预览不可用";

const inventoryStatusAnnouncement = ({
	dataTotal,
	error,
	isLoading,
	isRefreshing,
}: {
	dataTotal?: number;
	error: unknown;
	isLoading: boolean;
	isRefreshing: boolean;
}) => {
	if (isLoading) return "正在扫描 Codex 技能";
	if (error) return "Codex 技能扫描失败";
	if (isRefreshing) return "正在重新扫描 Codex 技能";
	if (dataTotal !== undefined) return `扫描完成，共发现 ${dataTotal} 个 Codex 技能`;
	return "";
};

const errorCode = (error: unknown) => {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	return Number((error as { code?: unknown }).code);
};

const errorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error && error.message) return error.message;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message) return message;
	}
	return fallback;
};
