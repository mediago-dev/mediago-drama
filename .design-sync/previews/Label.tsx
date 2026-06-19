import { Input, Label, Textarea } from "react-spa-template";

export function FormFields() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14, width: 300 }}>
			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<Label htmlFor="name">Scene name</Label>
				<Input id="name" placeholder="Opening shot" />
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<Label htmlFor="notes">Director notes</Label>
				<Textarea id="notes" placeholder="Camera pans left across the skyline…" />
			</div>
		</div>
	);
}
