import { CheckCircle2, RotateCcw, Workflow } from "lucide-react";
import type React from "react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { AgentPlan } from "@/domains/agent/components/AgentPlan";
import { selectAgentRecordActivity, useAgentStore } from "@/domains/agent/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";

export const AgentOperations: React.FC = () => {
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const operationLog = useDocumentsStore((state) => state.operationLog);
	const undoLastOperation = useDocumentsStore((state) => state.undoLastOperation);
	const recordActivity = useAgentStore(selectAgentRecordActivity);
	const activeLog = operationLog.filter((entry) => entry.documentId === activeDocumentId);
	const canUndo = activeLog.some((entry) => !entry.undoneAt);

	const undo = () => {
		const didUndo = undoLastOperation(activeDocumentId);
		if (didUndo) {
			recordActivity("patch", "已撤销操作", "已恢复到上一次操作前的文档快照。");
		}
	};

	return (
		<section className="flex h-full min-h-0 flex-col bg-ide-panel">
			<div className="border-b border-border bg-ide-toolbar">
				<AgentPlan />
			</div>
			<div className="flex items-center justify-between border-b border-border bg-ide-toolbar px-3 py-2">
				<div className="min-w-0">
					<h2 className="text-sm font-semibold text-foreground">操作日志</h2>
					<p className="text-xs text-muted-foreground">智能体和剪辑台的编辑都可以撤销。</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-8 rounded-sm"
					onClick={undo}
					disabled={!canUndo}
				>
					<RotateCcw />
					<span>撤销</span>
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{activeLog.length > 0 ? (
					activeLog.map((entry) => (
						<article
							key={entry.id}
							className={cn(
								"border-b border-border bg-ide-panel px-2 py-2 last:border-b-0",
								entry.undoneAt && "opacity-60",
							)}
						>
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<Workflow className="size-3.5 shrink-0 text-muted-foreground" />
										<p className="truncate text-xs font-medium text-foreground">{entry.summary}</p>
									</div>
									<p className="mt-1 text-xs text-muted-foreground">
										{entry.operations.length} 个操作 ·{" "}
										{new Date(entry.createdAt).toLocaleTimeString("zh-CN")}
									</p>
								</div>
								<Badge variant={entry.undoneAt ? "outline" : "secondary"}>
									{entry.undoneAt ? "已撤销" : formatOperationSource(entry.source)}
								</Badge>
							</div>
							<div className="mt-2 space-y-1">
								{entry.operations.map((operation) => (
									<div
										key={operation.id}
										className="flex items-center justify-between gap-2 bg-ide-toolbar px-2 py-1 text-xs"
									>
										<span className="truncate text-foreground">
											{operationTypeLabel[operation.type] ?? operation.type}
										</span>
										<CheckCircle2 className="size-3 text-muted-foreground" />
									</div>
								))}
							</div>
						</article>
					))
				) : (
					<p className="m-2 border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
						暂无文档操作。
					</p>
				)}
			</div>
		</section>
	);
};

const sourceLabel: Record<string, string> = {
	agent: "智能体",
	user: "用户",
	workbench: "剪辑台",
};

const formatOperationSource = (source: string) => {
	if (source.startsWith("agent:")) return `智能体:${source.slice("agent:".length)}`;
	return sourceLabel[source] ?? source;
};

const operationTypeLabel: Record<string, string> = {
	insert_markdown: "插入 Markdown",
	insert_section: "插入章节",
	update_block: "替换块",
	replace_text: "替换文本",
	delete_section: "删除章节",
	replace_section: "替换章节",
	reorder_sections: "重排章节",
	streaming_document_edit: "旧版流式编辑",
	document_patch_edit: "局部编辑",
	document_replace_edit: "全文替换",
	document_template_edit: "模板填写",
	document_title_edit: "更新标题",
	document_metadata_edit: "更新文档信息",
	update_document_metadata: "更新文档信息",
	add_comment: "新增批注",
	resolve_comment: "解决批注",
};
