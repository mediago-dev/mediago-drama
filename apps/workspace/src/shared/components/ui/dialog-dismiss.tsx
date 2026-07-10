import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { Button, type ButtonProps } from "@/shared/components/ui/button";

export const isolateDialogDismissPointerDown = <T extends HTMLElement>(
	event: React.PointerEvent<T>,
	onPointerDown?: React.PointerEventHandler<T>,
) => {
	onPointerDown?.(event);
	event.stopPropagation();
};

export const DialogClose = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Close>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>(({ onPointerDown, ...props }, ref) => (
	<DialogPrimitive.Close
		ref={ref}
		onPointerDown={(event) => isolateDialogDismissPointerDown(event, onPointerDown)}
		{...props}
	/>
));
DialogClose.displayName = DialogPrimitive.Close.displayName;

export const DialogDismissButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ onPointerDown, ...props }, ref) => (
		<Button
			ref={ref}
			onPointerDown={(event) => isolateDialogDismissPointerDown(event, onPointerDown)}
			{...props}
		/>
	),
);
DialogDismissButton.displayName = "DialogDismissButton";
