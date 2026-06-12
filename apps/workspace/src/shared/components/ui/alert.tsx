import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/shared/lib/utils";

const alertVariants = cva(
	"relative grid w-full gap-1.5 rounded-sm border px-3 py-2 text-xs [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-3 [&>svg]:text-current [&>svg+div]:translate-y-[var(--alert-icon-title-offset)] [&>svg~*]:pl-7",
	{
		variants: {
			variant: {
				default: "border-border/80 bg-ide-panel text-foreground",
				destructive:
					"border-destructive/30 bg-destructive/8 text-destructive [&>svg]:text-destructive",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

const Alert = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
	<div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
	({ className, ...props }, ref) => (
		<h5 ref={ref} className={cn("font-medium leading-none tracking-tight", className)} {...props} />
	),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div ref={ref} className={cn("text-sm leading-6 [&_p]:leading-6", className)} {...props} />
	),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
