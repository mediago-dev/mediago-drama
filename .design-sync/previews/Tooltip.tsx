import {
	Button,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "react-spa-template";

export function Default() {
	return (
		<TooltipProvider>
			<div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
				<Tooltip defaultOpen>
					<TooltipTrigger asChild>
						<Button variant="secondary">Regenerate</Button>
					</TooltipTrigger>
					<TooltipContent>Re-run generation for this scene</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	);
}
