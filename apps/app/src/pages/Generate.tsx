import {
	IonContent,
	IonHeader,
	IonIcon,
	IonPage,
	IonTitle,
	IonToolbar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { filmOutline, imageOutline, micOutline } from "ionicons/icons";
import useSWR from "swr";
import {
	type GenerationKind,
	generationModelsKey,
	getGenerationModels,
} from "@/api/generation";
import { healthKey, getHealth } from "@/api/health";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

const generationKindItems: Array<{
	description: string;
	icon: string;
	kind: GenerationKind;
	title: string;
}> = [
	{
		kind: "image",
		title: "图片",
		description: "进入图片会话，提交 prompt 并查看生成结果。",
		icon: imageOutline,
	},
	{
		kind: "video",
		title: "视频",
		description: "进入视频会话，提交任务并跟踪生成状态。",
		icon: filmOutline,
	},
	{
		kind: "audio",
		title: "音频",
		description: "进入音频会话，把文案生成配音或旁白。",
		icon: micOutline,
	},
];

const Generate: React.FC = () => {
	const navigation = useHistory();
	const { data: health } = useSWR(healthKey, getHealth);
	const { data: models } = useSWR(generationModelsKey, getGenerationModels);
	const isServerOnline = health?.status === "ok";

	return (
		<IonPage>
			<IonHeader translucent>
				<IonToolbar>
					<IonTitle>生成</IonTitle>
				</IonToolbar>
			</IonHeader>
			<IonContent fullscreen className="app-content">
				<div className="mx-auto grid w-full max-w-[34rem] gap-4 p-4 pb-[calc(var(--space-lg)+env(safe-area-inset-bottom))]">
					<Card className="gap-4 rounded-md py-4">
						<CardHeader className="px-4">
							<div className="min-w-0">
								<CardDescription>本机服务</CardDescription>
								<CardTitle className="mt-1 text-xl">MediaGo Drama</CardTitle>
							</div>
							<CardAction>
								<Badge variant={isServerOnline ? "success" : "muted"}>
									{isServerOnline ? "在线" : "未连接"}
								</Badge>
							</CardAction>
						</CardHeader>
						<CardContent className="px-4 text-sm leading-6 text-muted-foreground">
							选择生成类型后进入独立页面，会话和生成结果会自动保留。
						</CardContent>
					</Card>

					<div className="grid gap-3">
						{generationKindItems.map((item) => {
							const configuredRoutes =
								models?.routes.filter(
									(route) =>
										route.kind === item.kind &&
										route.configured &&
										route.status === "available",
								) ?? [];
							return (
								<button
									key={item.kind}
									type="button"
									className="block w-full text-left"
									onClick={() => navigation.push(`/generate/${item.kind}`)}
								>
									<Card className="gap-4 rounded-md py-4 transition-colors hover:bg-muted/50">
										<CardHeader className="px-4">
											<div className="flex min-w-0 items-start gap-3">
												<div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-primary">
													<IonIcon aria-hidden="true" icon={item.icon} />
												</div>
												<div className="min-w-0">
													<CardTitle className="text-base">{item.title}</CardTitle>
													<CardDescription className="mt-1 leading-5">
														{item.description}
													</CardDescription>
												</div>
											</div>
											<CardAction>
												<Badge variant={configuredRoutes.length > 0 ? "secondary" : "warning"}>
													{configuredRoutes.length} 个模型
												</Badge>
											</CardAction>
										</CardHeader>
									</Card>
								</button>
							);
						})}
					</div>
				</div>
			</IonContent>
		</IonPage>
	);
};

export default Generate;
