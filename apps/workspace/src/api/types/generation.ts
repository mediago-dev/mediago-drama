// Hand-written frontend API contracts mirrored by the Go generation DTOs.

export type RouteStatus = "available" | "planned" | "gated";

export interface ModelCatalog {
	families: ModelFamily[];
	versions: ModelVersion[];
	routes: ModelRoute[];
	models: ModelSpec[];
	providers: ProviderInfo[];
	voicePreviews?: GenerationVoicePreviewAsset[];
}

export interface ModelFamily {
	id: string;
	label: string;
	kind: Kind;
	description?: string;
}

export interface ModelVersion {
	id: string;
	familyId: string;
	label: string;
	kind: Kind;
	canonicalModel: string;
	capabilities: Capabilities;
}

export interface Capabilities {
	async: boolean;
	supportsReferenceUrls: boolean;
}

export interface ModelRoute {
	id: string;
	familyId: string;
	versionId: string;
	label: string;
	kind: Kind;
	provider: string;
	model: string;
	adapter: string;
	docUrl: string;
	async: boolean;
	supportsReferenceUrls: boolean;
	status: RouteStatus;
	statusReason?: string;
	params: ParamSpec[];
	paramGroups?: RouteParamGroup[];
	paramCombos?: ParamCombo[];
	legacyModelId?: string;
	configured?: boolean;
}

export interface ModelSpec {
	id: string;
	label: string;
	kind: Kind;
	provider: string;
	model: string;
	adapter: string;
	docUrl: string;
	async: boolean;
	supportsReferenceUrls: boolean;
	params: ParamSpec[];
}

export type ParamMenu = "primary" | "secondary";
export type ParamGroupID = "size" | "duration" | "count" | "voice" | "audio" | "other";

export interface ParamSpec {
	name: string;
	label: string;
	type: string;
	group?: ParamGroupID | string;
	menu?: ParamMenu;
	default?: unknown;
	options?: ParamOption[];
	required?: boolean;
	min?: number;
	max?: number;
	help?: string;
}

export interface RouteParamGroup {
	id: ParamGroupID | string;
	label: string;
	params: string[];
}

export interface ParamOption {
	label: string;
	value: string;
}

export interface ParamCombo {
	params: string[];
	allowed: string[][];
}

export interface CredentialSpec {
	id: string;
	label: string;
	description: string;
	credentialLabel?: string;
	placeholder?: string;
	help?: string;
	credentialKind?: string;
}

export type FailureReason =
	| "provider_error"
	| "invalid_parameter"
	| "policy_violation"
	| "rate_limited"
	| "authentication"
	| "timeout";

export type ProviderType = "official" | "aggregator" | "local";

export interface ProviderInfo {
	id: string;
	label: string;
	providerType: ProviderType;
}

export type Kind = "image" | "text" | "video" | "audio";

export interface CapabilityManifestResponse {
	capabilities: CapabilityRecord[];
}

export interface CapabilityRecord {
	id: string;
	name: string;
	description: string;
	kind: string;
	category: string;
	icon: string;
	surface: string;
	inputs: string[];
	outputs: string[];
	relatedRoutes: string[];
	status: string;
	available: boolean;
}

export interface GenerationModelsResponse {
	families: ModelFamily[];
	versions: ModelVersion[];
	routes: ModelRoute[];
	models: ModelSpec[];
	providers: ProviderInfo[];
	voicePreviews?: GenerationVoicePreviewAsset[];
}

export interface GenerationMessageRequest {
	kind: Kind;
	sessionId?: string;
	projectId?: string;
	sectionId?: string;
	documentContext?: GenerationDocumentContext;
	capabilityId?: string;
	notificationTarget?: GenerationNotificationTarget;
	routeId: string;
	familyId?: string;
	versionId?: string;
	provider?: string;
	modelId: string;
	model: string;
	prompt: string;
	referenceUrls: string[];
	referenceAssetIds: string[];
	params: Record<string, unknown>;
}

export interface GenerationDocumentContext {
	projectId?: string;
	documentId?: string;
	sectionId?: string;
}

export interface GenerationVoicePreviewRequest {
	routeId: string;
	voiceId: string;
	params?: Record<string, unknown>;
}

export interface GenerationVoicePreviewResponse {
	asset: GenerationAsset;
}

export interface GenerationVoicePreviewAsset {
	routeId: string;
	voiceId: string;
	url: string;
	mimeType: string;
}

export interface ImportGenerationMediaAssetsRequest {
	kind?: Kind;
	sessionId?: string;
	scopeId?: string;
	conversationTitle?: string;
	projectId?: string;
	sectionId?: string;
	capabilityId?: string;
	assetIds: string[];
	assetTitle?: string;
	prompt?: string;
}

export interface GenerationMessageResponse {
	id: string;
	role: string;
	status: string;
	message: string;
	text?: string;
	assets: GenerationAsset[];
	usage: GenerationUsage;
	error?: string;
	errorCode?: string;
	errorType?: string;
	retryable?: boolean;
}

export interface GenerationTextStreamEvent {
	type: string;
	taskId?: string;
	sessionId?: string;
	delta?: string;
	message?: GenerationMessageResponse;
	status?: string;
	error?: string;
	usage?: GenerationUsage;
}

export interface GenerationNotificationSectionTarget {
	blockId: string;
	documentId: string;
	headingLevel: number;
	headingOccurrence: number;
	headingText: string;
	markdown: string;
	plainText: string;
	prompt: string;
}

export interface GenerationNotificationTarget {
	kind: string;
	projectId?: string;
	documentId?: string;
	documentTitle?: string;
	section: GenerationNotificationSectionTarget;
}

export interface GenerationNotificationRecord {
	id: string;
	taskId: string;
	taskKind: Kind;
	taskStatus: string;
	projectId?: string;
	title: string;
	description: string;
	assetCount: number;
	readAt?: string;
	target: GenerationNotificationTarget;
	createdAt: string;
	updatedAt: string;
}

export interface GenerationNotificationsResponse {
	notifications: GenerationNotificationRecord[];
}

export interface GenerationNotificationEvent {
	id: string;
	type: string;
	projectId?: string;
	notification: GenerationNotificationRecord;
	createdAt: string;
}

export interface GenerationAsset {
	kind: Kind;
	taskId?: string;
	title?: string;
	url?: string;
	base64?: string;
	mimeType?: string;
	slotIndex?: number;
	selected?: boolean;
}

export interface GenerationUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
}

export interface GenerationTaskRecord {
	id: string;
	providerTaskId?: string;
	sessionId?: string;
	projectId?: string;
	sectionId?: string;
	capabilityId?: string;
	kind: Kind;
	routeId: string;
	familyId: string;
	versionId: string;
	provider: string;
	modelId: string;
	model: string;
	prompt: string;
	referenceUrls: string[];
	referenceAssetIds: string[];
	params: Record<string, unknown>;
	status: string;
	message: string;
	text?: string;
	assets: GenerationAsset[];
	deletedAssetSlots?: number[];
	usage: GenerationUsage;
	error?: string;
	errorCode?: string;
	errorType?: string;
	retryable?: boolean;
	createdAt: string;
	updatedAt: string;
	durationMs?: number;
	attempts?: GenerationTaskAttemptRecord[];
	retryCount: number;
	lastAttemptAt?: string;
}

export interface GenerationTaskAttemptRecord {
	id: string;
	taskId: string;
	action: string;
	status: string;
	message?: string;
	error?: string;
	createdAt: string;
}

export interface GenerationTasksResponse {
	tasks: GenerationTaskRecord[];
}

export interface UpdateGenerationTaskAssetRequest {
	resourceType?: SelectedGenerationResourceType;
	selected?: boolean;
	title?: string;
}

export interface UpdateSelectedGenerationAssetRequest {
	assetIndex?: number;
	base64?: string;
	kind?: Kind;
	mediaAssetId?: string;
	mimeType?: string;
	resourceId?: string;
	resourceTitle?: string;
	resourceType?: SelectedGenerationResourceType;
	selected?: boolean;
	sortOrder?: number;
	sourceAssetIndex?: number;
	sourceDocumentId?: string;
	sourceKey?: string;
	sourceTaskId?: string;
	sourceType?: "generated" | "edited" | "uploaded" | "document" | "imported";
	taskId?: string;
	title?: string;
	url?: string;
}

export interface UpdateSelectedGenerationAssetResponse {
	asset?: SelectedGenerationAssetRecord;
	deleted?: boolean;
}

export type SelectedGenerationResourceType = "character" | "scene" | "storyboard" | "prop";

export interface SelectedGenerationAssetRecord {
	assetIndex: number;
	base64?: string;
	createdAt?: string;
	id: string;
	kind: Kind;
	mediaAssetId?: string;
	mimeType?: string;
	resourceId?: string;
	resourceTitle?: string;
	resourceType: SelectedGenerationResourceType;
	sortOrder?: number;
	sourceAssetIndex?: number;
	sourceDocumentId?: string;
	sourceKey?: string;
	sourceTaskId?: string;
	sourceType?: string;
	taskId?: string;
	title?: string;
	updatedAt?: string;
	url?: string;
}

export interface SelectedGenerationAssetsResponse {
	assets: SelectedGenerationAssetRecord[];
}

export interface GenerationPreferenceRecord {
	sessionId: string;
	familyIds: Partial<Record<Kind, string>>;
	routeIds: Record<string, string>;
	versionIds: Record<string, string>;
	routeParams: Record<string, Record<string, unknown>>;
	stylePresetId: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface UpdateGenerationPreferenceRequest {
	sessionId?: string;
	familyIds: Partial<Record<Kind, string>>;
	routeIds: Record<string, string>;
	versionIds: Record<string, string>;
	routeParams: Record<string, Record<string, unknown>>;
	stylePresetId: string;
}

export interface GenerationConversationRecord {
	sessionId: string;
	scopeId?: string;
	kind: Kind;
	title: string;
	taskCount: number;
	latestPrompt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface GenerationConversationsResponse {
	sessions: GenerationConversationRecord[];
}

export interface CreateGenerationConversationRequest {
	sessionId?: string;
	scopeId?: string;
	kind: Kind;
	title: string;
}
