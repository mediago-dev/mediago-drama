const scriptApprovalKey = "stage-one:script";
const storyboardApprovalKey = "stage-one:storyboard-master";

export const isStageOneScriptLocked = (approvedContent: readonly string[] | undefined) =>
	approvedContent?.includes(scriptApprovalKey) ?? false;

export const stageOneScriptApproval = (
	approvedContent: readonly string[] | undefined,
	locked: boolean,
) => {
	const next = (approvedContent ?? []).filter((item) => item !== scriptApprovalKey);
	return locked ? [...next, scriptApprovalKey] : next;
};

export const isStageOneStoryboardLocked = (approvedContent: readonly string[] | undefined) =>
	approvedContent?.includes(storyboardApprovalKey) ?? false;

export const stageOneStoryboardApproval = (
	approvedContent: readonly string[] | undefined,
	locked: boolean,
) => {
	const next = (approvedContent ?? []).filter((item) => item !== storyboardApprovalKey);
	return locked ? [...next, storyboardApprovalKey] : next;
};

export const buildStoryboardPlanningRequest = (
	script: string,
	storyboardBrief: string,
	panelCount = 20,
) => {
	const direction = storyboardBrief.trim();
	const lockedScript = script.trim();
	return `${direction ? `已确认视觉方向：\n${direction}\n\n` : ""}请把以下已锁定剧本导演拆解成 ${panelCount} 格专业分镜，并输出一条可直接生成“一张 4列×5行分镜母图”的完整中文提示词。

先在内部完成故事节拍、转折、高潮和品牌收束分析，但不要输出分析过程。镜头数量固定为 ${panelCount}，总时长固定为 60 秒，镜头时长按动作密度和情绪节奏分配，不得机械平均。

最终输出格式必须严格包含：
1. 【全片统一设定】：真人/IP身份锚点、服装、比例、场景时空、渲染媒介、材质、主辅色、灯光逻辑、画幅、产品与Logo规则。
2. 【逐格执行表】：P01—P${String(panelCount).padStart(2, "0")}，每格逐项写明“时间码｜剧情功能｜人物/IP｜动作起点与结果｜表情与视线｜景别/机位/镜头｜前中后景构图｜场景/道具/产品｜灯光/色彩/材质｜承上启下连续性｜禁止项”。每格必须是具体画面，不得写标题、章节名、制作备注或抽象口号。
3. 【母图排版与生成要求】：一张完整母图、4列×5行、严格按P01—P20、清晰格线和镜号时间码、不得缺格重复错序、不得拆成独立任务。
4. 【负面约束】：身份漂移、服装漂移、产品变形、Logo错位、轴线跳跃、视线错误、动作不连续、重复构图、海报化摆拍、乱码水印。

不要附加剧本全文，不要使用“必须标注某项”代替实际填写；每一项都要结合该镜头内容写出真实值。

已锁定剧本：
${lockedScript}`;
};
