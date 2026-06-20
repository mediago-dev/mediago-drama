import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from "@ionic/react";
import { useHistory } from "react-router-dom";
import useSWR from "swr";
import { generationTasksKey, getGenerationTasks } from "@/api/generation";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

const getStatusLabel = (status: string) => {
	if (status === "completed") return "已完成";
	if (status === "failed") return "失败";
	if (status === "running") return "生成中";
	if (status === "queued") return "排队中";
	return status;
};

const getStatusVariant = (
	status: string,
): "destructive" | "outline" | "secondary" | "success" | "warning" => {
	if (status === "completed") return "success";
	if (status === "failed") return "destructive";
	if (status === "queued") return "warning";
	return "outline";
};

const getKindLabel = (kind: string) => {
	if (kind === "image") return "图片";
	if (kind === "audio") return "音频";
	return "视频";
};

const History: React.FC = () => {
	const navigation = useHistory();
	const { data, isLoading } = useSWR(generationTasksKey, () => getGenerationTasks());
	const tasks = data?.tasks ?? [];

	return (
		<IonPage>
			<IonHeader translucent>
				<IonToolbar>
					<IonTitle>历史</IonTitle>
				</IonToolbar>
			</IonHeader>
			<IonContent fullscreen className="app-content">
				<div className="mx-auto grid w-full max-w-[34rem] gap-3 p-4 pb-[calc(var(--space-lg)+env(safe-area-inset-bottom))]">
					{isLoading ? (
						<Card>
							<CardContent className="py-4 text-sm text-muted-foreground">加载中</CardContent>
						</Card>
					) : null}
					{tasks.length === 0 && !isLoading ? (
						<Card>
							<CardContent className="py-4 text-sm text-muted-foreground">暂无生成记录</CardContent>
						</Card>
					) : null}
					{tasks.map((task) => (
						<button
							key={task.id}
							type="button"
							aria-label={`查看历史详情：${task.prompt}`}
							className="block w-full text-left"
							onClick={() => navigation.push(`/history/${encodeURIComponent(task.id)}`)}
						>
							<Card className="gap-3 rounded-md py-4 transition-colors hover:bg-muted/50">
								<CardHeader className="px-4">
									<CardTitle className="line-clamp-2 text-sm leading-5">{task.prompt}</CardTitle>
									<CardAction>
										<Badge variant={getStatusVariant(task.status)}>
											{getStatusLabel(task.status)}
										</Badge>
									</CardAction>
								</CardHeader>
								<CardContent className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 text-xs text-muted-foreground">
									<span>{getKindLabel(task.kind)}</span>
									<span>{task.model}</span>
									<span>{formatDate(task.updatedAt)}</span>
								</CardContent>
							</Card>
						</button>
					))}
				</div>
			</IonContent>
		</IonPage>
	);
};

export default History;
