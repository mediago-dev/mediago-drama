import { Pencil } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { createCallable } from "react-call";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export interface ProjectRenameDialogOptions {
	projectName: string;
}

export const ProjectRenameDialog = createCallable<ProjectRenameDialogOptions, string | null>(
	({ call, projectName }) => {
		const [nextName, setNextName] = useState(projectName);
		const normalizedName = nextName.trim();

		const submit = (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!normalizedName) return;
			call.end(normalizedName);
		};

		return (
			<AlertDialog
				open
				onOpenChange={(open) => {
					if (!open) call.end(null);
				}}
			>
				<AlertDialogContent className="max-w-md">
					<form onSubmit={submit}>
						<AlertDialogHeader>
							<AlertDialogTitle>重命名项目</AlertDialogTitle>
							<AlertDialogDescription>更新项目在工作台中的显示名称。</AlertDialogDescription>
						</AlertDialogHeader>
						<div className="my-4 space-y-3">
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">
									项目名称
								</span>
								<Input
									value={nextName}
									onChange={(event) => setNextName(event.target.value)}
									onFocus={(event) => event.currentTarget.select()}
									placeholder="未命名项目"
									autoFocus
								/>
							</label>
						</div>
						<AlertDialogFooter>
							<AlertDialogCancel>取消</AlertDialogCancel>
							<Button type="submit" disabled={!normalizedName}>
								<Pencil className="size-3.5" />
								<span>重命名</span>
							</Button>
						</AlertDialogFooter>
					</form>
				</AlertDialogContent>
			</AlertDialog>
		);
	},
);
ProjectRenameDialog.displayName = "ProjectRenameDialog";

export const openProjectRenameDialog = (options: ProjectRenameDialogOptions) =>
	ProjectRenameDialog.call(options);
