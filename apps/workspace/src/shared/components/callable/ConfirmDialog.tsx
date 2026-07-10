import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { createCallable } from "react-call";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";

export interface ConfirmDialogOptions {
	cancelLabel?: string;
	confirmIcon?: React.ReactNode;
	confirmLabel?: string;
	description?: React.ReactNode;
	onConfirm?: () => boolean | void | Promise<boolean | void>;
	title: React.ReactNode;
	variant?: "default" | "destructive";
}

export const ConfirmDialog = createCallable<ConfirmDialogOptions, boolean>(
	({
		call,
		cancelLabel = "取消",
		confirmIcon,
		confirmLabel = "确认",
		description,
		onConfirm,
		title,
		variant = "destructive",
	}) => {
		const [isConfirming, setIsConfirming] = useState(false);

		const confirm = async () => {
			if (isConfirming) return;
			if (!onConfirm) {
				call.end(true);
				return;
			}

			setIsConfirming(true);
			try {
				const shouldClose = await onConfirm();
				if (shouldClose === false) {
					setIsConfirming(false);
					return;
				}
				call.end(true);
			} catch {
				setIsConfirming(false);
			}
		};

		return (
			<AlertDialog
				open
				onOpenChange={(open) => {
					if (!open && !isConfirming) call.end(false);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{title}</AlertDialogTitle>
						{description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isConfirming}>{cancelLabel}</AlertDialogCancel>
						<DialogDismissButton
							type="button"
							variant={variant}
							disabled={isConfirming}
							onClick={() => void confirm()}
						>
							{isConfirming ? <Loader2 className="animate-spin" /> : confirmIcon}
							<span>{confirmLabel}</span>
						</DialogDismissButton>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	},
);
ConfirmDialog.displayName = "ConfirmDialog";

export const confirmDialog = (options: ConfirmDialogOptions) => ConfirmDialog.call(options);
