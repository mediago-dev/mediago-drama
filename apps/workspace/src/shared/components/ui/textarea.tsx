import * as React from "react";
import { cn } from "@/shared/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
	({ className, ...props }, ref) => {
		return (
			<textarea
				className={cn(
					"flex min-h-20 w-full rounded-control border border-input bg-ide-editor px-2 py-1.5 text-xs leading-5 shadow-sm transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				ref={ref}
				{...props}
			/>
		);
	},
);
Textarea.displayName = "Textarea";

export { Textarea };
