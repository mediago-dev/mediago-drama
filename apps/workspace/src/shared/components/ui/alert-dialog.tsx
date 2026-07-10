import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { buttonVariants } from "@/shared/components/ui/button";
import { type DialogLayerController, useDialogLayer } from "@/shared/components/ui/dialog-layer";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { cn } from "@/shared/lib/utils";

interface AlertDialogLayerContextValue {
	escapeHandlerRef: React.MutableRefObject<((event: KeyboardEvent) => void) | undefined>;
	layer: DialogLayerController;
}

const AlertDialogLayerContext = React.createContext<AlertDialogLayerContextValue | null>(null);

type AlertDialogProps = React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Root>;

const AlertDialog: React.FC<AlertDialogProps> = ({
	children,
	defaultOpen,
	onOpenChange,
	open,
	...props
}) => {
	const escapeHandlerRef = React.useRef<((event: KeyboardEvent) => void) | undefined>(undefined);
	const layer = useDialogLayer({
		defaultOpen,
		onEscapeKeyDown: (event) => escapeHandlerRef.current?.(event),
		onOpenChange,
		open,
	});

	return (
		<AlertDialogLayerContext.Provider value={{ escapeHandlerRef, layer }}>
			<AlertDialogPrimitive.Root
				{...props}
				open={layer.open}
				onOpenChange={layer.requestOpenChange}
			>
				{children}
			</AlertDialogPrimitive.Root>
		</AlertDialogLayerContext.Provider>
	);
};
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal: React.FC<
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Portal>
> = ({ container, ...props }) => {
	const context = React.useContext(AlertDialogLayerContext);
	const portalContainer = context?.layer.portalContainer ?? container;
	if (context && !portalContainer) return null;
	return <AlertDialogPrimitive.Portal {...props} container={portalContainer} />;
};

const AlertDialogOverlay = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Overlay
		ref={ref}
		className={cn(
			"fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200",
			className,
		)}
		{...props}
	/>
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, children, onEscapeKeyDown, ...props }, ref) => {
	const context = React.useContext(AlertDialogLayerContext);
	if (context) context.escapeHandlerRef.current = onEscapeKeyDown;

	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Content
				ref={ref}
				className={cn(
					"group fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_var(--dialog-inline-gutter))] -translate-x-1/2 -translate-y-1/2 outline-none",
					dialogContentMotion,
				)}
				data-dialog-layer-state={context ? (context.layer.isTop ? "top" : "covered") : undefined}
				onEscapeKeyDown={(event) => event.preventDefault()}
				{...props}
			>
				<div
					className={cn(
						"mx-auto grid w-full max-w-md gap-4 rounded-sm border border-border bg-ide-panel p-4 text-ide-panel-foreground shadow-lg",
						className,
					)}
				>
					{children}
				</div>
			</AlertDialogPrimitive.Content>
		</AlertDialogPortal>
	);
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
		{...props}
	/>
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Title
		ref={ref}
		className={cn("text-sm font-semibold text-foreground", className)}
		{...props}
	/>
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Description
		ref={ref}
		className={cn("text-xs leading-5 text-muted-foreground", className)}
		{...props}
	/>
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Action>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Action
		ref={ref}
		className={cn(buttonVariants({ variant: "destructive" }), className)}
		{...props}
	/>
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Cancel
		ref={ref}
		className={cn(buttonVariants({ variant: "outline" }), className)}
		{...props}
	/>
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
	AlertDialog,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogAction,
	AlertDialogCancel,
};
