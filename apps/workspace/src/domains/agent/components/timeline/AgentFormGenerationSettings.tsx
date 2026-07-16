import type React from "react";
import { useEffect } from "react";
import { GenerationSettingsForm } from "@/domains/generation/components/GenerationSettingsForm";
import type { GenerationSettingsValue } from "@/domains/generation/components/generationSettingsValue";
import { useGenerationSettingsForm } from "@/domains/generation/hooks/useGenerationSettingsForm";

export interface AgentFormGenerationSettingsProps {
	defaultValue?: unknown;
	disabled: boolean;
	fieldId: string;
	kind: "image" | "video";
	onBusyChange?: (busy: boolean) => void;
	onChange: (value: GenerationSettingsValue) => void;
	onValidityChange?: (valid: boolean) => void;
	projectId?: string;
	selectionId: string;
}

// AgentFormGenerationSettings is the Agent card's thin adapter around the
// shared generation settings controller and shell-free form body.
export const AgentFormGenerationSettings: React.FC<AgentFormGenerationSettingsProps> = ({
	defaultValue,
	disabled,
	fieldId,
	kind,
	onBusyChange,
	onChange,
	onValidityChange,
	projectId,
	selectionId,
}) => {
	const controller = useGenerationSettingsForm({
		defaultValue,
		kind,
		persist: true,
		projectId,
		uploadIdPrefix: `agent-generation-settings-${selectionId}-${fieldId}`,
	});
	const valid = controller.isReady && controller.isValid;

	useEffect(() => {
		if (controller.isReady) onChange(controller.value);
	}, [controller.isReady, controller.value, onChange]);

	// Catalog hydration and validation affect only confirmation. Busy reports a
	// real upload in flight, not ordinary catalog or prompt-pack loading.
	useEffect(() => {
		onBusyChange?.(controller.isUploadingReference);
	}, [controller.isUploadingReference, onBusyChange]);
	useEffect(() => {
		onValidityChange?.(valid);
	}, [onValidityChange, valid]);

	return <GenerationSettingsForm controller={controller} disabled={disabled} />;
};
