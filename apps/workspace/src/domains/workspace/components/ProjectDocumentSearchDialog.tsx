import { CornerDownLeft, FileText, Loader2, Search, X, type LucideIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import { getWorkspaceDocuments } from "@/domains/workspace/api/workspace";
import { Button } from "@/shared/components/ui/button";
import {
	dialogContentMotion,
	dialogOverlayMotion,
	useDialogPresence,
} from "@/shared/components/ui/dialog-motion";
import { Input } from "@/shared/components/ui/input";
import {
	documentCategoryDescriptorMap,
	documentCategoryDescriptors,
} from "@/domains/documents/lib/categories";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";

interface ProjectDocumentSearchDialogProps {
	onOpenChange: (open: boolean) => void;
	onOpenDocument: (project: WorkspaceProject, documentId: string) => void;
	open: boolean;
	projects: WorkspaceProject[];
	scopeLabel?: string;
}

interface RemoteDocumentSet {
	documents: MarkdownDocument[];
	projectId: string;
}

interface SearchRecord {
	categoryIcon: LucideIcon;
	categoryLabel: string;
	document: MarkdownDocument;
	project: WorkspaceProject;
}

interface SearchResult extends SearchRecord {
	matchLabel: string;
	score: number;
	snippet: string;
}

const maxResults = 40;
const recentResults = 16;

export const ProjectDocumentSearchDialog: React.FC<ProjectDocumentSearchDialogProps> = ({
	onOpenChange,
	onOpenDocument,
	open,
	projects,
	scopeLabel = "所有项目",
}) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const storeDocuments = useDocumentsStore((state) => state.documents);
	const storeProjectId = useDocumentsStore((state) => state.projectId);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const present = useDialogPresence(open);

	const projectsById = useMemo(
		() => new Map(projects.map((project) => [project.id, project])),
		[projects],
	);
	const remoteProjectIds = useMemo(
		() =>
			projects
				.filter((project) => project.id !== storeProjectId)
				.map((project) => project.id)
				.sort(),
		[projects, storeProjectId],
	);
	const remoteProjectKey = remoteProjectIds.join("|");
	const {
		data: remoteDocumentSets,
		error,
		isLoading,
	} = useSWR<RemoteDocumentSet[]>(
		open && remoteProjectIds.length > 0 ? ["project-document-search", remoteProjectKey] : null,
		async () =>
			Promise.all(
				remoteProjectIds.map(async (projectId) => {
					const payload = await getWorkspaceDocuments(projectId);
					return { projectId, documents: payload.documents };
				}),
			),
	);
	const records = useMemo(() => {
		const next: SearchRecord[] = [];
		if (storeProjectId) {
			const project = projectsById.get(storeProjectId);
			if (project) pushDocumentRecords(next, project, storeDocuments);
		}
		for (const remoteSet of remoteDocumentSets ?? []) {
			const project = projectsById.get(remoteSet.projectId);
			if (!project) continue;
			pushDocumentRecords(next, project, remoteSet.documents);
		}
		return next;
	}, [projectsById, remoteDocumentSets, storeDocuments, storeProjectId]);
	const results = useMemo(() => searchDocuments(records, query), [records, query]);
	const hasQuery = query.trim().length > 0;
	const activeResult = results[activeIndex];

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActiveIndex(0);
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onOpenChange(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange, open]);

	if (!present) return null;

	const dialogState = open ? "open" : "closed";

	const openResult = (result: SearchResult | undefined) => {
		if (!result) return;
		onOpenDocument(result.project, result.document.id);
		onOpenChange(false);
	};

	return createPortal(
		<div
			data-state={dialogState}
			className={cn(
				"fixed inset-0 z-[var(--z-index-modal)] flex items-start justify-center bg-background/70 px-4 pt-[var(--search-dialog-offset-top)] backdrop-blur-xs",
				dialogOverlayMotion,
				!open && "pointer-events-none",
			)}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onOpenChange(false);
			}}
		>
			<div
				data-state={dialogState}
				role="dialog"
				aria-modal="true"
				aria-label={`搜索${scopeLabel}文档`}
				className={cn(
					"flex max-h-[var(--search-dialog-max-height)] w-full max-w-[var(--search-dialog-max-width)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl",
					dialogContentMotion,
				)}
			>
				<div className="flex h-12 items-center gap-2 border-b border-border px-4">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<Input
						ref={inputRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								setActiveIndex((index) => Math.max(index - 1, 0));
							} else if (event.key === "Enter") {
								event.preventDefault();
								openResult(activeResult);
							}
						}}
						placeholder={`搜索${scopeLabel}文档标题和正文`}
						className="h-10 border-transparent bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-8 text-muted-foreground"
						onClick={() => onOpenChange(false)}
						aria-label="关闭搜索"
					>
						<X className="size-4" />
					</Button>
				</div>

				<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
					<span>
						{hasQuery
							? `找到 ${results.length} 个匹配`
							: isLoading
								? `正在加载${scopeLabel}文档`
								: "最近文档"}
					</span>
					<div className="flex items-center gap-3">
						{isLoading ? (
							<span className="flex items-center gap-1.5">
								<Loader2 className="size-3.5 animate-spin" />
								加载中
							</span>
						) : null}
						<span className="hidden items-center gap-1 sm:flex">
							<CornerDownLeft className="size-3.5" />
							打开
						</span>
					</div>
				</div>

				<div className="min-h-[var(--search-dialog-results-min-height)] overflow-y-auto p-2">
					{error ? (
						<div className="px-3 py-8 text-center text-sm text-error-foreground">
							部分项目文档加载失败，请稍后再试。
						</div>
					) : null}
					{results.length > 0 ? (
						<div className="space-y-1">
							{results.map((result, index) => {
								const CategoryIcon = result.categoryIcon;
								const isActive = index === activeIndex;
								return (
									<button
										type="button"
										key={`${result.project.id}:${result.document.id}`}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => openResult(result)}
										className={cn(
											"flex w-full items-start gap-3 rounded-sm px-3 py-2 text-left transition-colors",
											isActive
												? "bg-ide-list-active text-ide-list-active-foreground"
												: "hover:bg-ide-list-hover",
										)}
									>
										<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm bg-ide-toolbar text-muted-foreground">
											<FileText className="size-4" />
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex min-w-0 items-center gap-2">
												<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
													{result.document.title || "未命名文档"}
												</span>
												<span className="shrink-0 text-xs text-muted-foreground">
													{result.project.name}
												</span>
											</div>
											<div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
												<CategoryIcon className="size-3.5 shrink-0" />
												<span className="shrink-0">{result.categoryLabel}</span>
												<span className="shrink-0">·</span>
												<span className="shrink-0">{result.matchLabel}</span>
												<span className="min-w-0 truncate">{result.snippet}</span>
											</div>
										</div>
									</button>
								);
							})}
						</div>
					) : (
						<div className="flex min-h-[var(--search-dialog-results-min-height)] items-center justify-center px-8 text-center text-sm text-muted-foreground">
							{hasQuery ? "没有找到匹配的文档" : `输入关键词搜索${scopeLabel}里的文档标题和正文`}
						</div>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
};

const pushDocumentRecords = (
	records: SearchRecord[],
	project: WorkspaceProject,
	documents: MarkdownDocument[],
) => {
	for (const document of documents) {
		if (isOverviewDocumentId(document.id)) continue;
		const descriptor =
			documentCategoryDescriptorMap[document.category ?? "reference"] ??
			documentCategoryDescriptors.at(-1);
		if (!descriptor) continue;
		records.push({
			categoryIcon: descriptor.icon,
			categoryLabel: descriptor.label,
			document,
			project,
		});
	}
};

const searchDocuments = (records: SearchRecord[], query: string): SearchResult[] => {
	const normalizedQuery = normalizeSearchText(query);
	if (!normalizedQuery) {
		return [...records]
			.sort(
				(first, second) =>
					Date.parse(second.document.updatedAt) - Date.parse(first.document.updatedAt),
			)
			.slice(0, recentResults)
			.map((record) => ({
				...record,
				matchLabel: "最近更新",
				score: 0,
				snippet: createSnippet(record.document.content, ""),
			}));
	}

	return records
		.map((record) => scoreRecord(record, normalizedQuery))
		.filter((result): result is SearchResult => Boolean(result))
		.sort(
			(first, second) =>
				second.score - first.score ||
				Date.parse(second.document.updatedAt) - Date.parse(first.document.updatedAt),
		)
		.slice(0, maxResults);
};

const scoreRecord = (record: SearchRecord, query: string): SearchResult | null => {
	const title = normalizeSearchText(record.document.title);
	const content = normalizeSearchText(record.document.content);
	const titleIndex = title.indexOf(query);
	const contentIndex = content.indexOf(query);
	if (titleIndex === -1 && contentIndex === -1) return null;

	const titleScore = titleIndex === 0 ? 120 : titleIndex > 0 ? 90 : 0;
	const contentScore = contentIndex >= 0 ? 45 : 0;
	const matchLabel = titleIndex >= 0 ? "标题匹配" : "正文匹配";
	return {
		...record,
		matchLabel,
		score: titleScore + contentScore,
		snippet: createSnippet(record.document.content, query),
	};
};

const normalizeSearchText = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const createSnippet = (content: string, query: string) => {
	const normalizedContent = content.replace(/\s+/g, " ").trim();
	if (!normalizedContent) return "无正文内容";
	if (!query) return truncateSnippet(normalizedContent);

	const index = normalizedContent.toLowerCase().indexOf(query);
	if (index === -1) return truncateSnippet(normalizedContent);

	const start = Math.max(index - 28, 0);
	const end = Math.min(index + query.length + 64, normalizedContent.length);
	const prefix = start > 0 ? "..." : "";
	const suffix = end < normalizedContent.length ? "..." : "";
	return `${prefix}${normalizedContent.slice(start, end)}${suffix}`;
};

const truncateSnippet = (content: string) =>
	content.length > 96 ? `${content.slice(0, 96)}...` : content;
