import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type React from "react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

const photoViewPortalSelector = ".PhotoView-Portal";

type DialogOutsideEvent = CustomEvent<{
	originalEvent: PointerEvent | FocusEvent;
}>;

export const isPhotoViewPortalTarget = (target: EventTarget | null) => {
	if (typeof Node === "undefined" || !(target instanceof Node)) return false;

	const element = target instanceof Element ? target : target.parentElement;
	return Boolean(element?.closest(photoViewPortalSelector));
};

const preventPhotoViewPortalDismiss = (event: DialogOutsideEvent) => {
	if (isPhotoViewPortalTarget(event.detail.originalEvent.target)) event.preventDefault();
};

export const GenerationModalShell: React.FC<{
	children: React.ReactNode;
	className?: string;
	contentClassName?: string;
	contentLayerClassName?: string;
	titleAside?: React.ReactNode;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: React.ReactNode;
	titleId: string;
}> = ({
	children,
	className,
	contentClassName,
	contentLayerClassName,
	onOpenChange,
	open,
	title,
	titleAside,
	titleId,
}) => (
	<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay
				className={cn(
					"fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200",
					className,
				)}
			/>
			<DialogPrimitive.Content
				aria-labelledby={titleId}
				className={cn(
					"group fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-7xl -translate-x-1/2 -translate-y-1/2 outline-none",
					contentLayerClassName,
				)}
				onFocusOutside={preventPhotoViewPortalDismiss}
				onPointerDownOutside={preventPhotoViewPortalDismiss}
			>
				<section
					className={cn(
						"flex h-[var(--section-generation-dialog-height)] w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl group-data-[state=closed]:animate-out group-data-[state=closed]:fade-out-0 group-data-[state=open]:animate-in group-data-[state=open]:fade-in-0 duration-200",
						contentClassName,
					)}
				>
					<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
						<div className="flex min-w-0 items-center gap-3">
							<DialogPrimitive.Title
								id={titleId}
								className="min-w-0 truncate text-sm font-semibold text-foreground"
							>
								{title}
							</DialogPrimitive.Title>
							{titleAside ? <div className="shrink-0">{titleAside}</div> : null}
						</div>
						<DialogPrimitive.Close asChild>
							<Button type="button" variant="ghost" size="icon">
								<X />
							</Button>
						</DialogPrimitive.Close>
					</header>
					<div className="min-h-0 flex-1">{children}</div>
				</section>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);
