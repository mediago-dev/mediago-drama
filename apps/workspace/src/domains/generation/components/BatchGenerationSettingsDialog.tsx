import { Check, Sparkles } from "lucide-react";
import type React from "react";
import type {
	GenerationFamily,
	GenerationPromptOptimizationRequest,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import {
	generationSettingsValueForSubmit,
	type GenerationPromptSupplementValue,
} from "@/domains/generation/components/generationSettingsValue";
import { useGenerationSettingsForm } from "@/domains/generation/hooks/useGenerationSettingsForm";
import type { BatchGenerationDialogKind } from "@/domains/generation/stores/batch-generation-settings";
import { Badge } from "@/shared/components/ui/badge";
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { GenerationSettingsForm } from "./GenerationSettingsForm";

export interface BatchGenerationSettings {
	family: GenerationFamily;
	params: Record<string, unknown>;
	promptOptimization?: GenerationPromptOptimizationRequest;
	promptSupplements?: GenerationPromptSupplementValue[];
	referenceAssetIds?: string[];
	route: GenerationRoute;
	version: GenerationVersion;
}

export type BatchGenerationPromptSupplement = GenerationPromptSupplementValue;

export const batchGenerationConfirmButtonLabel = (optimizePrompt: boolean) =>
	optimizePrompt ? "优化并生成" : "生成";

export const BatchGenerationSettingsDialog: React.FC<{
	kind: BatchGenerationDialogKind;
	onConfirm: (settings: BatchGenerationSettings) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	projectId?: string;
	selectedCount: number;
}> = ({ kind, onConfirm, onOpenChange, open, projectId, selectedCount }) => (
	<GenerationModalShell
		open={open}
		title={`批量生成${kind === "image" ? "图片" : "视频"}设置`}
		titleAside={
			<Badge variant="secondary" className="shrink-0">
				已选 {selectedCount} 项
			</Badge>
		}
		titleId={`batch-generation-settings-${kind}-title`}
		contentClassName="h-[min(88vh,620px)] max-w-3xl"
		contentLayerClassName="max-w-3xl"
		onOpenChange={onOpenChange}
	>
		{open ? (
			<BatchGenerationSettingsDialogContent
				kind={kind}
				projectId={projectId}
				selectedCount={selectedCount}
				onConfirm={onConfirm}
				onOpenChange={onOpenChange}
			/>
		) : null}
	</GenerationModalShell>
);

const BatchGenerationSettingsDialogContent: React.FC<{
	kind: BatchGenerationDialogKind;
	onConfirm: (settings: BatchGenerationSettings) => void;
	onOpenChange: (open: boolean) => void;
	projectId?: string;
	selectedCount: number;
}> = ({ kind, onConfirm, onOpenChange, projectId, selectedCount }) => {
	const controller = useGenerationSettingsForm({
		kind,
		persist: true,
		projectId,
		uploadIdPrefix: `batch-generation-settings-${kind}`,
	});
	const optimizePrompt = controller.value.promptOptimization.enabled;
	const confirmDisabled = selectedCount === 0 || controller.isBusy || !controller.isValid;

	const confirm = () => {
		const value = generationSettingsValueForSubmit(
			controller.catalog,
			controller.value,
			controller.promptInsertItems,
		);
		if (!value || !controller.isValid) return;

		const route = controller.catalog.routes.find((item) => item.id === value.routeId);
		const family = route
			? controller.catalog.families.find((item) => item.id === route.familyId)
			: undefined;
		const version = route
			? controller.catalog.versions.find((item) => item.id === route.versionId)
			: undefined;
		if (!route || !family || !version) return;

		let promptOptimization: GenerationPromptOptimizationRequest | undefined;
		if (value.promptOptimization.enabled) {
			const optimizationRoute = controller.catalog.routes.find(
				(item) => item.id === value.promptOptimization.routeId,
			);
			const referencePrompt = value.promptOptimization.referencePrompt?.trim();
			if (!optimizationRoute || !referencePrompt) return;
			promptOptimization = {
				model: optimizationRoute.model,
				referenceName: value.promptOptimization.referenceName,
				referencePrompt,
				routeId: optimizationRoute.id,
			};
		}

		onConfirm({
			family,
			params: value.params,
			promptOptimization,
			promptSupplements: value.promptSupplements.length > 0 ? value.promptSupplements : undefined,
			referenceAssetIds: value.referenceAssetIds.length > 0 ? value.referenceAssetIds : undefined,
			route,
			version,
		});
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-card">
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				<GenerationSettingsForm controller={controller} />
			</div>

			<footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-xs text-muted-foreground">
					将按顺序对 {selectedCount} 项各提交一次生成任务。
				</p>
				<div className="flex justify-end gap-2">
					<DialogDismissButton
						type="button"
						variant="outline"
						size="sm"
						className="h-8 rounded-sm"
						onClick={() => onOpenChange(false)}
					>
						取消
					</DialogDismissButton>
					<DialogDismissButton
						type="button"
						size="sm"
						className="h-8 rounded-sm"
						disabled={confirmDisabled}
						onClick={confirm}
					>
						{optimizePrompt ? <Sparkles className="size-4" /> : <Check className="size-4" />}
						{batchGenerationConfirmButtonLabel(optimizePrompt)}
					</DialogDismissButton>
				</div>
			</footer>
		</div>
	);
};
