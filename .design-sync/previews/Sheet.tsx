import {
	Button,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "react-spa-template";

export function ScenePanel() {
	return (
		<Sheet defaultOpen>
			<SheetTrigger asChild>
				<Button variant="outline">Scene details</Button>
			</SheetTrigger>
			<SheetContent side="right" style={{ width: 320, padding: 20 }}>
				<SheetHeader>
					<SheetTitle>Scene 4 — Rooftop</SheetTitle>
					<SheetDescription>
						Edit the prompt and settings for this scene, then regenerate.
					</SheetDescription>
				</SheetHeader>
				<div
					style={{
						marginTop: 16,
						fontSize: 12,
						lineHeight: 1.6,
						color: "var(--muted-foreground)",
					}}
				>
					A wide aerial shot of the rooftop at dusk. Two figures stand at the edge as neon signs
					flicker on across the city below.
				</div>
				<SheetFooter style={{ marginTop: 20 }}>
					<Button variant="ghost" size="sm">
						Cancel
					</Button>
					<Button size="sm">Save changes</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
