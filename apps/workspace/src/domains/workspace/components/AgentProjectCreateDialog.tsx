import { Plus } from "lucide-react";
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

export const AgentProjectCreateDialog = createCallable<void, string | null>(({ call }) => {
	const [projectName, setProjectName] = useState("");

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		call.end(projectName.trim() || "未命名项目");
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
						<AlertDialogTitle>新建智能体项目</AlertDialogTitle>
						<AlertDialogDescription>
							输入项目名后会在全局目录的 agent 文件夹下创建本地项目。
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="my-4 space-y-3">
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">项目名称</span>
							<Input
								value={projectName}
								onChange={(event) => setProjectName(event.target.value)}
								placeholder="未命名项目"
								autoFocus
							/>
						</label>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>取消</AlertDialogCancel>
						<Button type="submit">
							<Plus className="size-3.5" />
							<span>创建</span>
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
});
AgentProjectCreateDialog.displayName = "AgentProjectCreateDialog";

export const openAgentProjectCreateDialog = () => AgentProjectCreateDialog.call();
