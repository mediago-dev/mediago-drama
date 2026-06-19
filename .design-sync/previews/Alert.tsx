import { Alert, AlertDescription, AlertTitle } from "react-spa-template";
import { CircleAlert, Info } from "lucide-react";

export function Default() {
	return (
		<Alert style={{ maxWidth: 420 }}>
			<Info />
			<AlertTitle>Draft saved</AlertTitle>
			<AlertDescription>
				Your script outline was saved automatically. Generate a storyboard when you're ready to
				continue.
			</AlertDescription>
		</Alert>
	);
}

export function Destructive() {
	return (
		<Alert variant="destructive" style={{ maxWidth: 420 }}>
			<CircleAlert />
			<AlertTitle>Export failed</AlertTitle>
			<AlertDescription>
				The render service timed out while exporting episode 3. Check your connection and try the
				export again.
			</AlertDescription>
		</Alert>
	);
}
