import {
	Button,
	Input,
	Label,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "react-spa-template";

export function Default() {
	return (
		<div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
			<Popover defaultOpen>
				<PopoverTrigger asChild>
					<Button variant="outline">Export settings</Button>
				</PopoverTrigger>
				<PopoverContent style={{ width: 240 }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
						<div style={{ fontSize: 13, fontWeight: 600 }}>Export settings</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<Label htmlFor="res">Resolution</Label>
							<Input id="res" defaultValue="1920 × 1080" />
						</div>
						<Button size="sm">Apply</Button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
