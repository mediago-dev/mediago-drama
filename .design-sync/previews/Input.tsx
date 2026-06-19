import { Input, Label } from "react-spa-template";

export function Default() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8, width: 280 }}>
			<Input placeholder="Search projects…" />
			<Input defaultValue="Midnight in Shanghai" />
		</div>
	);
}

export function WithLabel() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6, width: 280 }}>
			<Label htmlFor="title">Project title</Label>
			<Input id="title" placeholder="e.g. Episode 1 — Arrival" />
		</div>
	);
}

export function Disabled() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8, width: 280 }}>
			<Input disabled placeholder="Locked while rendering" />
			<Input disabled defaultValue="render-2024-final.mp4" />
		</div>
	);
}
