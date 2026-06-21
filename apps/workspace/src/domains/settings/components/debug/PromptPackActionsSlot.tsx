import type React from "react";
import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

const PromptPackActionsSlotContext = createContext<HTMLElement | null>(null);

export const PromptPackActionsSlotProvider: React.FC<{
	children: React.ReactNode;
	slotEl: HTMLElement | null;
}> = ({ children, slotEl }) => (
	<PromptPackActionsSlotContext.Provider value={slotEl}>
		{children}
	</PromptPackActionsSlotContext.Provider>
);

export const PromptPackActions: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const slotEl = useContext(PromptPackActionsSlotContext);
	if (!slotEl) return null;
	return createPortal(children, slotEl);
};
