import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "react-spa-template";

export function ProjectCard() {
	return (
		<Card style={{ width: 320 }}>
			<CardHeader>
				<CardTitle>Midnight in Shanghai</CardTitle>
				<CardDescription>
					A 12-episode drama series. Draft script generated from the outline, ready for
					storyboard.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
					<div style={{ display: "flex", justifyContent: "space-between" }}>
						<span style={{ color: "var(--muted-foreground)" }}>Episodes</span>
						<span>12</span>
					</div>
					<div style={{ display: "flex", justifyContent: "space-between" }}>
						<span style={{ color: "var(--muted-foreground)" }}>Status</span>
						<span>Storyboarding</span>
					</div>
				</div>
			</CardContent>
			<CardFooter>
				<Button size="sm">Open</Button>
				<Button size="sm" variant="ghost">
					Duplicate
				</Button>
			</CardFooter>
		</Card>
	);
}

export function SimpleCard() {
	return (
		<Card style={{ width: 320 }}>
			<CardHeader>
				<CardTitle>Render queue</CardTitle>
				<CardDescription>3 clips waiting to export.</CardDescription>
			</CardHeader>
			<CardContent>
				<p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
					Exports run in the background. You can keep editing while clips render.
				</p>
			</CardContent>
		</Card>
	);
}
