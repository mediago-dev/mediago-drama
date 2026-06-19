import {
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "react-spa-template";

function Resolution(props: { defaultValue?: string; disabled?: boolean }) {
	return (
		<Select defaultValue={props.defaultValue} disabled={props.disabled}>
			<SelectTrigger>
				<SelectValue placeholder="Select resolution" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="720">1280 × 720 (HD)</SelectItem>
				<SelectItem value="1080">1920 × 1080 (Full HD)</SelectItem>
				<SelectItem value="2160">3840 × 2160 (4K)</SelectItem>
			</SelectContent>
		</Select>
	);
}

export function WithValue() {
	return (
		<div style={{ width: 240 }}>
			<Resolution defaultValue="1080" />
		</div>
	);
}

export function Placeholder() {
	return (
		<div style={{ width: 240 }}>
			<Resolution />
		</div>
	);
}

export function WithLabel() {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6, width: 240 }}>
			<Label>Export resolution</Label>
			<Resolution defaultValue="2160" />
		</div>
	);
}

export function Disabled() {
	return (
		<div style={{ width: 240 }}>
			<Resolution defaultValue="720" disabled />
		</div>
	);
}
