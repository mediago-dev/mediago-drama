import { Loader2, Paperclip, SendHorizontal, Square } from "lucide-react";
import type React from "react";
import type { AgentRuntimeConfigPayload } from "@/domains/agent/api/agent";
import {
	AgentComposer,
	type AgentComposerHandle,
	type AgentComposerState,
} from "@/domains/agent/components/AgentComposer";
import type { AgentSkillSlashItem } from "@/domains/agent/components/AgentSkillSlashMenu";
import { AgentCommentContextStrip } from "@/domains/agent/components/chat/AgentCommentContext";
import { Button } from "@/shared/components/ui/button";
import { AgentRuntimeConfigControls } from "@/domains/agent/components/chat/AgentRuntimeConfigControls";
import {
	agentAttachmentAccept,
	AttachmentChip,
	type AgentAttachment,
} from "@/domains/agent/components/chat/AgentAttachments";
import type { DocumentComment } from "@/domains/documents/stores";

const defaultComposerPlaceholder = "告诉智能体要在当前文档中插入或改写什么";
const referenceComposerPlaceholder =
	"问我关于这份资料的任何问题：整理前 30 章、梳理人物与剧情、概括全文…";

export type ComposerContext = "default" | "reference";

export const AgentChatComposerForm: React.FC<{
	attachments: AgentAttachment[];
	canSubmit: boolean;
	composerContext: ComposerContext;
	composerRef: React.RefObject<AgentComposerHandle | null>;
	disabled: boolean;
	fileInputRef: React.RefObject<HTMLInputElement | null>;
	isRuntimeConfigLoading: boolean;
	isSkillsLoading: boolean;
	isStopping: boolean;
	openComments: DocumentComment[];
	onAttachFiles: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onComposerChange: (nextState: AgentComposerState) => void;
	onModelChange: (value: string) => void;
	onOpenRuntimeSettings: () => void;
	onPermissionChange: (value: string) => void;
	onReasoningChange: (value: string) => void;
	onRemoveAttachment: (id: string) => void;
	onRemoveComment: (id: string) => void;
	onRetryRuntimeConfig: () => void;
	onRunPrompt: () => void;
	onStopRun: () => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	permissionValue: string;
	reasoningValue: string;
	runtimeConfig?: AgentRuntimeConfigPayload;
	runtimeConfigErrorMessage: string;
	selectedModel: string;
	skillItems: AgentSkillSlashItem[];
	skillsErrorMessage: string;
}> = ({
	attachments,
	canSubmit,
	composerContext,
	composerRef,
	disabled,
	fileInputRef,
	isRuntimeConfigLoading,
	isSkillsLoading,
	isStopping,
	openComments,
	onAttachFiles,
	onComposerChange,
	onModelChange,
	onOpenRuntimeSettings,
	onPermissionChange,
	onReasoningChange,
	onRemoveAttachment,
	onRemoveComment,
	onRetryRuntimeConfig,
	onRunPrompt,
	onStopRun,
	onSubmit,
	permissionValue,
	reasoningValue,
	runtimeConfig,
	runtimeConfigErrorMessage,
	selectedModel,
	skillItems,
	skillsErrorMessage,
}) => (
	<form onSubmit={onSubmit} className="agent-composer-form">
		{attachments.length > 0 || openComments.length > 0 ? (
			<div className="agent-context-strip mb-2 flex min-w-0 flex-nowrap gap-1.5 overflow-hidden">
				{attachments.map((attachment) => (
					<AttachmentChip
						key={attachment.id}
						attachment={attachment}
						disabled={disabled}
						onRemove={() => onRemoveAttachment(attachment.id)}
					/>
				))}
				<AgentCommentContextStrip
					comments={openComments}
					disabled={disabled}
					onRemove={onRemoveComment}
				/>
			</div>
		) : null}
		<input
			ref={fileInputRef}
			type="file"
			multiple
			accept={agentAttachmentAccept}
			className="hidden"
			onChange={onAttachFiles}
		/>
		<div className="agent-composer-row flex items-end gap-2">
			<AgentComposer
				ref={composerRef}
				className="agent-composer-main"
				disabled={disabled}
				placeholder={
					openComments.length > 0
						? "可直接发送，让智能体处理未解决批注"
						: composerContext === "reference"
							? referenceComposerPlaceholder
							: defaultComposerPlaceholder
				}
				onChange={onComposerChange}
				onSubmit={() => {
					if (!canSubmit || disabled) return;
					onRunPrompt();
				}}
				skillItems={skillItems}
				skillsErrorMessage={skillsErrorMessage}
				skillsLoading={isSkillsLoading}
			/>
		</div>
		<div className="agent-composer-footer">
			<AgentRuntimeConfigControls
				config={runtimeConfig}
				modelValue={selectedModel}
				reasoningValue={reasoningValue}
				permissionValue={permissionValue}
				disabled={disabled}
				errorMessage={runtimeConfigErrorMessage}
				isLoading={isRuntimeConfigLoading}
				onModelChange={onModelChange}
				onOpenSettings={onOpenRuntimeSettings}
				onReasoningChange={onReasoningChange}
				onPermissionChange={onPermissionChange}
				onRetry={onRetryRuntimeConfig}
			/>
			<div className="agent-composer-actions">
				<span className="agent-composer-hint">@ 引用文档 · Enter 发送</span>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="agent-composer-icon-button"
					aria-label="上传附件"
					disabled={disabled}
					onClick={() => fileInputRef.current?.click()}
				>
					<Paperclip />
				</Button>
				{disabled ? (
					<Button
						type="button"
						size="sm"
						variant="destructive"
						className="agent-stop-button h-8 px-2.5"
						aria-label="终止运行"
						disabled={isStopping}
						onClick={onStopRun}
					>
						{isStopping ? <Loader2 className="animate-spin" /> : <Square />}
						<span>停止</span>
					</Button>
				) : (
					<Button
						type="submit"
						size="sm"
						className="agent-send-button h-8 px-2.5"
						aria-label="发送消息"
						disabled={!canSubmit}
					>
						<SendHorizontal />
						<span>发送</span>
					</Button>
				)}
			</div>
		</div>
	</form>
);
