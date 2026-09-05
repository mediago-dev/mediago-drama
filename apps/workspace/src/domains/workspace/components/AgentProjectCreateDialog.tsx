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
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { Input } from "@/shared/components/ui/input";
import {
	defaultProductionTemplate,
	productionTemplates,
	type ProductionTemplateId,
} from "@/lib/production/production-templates";

export interface AgentProjectCreateChoice {
	name: string;
	templateId: ProductionTemplateId;
}

export const AgentProjectCreateDialog = createCallable<void, AgentProjectCreateChoice | null>(
	({ call }) => {
		const [projectName, setProjectName] = useState("");
		const [templateId, setTemplateId] = useState<ProductionTemplateId>(
			defaultProductionTemplate.id,
		);

		const submit = (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			call.end({ name: projectName.trim() || "未命名项目", templateId });
		};

		return (
			<AlertDialog
				open
				onOpenChange={(open) => {
					if (!open) call.end(null);
				}}
			>
				<AlertDialogContent className="max-w-2xl">
					<form onSubmit={submit}>
						<AlertDialogHeader>
							<AlertDialogTitle>新建心悦制作台项目</AlertDialogTitle>
							<AlertDialogDescription>
								选择适合的制作流程，系统会在本地建立项目总控和阶段文档。
							</AlertDialogDescription>
						</AlertDialogHeader>
						<div className="my-4 space-y-3">
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">
									项目名称
								</span>
								<Input
									value={projectName}
									onChange={(event) => setProjectName(event.target.value)}
									placeholder="未命名项目"
									autoFocus
								/>
							</label>
							<fieldset>
								<legend className="mb-2 text-xs font-medium text-muted-foreground">项目模板</legend>
								<div className="grid gap-2 sm:grid-cols-2">
									{productionTemplates.map((template) => (
										<label
											key={template.id}
											className={`cursor-pointer rounded-sm border p-3 transition-colors ${
												templateId === template.id
													? "border-primary bg-primary/5"
													: "border-border bg-background hover:bg-muted/50"
											}`}
										>
											<input
												type="radio"
												name="production-template"
												value={template.id}
												checked={templateId === template.id}
												onChange={() => setTemplateId(template.id)}
												className="sr-only"
											/>
											<span className="block text-sm font-medium text-foreground">
												{template.label}
												<span className="ml-2 text-xs font-normal text-primary">
													{template.complexityLabel.replace("Stage", "阶段")}
												</span>
											</span>
											<span className="mt-1 block text-xs leading-5 text-muted-foreground">
												{template.description}
											</span>
										</label>
									))}
								</div>
							</fieldset>
						</div>
						<AlertDialogFooter>
							<AlertDialogCancel>取消</AlertDialogCancel>
							<DialogDismissButton type="submit">
								<Plus className="size-3.5" />
								<span>创建</span>
							</DialogDismissButton>
						</AlertDialogFooter>
					</form>
				</AlertDialogContent>
			</AlertDialog>
		);
	},
);
AgentProjectCreateDialog.displayName = "AgentProjectCreateDialog";

export const openAgentProjectCreateDialog = () => AgentProjectCreateDialog.call();
