import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type React from "react";
import { Button } from "@/shared/components/ui/button";
import { useDialogLayer } from "@/shared/components/ui/dialog-layer";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { cn } from "@/shared/lib/utils";

interface GenerationDialogShellProps {
	bodyClassName?: string;
	children: React.ReactNode;
	className?: string;
	closeLabel?: string;
	closeDisabled?: boolean;
	description?: React.ReactNode;
	error?: React.ReactNode;
	footer?: React.ReactNode;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: React.ReactNode;
	titleId: string;
	toolbar?: React.ReactNode;
}

export const GenerationDialogShell: React.FC<GenerationDialogShellProps> = ({
	bodyClassName,
	children,
	className,
	closeLabel = "关闭",
	closeDisabled = false,
	description,
	error,
	footer,
	onOpenChange,
	open,
	title,
	titleId,
	toolbar,
}) => {
	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && closeDisabled) return;
		onOpenChange(nextOpen);
	};
	const layer = useDialogLayer({
		onEscapeKeyDown: (event) => {
			if (closeDisabled) event.preventDefault();
		},
		onOpenChange: handleOpenChange,
		open,
	});

	return (
		<DialogPrimitive.Root open={layer.open} onOpenChange={layer.requestOpenChange}>
			{layer.portalContainer ? (
				<DialogPrimitive.Portal container={layer.portalContainer}>
					<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
					<DialogPrimitive.Content
						aria-describedby={description ? `${titleId}-description` : undefined}
						className={cn(
							"fixed left-1/2 top-1/2 z-50 flex max-h-[min(46rem,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
							dialogContentMotion,
							className,
						)}
						data-dialog-layer-state={layer.isTop ? "top" : "covered"}
						onEscapeKeyDown={(event) => event.preventDefault()}
						onFocusOutside={(event) => layer.preventDismissWhenCovered(event)}
						onPointerDownOutside={(event) => layer.preventDismissWhenCovered(event)}
						onInteractOutside={(event) => {
							layer.preventDismissWhenCovered(event);
							if (closeDisabled) event.preventDefault();
						}}
					>
						<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
							<div className="min-w-0">
								<DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">
									{title}
								</DialogPrimitive.Title>
								{description ? (
									<DialogPrimitive.Description
										id={`${titleId}-description`}
										className="mt-1 truncate text-xs text-muted-foreground"
									>
										{description}
									</DialogPrimitive.Description>
								) : null}
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={closeLabel}
								disabled={closeDisabled}
								onClick={() => layer.requestOpenChange(false)}
							>
								<X className="size-4" />
							</Button>
						</header>
						{toolbar ? (
							<div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
								{toolbar}
							</div>
						) : null}
						{error ? (
							<div className="shrink-0 border-b border-border px-4 py-2">{error}</div>
						) : null}
						<div className={cn("min-h-0 flex-1 overflow-y-auto p-4", bodyClassName)}>
							{children}
						</div>
						{footer ? (
							<footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
								{footer}
							</footer>
						) : null}
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			) : null}
		</DialogPrimitive.Root>
	);
};
