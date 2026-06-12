import { FilePenLine, MessageSquareText, Send, Sparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { runAgentPrompt } from "@/domains/agent/lib/controller";
import { getOpenComments, selectDocumentById } from "@/domains/documents/lib/filters";
import {
	selectAgentIsConnected,
	selectAgentIsRunning,
	selectAgentLastRuntimeStatus,
	useAgentStore,
} from "@/domains/agent/stores";
import { useDocumentsStore } from "@/domains/documents/stores";

export const AgentInstructions: React.FC = () => {
	const isConnected = useAgentStore(selectAgentIsConnected);
	const isRunning = useAgentStore(selectAgentIsRunning);
	const lastRuntimeStatus = useAgentStore(selectAgentLastRuntimeStatus);
	const documents = useDocumentsStore((state) => state.documents);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const selection = useDocumentsStore((state) => state.selection);
	const [prompt, setPrompt] = useState("");
	const activeDocument = selectDocumentById(documents, activeDocumentId);
	const selectedText =
		selection && activeDocument && selection.documentId === activeDocument.id ? selection.text : "";
	const openCommentCount = getOpenComments(activeDocument?.comments ?? []).length;
	const canSend = !isRunning && prompt.trim().length > 0;

	const submitPrompt = async () => {
		if (!canSend) return;
		const nextPrompt = prompt.trim();
		setPrompt("");
		await runAgentPrompt(nextPrompt);
	};

	const rewriteSelection = async () => {
		if (isRunning || !selectedText) return;
		await runAgentPrompt("", {
			displayPrompt: "改写选中",
			selection: selectedText,
		});
	};

	const applyOpenComments = async () => {
		if (isRunning || openCommentCount === 0) return;
		await runAgentPrompt("", {
			displayPrompt: "处理未解决批注",
		});
	};

	const runtimeLabel = isRunning
		? "运行中"
		: lastRuntimeStatus.runtime !== "unknown"
			? lastRuntimeStatus.fallback
				? `${runtimeName(lastRuntimeStatus.runtime)} 备用`
				: runtimeName(lastRuntimeStatus.runtime)
			: isConnected
				? "本地运行时"
				: "就绪";

	return (
		<section className="flex h-full min-h-0 flex-col bg-ide-panel">
			<div className="flex items-center justify-between border-b border-border bg-ide-toolbar px-3 py-2 text-ide-toolbar-foreground">
				<h2 className="text-sm font-semibold text-foreground">指令</h2>
				<span className="text-xs text-muted-foreground">{runtimeLabel}</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
				<div className="space-y-2">
					<div className="border border-border bg-ide-editor p-2">
						<div className="mb-2 flex items-center gap-2">
							<div className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-foreground">
								<Sparkles className="size-4" />
							</div>
							<div className="min-w-0">
								<p className="text-xs font-medium text-foreground">MediaGo Drama 智能体</p>
								<p className="text-xs text-muted-foreground">本地文档树助手</p>
							</div>
						</div>
						<Textarea
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							placeholder="输入要处理的文档任务"
							className="min-h-28 resize-none text-xs"
							disabled={isRunning}
							onKeyDown={(event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
									event.preventDefault();
									void submitPrompt();
								}
							}}
						/>
						<Button
							type="button"
							size="sm"
							className="mt-2 w-full"
							onClick={() => void submitPrompt()}
							disabled={!canSend}
						>
							<Send />
							<span>发送</span>
						</Button>
					</div>
					<div className="grid grid-cols-2 gap-1.5">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => void rewriteSelection()}
							disabled={isRunning || !selectedText}
						>
							<FilePenLine />
							<span>改写选中</span>
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => void applyOpenComments()}
							disabled={isRunning || openCommentCount === 0}
						>
							<MessageSquareText />
							<span>处理批注</span>
						</Button>
					</div>
					<div className="flex flex-wrap gap-1.5">
						<Badge variant={selectedText ? "secondary" : "outline"}>
							{selectedText ? "已选择文本" : "未选择文本"}
						</Badge>
						<Badge variant={openCommentCount > 0 ? "secondary" : "outline"}>
							{openCommentCount} 条批注
						</Badge>
						<Badge variant={lastRuntimeStatus.fallback ? "secondary" : "outline"}>
							{runtimeName(lastRuntimeStatus.runtime)}
						</Badge>
					</div>
				</div>
			</div>
		</section>
	);
};

const runtimeName = (runtime: string) => {
	if (runtime === "acp") return "ACP";
	if (runtime === "mock" || runtime === "frontend-mock") return "模拟运行时";
	return "未知";
};
