import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "react-spa-template";

export function WorkspaceTabs() {
	return (
		<Tabs defaultValue="script" style={{ width: 360 }}>
			<TabsList>
				<TabsTrigger value="script">Script</TabsTrigger>
				<TabsTrigger value="storyboard">Storyboard</TabsTrigger>
				<TabsTrigger value="render">Render</TabsTrigger>
			</TabsList>
			<TabsContent value="script">
				<p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
					Write and edit the episode script. Generate scenes from your outline.
				</p>
			</TabsContent>
			<TabsContent value="storyboard">
				<p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
					Lay out shots and frames for each scene.
				</p>
			</TabsContent>
			<TabsContent value="render">
				<p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
					Export the finished episode to video.
				</p>
			</TabsContent>
		</Tabs>
	);
}

export function TwoTabs() {
	return (
		<Tabs defaultValue="preview" style={{ width: 320 }}>
			<TabsList>
				<TabsTrigger value="preview">Preview</TabsTrigger>
				<TabsTrigger value="code">JSON</TabsTrigger>
			</TabsList>
			<TabsContent value="preview">
				<p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
					Visual preview of the generated section.
				</p>
			</TabsContent>
			<TabsContent value="code">
				<p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
					Raw section data.
				</p>
			</TabsContent>
		</Tabs>
	);
}
