import { Textarea } from "react-spa-template";

export function Default() {
	return (
		<div style={{ width: 320 }}>
			<Textarea placeholder="Describe the scene you want to generate…" />
		</div>
	);
}

export function WithContent() {
	return (
		<div style={{ width: 320 }}>
			<Textarea defaultValue="INT. APARTMENT — NIGHT. Rain streaks the window. Mei sits alone, the city glowing behind her as she reads the letter one more time." />
		</div>
	);
}

export function Disabled() {
	return (
		<div style={{ width: 320 }}>
			<Textarea disabled defaultValue="Locked — this scene is currently rendering." />
		</div>
	);
}
