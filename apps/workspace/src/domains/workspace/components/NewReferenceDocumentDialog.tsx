import { FileText, Upload } from "lucide-react";
import type React from "react";
import { useRef } from "react";
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
import type { NewDocumentDialogChoice } from "./NewDocumentDialog";

export const NewReferenceDocumentDialog = createCallable<void, NewDocumentDialogChoice | null>(
	({ call }) => {
		const fileInputRef = useRef<HTMLInputElement>(null);

		const uploadSelectedFile = (event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) return;
			call.end({ kind: "upload", file });
		};

		return (
			<AlertDialog
				open
				onOpenChange={(open) => {
					if (!open) call.end(null);
				}}
			>
				<AlertDialogContent className="max-w-md">
					<AlertDialogHeader>
						<AlertDialogTitle>新建资料</AlertDialogTitle>
						<AlertDialogDescription>上传本地文件或创建空白资料文档。</AlertDialogDescription>
					</AlertDialogHeader>

					<div className="grid gap-2">
						<Button
							type="button"
							variant="outline"
							className="h-12 justify-start rounded-sm px-3"
							onClick={() => fileInputRef.current?.click()}
						>
							<Upload className="size-4" />
							<span>上传文件</span>
						</Button>
						<Button
							type="button"
							variant="outline"
							className="h-12 justify-start rounded-sm px-3"
							onClick={() => call.end({ kind: "document", category: "reference" })}
						>
							<FileText className="size-4" />
							<span>新建空白资料</span>
						</Button>
					</div>

					<AlertDialogFooter>
						<AlertDialogCancel className="rounded-sm">取消</AlertDialogCancel>
						<input
							ref={fileInputRef}
							type="file"
							className="hidden"
							aria-label="选择资料文件"
							onChange={uploadSelectedFile}
						/>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	},
);
NewReferenceDocumentDialog.displayName = "NewReferenceDocumentDialog";

export const openNewReferenceDocumentDialog = () => NewReferenceDocumentDialog.call();
