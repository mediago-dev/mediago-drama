import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { type DialogLayerController, useDialogLayer } from "@/shared/components/ui/dialog-layer";
import { cn } from "@/shared/lib/utils";

interface SheetLayerContextValue {
	escapeHandlerRef: React.MutableRefObject<((event: KeyboardEvent) => void) | undefined>;
	layer: DialogLayerController;
}

const SheetLayerContext = React.createContext<SheetLayerContextValue | null>(null);

type SheetProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Root>;

const Sheet: React.FC<SheetProps> = ({ children, defaultOpen, onOpenChange, open, ...props }) => {
	const escapeHandlerRef = React.useRef<((event: KeyboardEvent) => void) | undefined>(undefined);
	const layer = useDialogLayer({
		defaultOpen,
		onEscapeKeyDown: (event) => escapeHandlerRef.current?.(event),
		onOpenChange,
		open,
	});

	return (
		<SheetLayerContext.Provider value={{ escapeHandlerRef, layer }}>
			<SheetPrimitive.Root {...props} open={layer.open} onOpenChange={layer.requestOpenChange}>
				{children}
			</SheetPrimitive.Root>
		</SheetLayerContext.Provider>
	);
};
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

const SheetPortal: React.FC<React.ComponentPropsWithoutRef<typeof SheetPrimitive.Portal>> = ({
	container,
	...props
}) => {
	const context = React.useContext(SheetLayerContext);
	const portalContainer = context?.layer.portalContainer ?? container;
	if (context && !portalContainer) return null;
	return <SheetPrimitive.Portal {...props} container={portalContainer} />;
};

const SheetOverlay = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Overlay
		className={cn(
			"fixed inset-0 z-50 bg-background/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200",
			className,
		)}
		{...props}
		ref={ref}
	/>
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
	"fixed z-50 bg-background shadow-2xl outline-none transition ease-in-out data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out",
	{
		variants: {
			side: {
				top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
				right:
					"inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
				bottom:
					"inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
				left: "inset-y-0 left-0 h-full border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
			},
		},
		defaultVariants: {
			side: "right",
		},
	},
);

interface SheetContentProps
	extends
		React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
		VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Content>,
	SheetContentProps
>(
	(
		{
			side = "right",
			className,
			children,
			onEscapeKeyDown,
			onFocusOutside,
			onInteractOutside,
			onPointerDownOutside,
			...props
		},
		ref,
	) => {
		const context = React.useContext(SheetLayerContext);
		if (context) context.escapeHandlerRef.current = onEscapeKeyDown;

		return (
			<SheetPortal>
				<SheetOverlay />
				<SheetPrimitive.Content
					ref={ref}
					className={cn(sheetVariants({ side }), "border-border", className)}
					data-dialog-layer-state={context ? (context.layer.isTop ? "top" : "covered") : undefined}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onFocusOutside={(event) => {
						onFocusOutside?.(event);
						context?.layer.preventDismissWhenCovered(event);
					}}
					onInteractOutside={(event) => {
						onInteractOutside?.(event);
						context?.layer.preventDismissWhenCovered(event);
					}}
					onPointerDownOutside={(event) => {
						onPointerDownOutside?.(event);
						context?.layer.preventDismissWhenCovered(event);
					}}
					{...props}
				>
					{children}
				</SheetPrimitive.Content>
			</SheetPortal>
		);
	},
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
		{...props}
	/>
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Title
		ref={ref}
		className={cn("text-sm font-semibold text-foreground", className)}
		{...props}
	/>
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Description
		ref={ref}
		className={cn("text-xs leading-5 text-muted-foreground", className)}
		{...props}
	/>
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetOverlay,
	SheetPortal,
	SheetTitle,
	SheetTrigger,
};
