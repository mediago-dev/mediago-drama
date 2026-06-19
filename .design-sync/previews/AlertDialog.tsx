import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
	Button,
} from "react-spa-template";

export function ConfirmDelete() {
	return (
		<AlertDialog defaultOpen>
			<AlertDialogTrigger asChild>
				<Button variant="destructive">Delete project</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete "Midnight in Shanghai"?</AlertDialogTitle>
					<AlertDialogDescription>
						This permanently removes the project and all 12 episodes, scripts, and rendered clips.
						This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction>Delete project</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
