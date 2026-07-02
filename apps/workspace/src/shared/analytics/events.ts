export const AnalyticsEvent = {
	PageLoad: "PAGE_LOAD",
	ChangePage: "CHANGE_PAGE",
	OpenProject: "OPEN_PROJECT",
	OpenSettings: "OPEN_SETTINGS",
	OpenToolbox: "OPEN_TOOLBOX",
	OpenGenerationDialog: "OPEN_GENERATION_DIALOG",
	SubmitGeneration: "SUBMIT_GENERATION",
	GenerationSubmitSuccess: "GENERATION_SUBMIT_SUCCESS",
	GenerationSubmitFailure: "GENERATION_SUBMIT_FAILURE",
	BatchGenerateImage: "BATCH_GENERATE_IMAGE",
	BatchGenerateVideo: "BATCH_GENERATE_VIDEO",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];
