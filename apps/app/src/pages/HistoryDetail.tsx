import {
	IonBackButton,
	IonButtons,
	IonContent,
	IonHeader,
	IonPage,
	IonTitle,
	IonToolbar,
} from "@ionic/react";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import {
	type GenerationAsset,
	generationTaskQueryKey,
	getGenerationTask,
} from "@/api/generation";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

const getStatusLabel = (status?: string) => {
	if (status === "completed") return "已完成";
	if (status === "failed") return "失败";
	if (status === "running") return "生成中";
	if (status === "queued") return "排队中";
	if (status === "submitted") return "已提交";
	return status || "等待中";
};

const getStatusVariant = (
	status?: string,
): "destructive" | "outline" | "secondary" | "success" | "warning" => {
	if (status === "completed") return "success";
	if (status === "failed") return "destructive";
	if (status === "queued") return "warning";
	if (status === "running" || status === "submitted") return "secondary";
	return "outline";
};

const getAssetSource = (asset: GenerationAsset) => {
	if (asset.url) return asset.url;
	if (!asset.base64) return "";
	return `data:${asset.mimeType || "application/octet-stream"};base64,${asset.base64}`;
};

const getErrorMessage = (error: unknown) => {
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message?: unknown }).message);
	}
	return "加载历史详情失败";
};

const getKindLabel = (kind: string) => {
	if (kind === "image") return "图片";
	if (kind === "audio") return "音频";
	return "视频";
};

const HistoryDetail: React.FC = () => {
	const { id = "" } = useParams<{ id: string }>();
	const { data: task, error, isLoading } = useSWR(
		id ? generationTaskQueryKey(id) : null,
		() => getGenerationTask(id),
	);

	return (
		<IonPage>
			<IonHeader translucent>
				<IonToolbar>
					<IonButtons slot="start">
						<IonBackButton defaultHref="/history" text="" />
					</IonButtons>
					<IonTitle>历史详情</IonTitle>
				</IonToolbar>
			</IonHeader>
			<IonContent fullscreen className="app-content">
				<div className="mx-auto grid w-full max-w-[34rem] gap-4 p-4 pb-[calc(var(--space-lg)+env(safe-area-inset-bottom))]">
					{isLoading ? (
						<Card>
							<CardContent className="py-4 text-sm text-muted-foreground">加载中</CardContent>
						</Card>
					) : null}

					{error ? (
						<Card>
							<CardContent className="py-4 text-sm text-error-foreground">
								{getErrorMessage(error)}
							</CardContent>
						</Card>
					) : null}

					{task ? (
						<>
							<Card className="gap-4 rounded-md py-4">
								<CardHeader className="px-4">
									<div className="min-w-0">
										<CardDescription>
											{getKindLabel(task.kind)} · {task.model}
										</CardDescription>
										<CardTitle className="mt-2 text-base leading-6">{task.prompt}</CardTitle>
									</div>
									<CardAction>
										<Badge variant={getStatusVariant(task.status)}>
											{getStatusLabel(task.status)}
										</Badge>
									</CardAction>
								</CardHeader>
								<CardContent className="grid gap-3 px-4 text-sm text-muted-foreground">
									<div className="grid grid-cols-[5rem_1fr] gap-2">
										<span>会话</span>
										<span className="min-w-0 break-all text-foreground">
											{task.conversationId || "默认会话"}
										</span>
										<span>创建时间</span>
										<span>{formatDate(task.createdAt)}</span>
										<span>更新时间</span>
										<span>{formatDate(task.updatedAt)}</span>
										<span>供应商</span>
										<span>{task.provider}</span>
									</div>
									{task.error ? (
										<p className="rounded-md border border-error-border bg-error-surface p-3 text-error-foreground">
											{task.error}
										</p>
									) : null}
									{task.message ? (
										<p className="rounded-md border border-border bg-muted p-3 leading-6">
											{task.message}
										</p>
									) : null}
								</CardContent>
							</Card>

							<Card className="gap-4 rounded-md py-4">
								<CardHeader className="px-4">
									<CardTitle className="text-base">生成结果</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-3 px-4">
									{(task.assets ?? []).length > 0 ? (
										(task.assets ?? []).map((asset, index) => {
											const source = getAssetSource(asset);
											if (!source) return null;
											return asset.kind === "audio" ? (
												<audio
													key={`${task.id}-${index}`}
													src={source}
													controls
													className="w-full"
												/>
											) : asset.kind === "video" ? (
												<video
													key={`${task.id}-${index}`}
													src={source}
													controls
													className="aspect-video w-full rounded-md border border-border bg-muted"
												/>
											) : (
												<img
													key={`${task.id}-${index}`}
													src={source}
													alt=""
													className="max-h-96 w-full rounded-md border border-border bg-muted object-contain"
												/>
											);
										})
									) : (
										<p className="text-sm text-muted-foreground">暂无可预览结果</p>
									)}
								</CardContent>
							</Card>

							{task.attempts?.length ? (
								<Card className="gap-4 rounded-md py-4">
									<CardHeader className="px-4">
										<CardTitle className="text-base">执行记录</CardTitle>
									</CardHeader>
									<CardContent className="grid gap-2 px-4">
										{task.attempts.map((attempt) => (
											<div
												key={attempt.id}
												className="rounded-md border border-border bg-muted p-3 text-sm"
											>
												<div className="flex items-center justify-between gap-3">
													<span className="font-medium text-foreground">{attempt.action}</span>
													<Badge variant={getStatusVariant(attempt.status)}>
														{getStatusLabel(attempt.status)}
													</Badge>
												</div>
												<p className="mt-2 text-xs text-muted-foreground">
													{formatDate(attempt.createdAt)}
												</p>
												{attempt.message || attempt.error ? (
													<p className="mt-2 text-sm leading-6 text-muted-foreground">
														{attempt.error || attempt.message}
													</p>
												) : null}
											</div>
										))}
									</CardContent>
								</Card>
							) : null}
						</>
					) : null}
				</div>
			</IonContent>
		</IonPage>
	);
};

export default HistoryDetail;
