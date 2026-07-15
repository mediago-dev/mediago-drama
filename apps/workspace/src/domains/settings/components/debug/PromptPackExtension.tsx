import type React from "react";
import type { PromptPack } from "@/domains/settings/api/packs";

export interface PromptPackExtensionProps {
	onPublished?: () => Promise<void> | void;
	pack: PromptPack;
}

// Commercial builds replace this module in an isolated build checkout. The
// community source intentionally contains no account, marketplace, or crypto UI.
export const PromptPackAccountButton: React.FC = () => null;

export const PromptPackExtension: React.FC<PromptPackExtensionProps> = () => null;

export const PromptPackDialogHost: React.FC = () => null;

export const tryImportPromptPackExtension = async (_file: File): Promise<PromptPack | undefined> =>
	undefined;

export const canExportPromptPackAsV1 = (_pack: PromptPack) => true;
