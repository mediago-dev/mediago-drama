import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center justify-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium transition-[color,background-color,border-color]",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				secondary: "border-border bg-ide-toolbar text-foreground",
				destructive: "border-transparent bg-destructive text-destructive-foreground",
				outline: "border-border/80 bg-transparent text-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
