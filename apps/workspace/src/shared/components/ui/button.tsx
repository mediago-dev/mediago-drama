import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/shared/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-xs font-medium ring-offset-background transition-[background-color,color,box-shadow,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 shrink-0",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
				destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
				outline:
					"border border-input bg-ide-editor shadow-sm hover:bg-ide-list-hover hover:text-foreground",
				secondary: "border border-border bg-ide-toolbar text-foreground hover:bg-ide-list-hover",
				ghost: "hover:bg-ide-list-hover hover:text-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-8 px-3 py-1.5",
				sm: "h-7 rounded-control px-2",
				lg: "h-9 rounded-control px-4",
				icon: "h-8 w-8",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return (
			<Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
		);
	},
);
Button.displayName = "Button";

export { Button, buttonVariants };
