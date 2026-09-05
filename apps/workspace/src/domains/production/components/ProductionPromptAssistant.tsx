import { Check, ChevronRight, Link2, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { AgentPanel } from "@/domains/agent/components/AgentPanel";
import { createAgentSession } from "@/domains/agent/api/agent";
import { selectAgentMessages } from "@/domains/agent/stores/selectors";
import { setPersistedAgentSessionId } from "@/domains/agent/stores/persistence";
import { useAgentStore } from "@/domains/agent/stores/store";
import {
	buildContinuityRule,
	continuityDimensions,
	promptFromAssistantReply,
	type ContinuityDimension,
} from "@/domains/production/lib/prompt-continuity";
import { Button } from "@/shared/components/ui/button";

interface PromptAssistantAsset {
	id: string;
	name: string;
	prompt: string;
	shotIds: string[];
}

interface ProductionPromptAssistantProps {
	assets: PromptAssistantAsset[];
	onPromptChange: (assetId: string, prompt: string) => void;
	onRulesChange: (rules: string[]) => void;
	onClose: () => void;
	projectId: string;
	projectName: string;
	rules: string[];
	requestedAsset?: { id: string; requestId: number } | null;
	shotCodes: string[];
}

const sessionErrorMessage = (error: unknown) => {
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof error.message === "string" &&
		error.message.trim()
	)
		return error.message;
	return "新建独立会话失败，请重试。";
};

export const ProductionPromptAssistant: React.FC<ProductionPromptAssistantProps> = ({
	assets,
	onPromptChange,
	onRulesChange,
	onClose,
	projectId,
	projectName,
	rules,
	requestedAsset,
	shotCodes,
}) => {
	const location = useLocation();
	const navigate = useNavigate();
	const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id ?? "");
	const [fromShot, setFromShot] = useState(shotCodes[0] ?? "");
	const [toShot, setToShot] = useState(shotCodes[1] ?? shotCodes[0] ?? "");
	const [condition, setCondition] = useState("");
	const [dimensions, setDimensions] = useState<ContinuityDimension[]>([
		"人物身份",
		"服装与材质",
		"色彩与光线",
	]);
	const [dockRoot, setDockRoot] = useState<HTMLElement | null>(null);
	const [sessionError, setSessionError] = useState("");
	const [editingSessionId, setEditingSessionId] = useState("");
	const appliedReplyIdRef = useRef("");
	const agentMessages = useAgentStore(selectAgentMessages);
	const agentSessionId = useAgentStore((state) => state.sessionId);
	const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];
	const uniqueShotCodes = useMemo(
		() => [...new Set([...shotCodes, ...assets.flatMap((asset) => asset.shotIds)])].filter(Boolean),
		[assets, shotCodes],
	);

	useEffect(() => {
		if (!selectedAssetId && assets[0]) setSelectedAssetId(assets[0].id);
	}, [assets, selectedAssetId]);

	useEffect(() => {
		setDockRoot(document.getElementById("production-assistant-dock-root"));
	}, []);

	const pinAssetCard = (assetId: string) => {
		window.requestAnimationFrame(() =>
			window.requestAnimationFrame(() =>
				document
					.getElementById(`asset-prompt-card-${assetId}`)
					?.scrollIntoView({ behavior: "smooth", block: "start" }),
			),
		);
	};

	const openNewConversationWithPrompt = async (asset = selectedAsset) => {
		if (!asset) return;
		setSessionError("");
		setEditingSessionId("");
		pinAssetCard(asset.id);
		try {
			const session = await createAgentSession(projectId, true);
			useAgentStore.getState().hydrateAgentChatState([], [], {
				sessionId: session.sessionId,
				lastEventId: null,
				running: false,
			});
			setPersistedAgentSessionId(projectId, session.sessionId);
			appliedReplyIdRef.current = "";
			setEditingSessionId(session.sessionId);
			const params = new URLSearchParams(location.search);
			params.set("projectId", projectId);
			params.set("agentSessionId", session.sessionId);
			navigate(`${location.pathname}?${params.toString()}`, {
				replace: true,
				state: location.state,
			});
			useAgentStore.getState().seedComposer({
				focus: true,
				text: `请作为 AIGC 制作 Prompt 编辑协助我修改下面这条资产 Prompt。先和我确认要改变的变量；保持人物身份、产品结构、材质与项目 Visual DNA 等已锁定项。最终版本请使用“【修改后 Prompt】”标题单独输出，不要省略原有必要约束。\n\n项目：${projectName}\n资产：${asset.id} · ${asset.name}\n使用镜头：${asset.shotIds.join("、") || "待绑定"}\n跨镜规则：\n${rules.map((rule) => `- ${rule}`).join("\n") || "- 暂无"}\n\n当前 Prompt：\n${asset.prompt}`,
			});
		} catch (error) {
			// The shared HTTP client rejects API responses as plain objects rather
			// than Error instances. Preserve that message so a failed local service
			// is diagnosable instead of leaving a generic, half-open assistant.
			setSessionError(sessionErrorMessage(error));
		}
	};

	useEffect(() => {
		if (!requestedAsset) return;
		const asset = assets.find((item) => item.id === requestedAsset.id);
		if (!asset) return;
		setSelectedAssetId(asset.id);
		void openNewConversationWithPrompt(asset);
		// requestId intentionally makes repeated clicks on the same asset actionable.
	}, [requestedAsset?.requestId]);

	useEffect(() => {
		if (!requestedAsset) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", closeOnEscape);
		return () => document.removeEventListener("keydown", closeOnEscape);
	}, [onClose, requestedAsset]);

	useEffect(() => {
		if (
			!requestedAsset ||
			!selectedAsset ||
			!editingSessionId ||
			agentSessionId !== editingSessionId
		)
			return;
		const latest = [...agentMessages]
			.reverse()
			.find(
				(message) =>
					message.role === "assistant" &&
					message.status !== "streaming" &&
					message.status !== "error" &&
					/【修改后\s*Prompt】/iu.test(message.content),
			);
		if (!latest || latest.id === appliedReplyIdRef.current) return;
		const revised = promptFromAssistantReply(latest.content);
		if (!revised) return;
		appliedReplyIdRef.current = latest.id;
		onPromptChange(selectedAsset.id, revised);
		pinAssetCard(selectedAsset.id);
	}, [
		agentMessages,
		agentSessionId,
		editingSessionId,
		onPromptChange,
		requestedAsset,
		selectedAsset,
	]);

	const addRule = () => {
		const rule = buildContinuityRule(fromShot, toShot, dimensions, condition);
		if (!rule) return;
		onRulesChange([...rules.filter((item) => !item.startsWith(`${toShot} 继承 `)), rule]);
		setCondition("");
	};

	if (!requestedAsset || !selectedAsset || !dockRoot) return null;

	return createPortal(
		<section
			id="production-prompt-assistant"
			className="flex h-[min(58vh,620px)] min-h-[360px] w-full animate-in flex-col overflow-hidden border-t border-primary/25 bg-background shadow-[0_-10px_28px_rgba(0,0,0,0.12)] slide-in-from-bottom-4"
		>
			<div className="relative shrink-0 border-b border-border bg-muted/30 px-3 py-2 pr-12">
				<div className="grid min-w-0 gap-1.5">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<Link2 className="size-4 shrink-0 text-primary" />
						<select
							aria-label="来源镜头"
							className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs"
							value={fromShot}
							onChange={(event) => setFromShot(event.target.value)}
						>
							{uniqueShotCodes.map((code) => (
								<option key={code}>{code}</option>
							))}
						</select>
						<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
						<select
							aria-label="目标镜头"
							className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs"
							value={toShot}
							onChange={(event) => setToShot(event.target.value)}
						>
							{uniqueShotCodes.map((code) => (
								<option key={code}>{code}</option>
							))}
						</select>
						<div className="flex min-w-0 flex-1 flex-wrap gap-1">
							{continuityDimensions.map((item) => {
								const selected = dimensions.includes(item);
								return (
									<button
										key={item}
										type="button"
										aria-pressed={selected}
										onClick={() =>
											setDimensions((current) =>
												selected ? current.filter((value) => value !== item) : [...current, item],
											)
										}
										className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${selected ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
									>
										{selected ? <Check className="size-3" /> : null}
										{item}
									</button>
								);
							})}
						</div>
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<input
							value={condition}
							onChange={(event) => setCondition(event.target.value)}
							placeholder="允许变化或例外，例如：只改变表情和景别，人物仍在画面左侧。"
							className="h-8 min-w-72 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
						/>
						<Button
							size="sm"
							variant="outline"
							disabled={!fromShot || !toShot || fromShot === toShot}
							onClick={addRule}
						>
							保存继承规则
						</Button>
						{rules.length > 0 ? (
							<div className="flex flex-wrap gap-1">
								{rules.map((rule, index) => (
									<button
										key={rule}
										type="button"
										title={`${rule}（点击删除）`}
										className="shrink-0 rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground hover:text-destructive"
										onClick={() => onRulesChange(rules.filter((item) => item !== rule))}
									>
										规则 {index + 1} ×
									</button>
								))}
							</div>
						) : null}
					</div>
				</div>
				{sessionError ? <p className="text-[10px] text-destructive">{sessionError}</p> : null}
				<Button
					variant="ghost"
					size="icon"
					className="absolute right-2 top-2"
					onClick={onClose}
					aria-label="收起底部智能调整"
				>
					<X className="size-4" />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-hidden">
				<AgentPanel embedded hideHeader />
			</div>
		</section>,
		dockRoot,
	);
};
