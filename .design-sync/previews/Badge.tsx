import { Badge } from "react-spa-template";

export function Variants() {
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
			<Badge>Published</Badge>
			<Badge variant="secondary">Draft</Badge>
			<Badge variant="destructive">Failed</Badge>
			<Badge variant="outline">Archived</Badge>
		</div>
	);
}

export function StatusLabels() {
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
			<Badge variant="secondary">12 episodes</Badge>
			<Badge>Rendering</Badge>
			<Badge variant="outline">4K</Badge>
			<Badge variant="destructive">Over quota</Badge>
		</div>
	);
}
