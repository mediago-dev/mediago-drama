import { Button } from "react-spa-template";
import { Play, Plus, Sparkles, Trash2 } from "lucide-react";

export function Variants() {
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
			<Button>Generate</Button>
			<Button variant="secondary">Save draft</Button>
			<Button variant="outline">Import</Button>
			<Button variant="ghost">Cancel</Button>
			<Button variant="destructive">Delete</Button>
			<Button variant="link">Learn more</Button>
		</div>
	);
}

export function Sizes() {
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
			<Button size="sm">Small</Button>
			<Button size="default">Default</Button>
			<Button size="lg">Large</Button>
			<Button size="icon" aria-label="Add">
				<Plus />
			</Button>
		</div>
	);
}

export function WithIcons() {
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
			<Button>
				<Sparkles />
				Generate scene
			</Button>
			<Button variant="secondary">
				<Play />
				Preview
			</Button>
			<Button variant="destructive">
				<Trash2 />
				Remove clip
			</Button>
		</div>
	);
}

export function Disabled() {
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
			<Button disabled>Generating…</Button>
			<Button variant="secondary" disabled>
				Save draft
			</Button>
			<Button variant="outline" disabled>
				Import
			</Button>
		</div>
	);
}
