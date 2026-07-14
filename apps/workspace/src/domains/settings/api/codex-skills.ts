import httpClient from "@/shared/lib/http";

export type CodexSkillSource = "user_shared" | "codex_home" | "admin" | "system";

export type CodexSkillAvailabilityState =
	| "available"
	| "disabled"
	| "not_shared"
	| "invalid"
	| "unknown";

export type CodexSkillSyntaxValidity = "valid" | "invalid";

export type KnownCodexSkillReasonCode =
	| "user_shared"
	| "codex_home"
	| "admin"
	| "system"
	| "disabled_by_config"
	| "runtime_home_isolated"
	| "shared_physical_skill"
	| "invalid_skill"
	| "config_unreadable"
	| "config_invalid"
	| "runtime_home_unknown"
	| "system_runtime_unconfirmed"
	| "product_restricted"
	| "bundled_disabled";

export type CodexSkillReasonCode = KnownCodexSkillReasonCode | (string & {});

export interface CodexSkillAvailability {
	state: CodexSkillAvailabilityState;
	reasonCode: CodexSkillReasonCode;
	message: string;
}

export interface CodexSkillRoot {
	source: CodexSkillSource;
	displayPath: string;
	exists: boolean;
	readable: boolean;
	mediaGoVisible: boolean;
	deprecated: boolean;
	error?: string;
}

export interface CodexSkillIssue {
	code: string;
	message: string;
	source?: CodexSkillSource;
	displayPath?: string;
}

export interface CodexSkillSummary {
	total: number;
	mediaGoAvailable: number;
	needsAttention: number;
	unknown: number;
}

export interface CodexSkillListItem {
	id: string;
	name: string;
	displayName?: string;
	description: string;
	shortDescription?: string;
	source: CodexSkillSource;
	displayPath: string;
	origins: CodexSkillOrigin[];
	aliasCount: number;
	deprecated: boolean;
	linked: boolean;
	valid: boolean;
	syntaxValidity: CodexSkillSyntaxValidity;
	sameNameCount: number;
	samePhysicalCount?: number;
	appCli: CodexSkillAvailability;
	mediaGo: CodexSkillAvailability;
	allowImplicitInvocation?: boolean;
	products?: string[];
	defaultPrompt?: string;
	hasScripts: boolean;
	hasReferences: boolean;
	hasAssets: boolean;
	dependencyCount: number;
}

export interface CodexSkillOrigin {
	source: CodexSkillSource;
	displayPath: string;
	linked: boolean;
	deprecated: boolean;
}

export interface CodexSkillDependency {
	type: string;
	value: string;
	description?: string;
	transport?: string;
	url?: string;
}

export interface CodexSkillsResponse {
	generatedAt: string;
	summary: CodexSkillSummary;
	roots: CodexSkillRoot[];
	issues: CodexSkillIssue[];
	skills: CodexSkillListItem[];
}

export interface CodexSkillDetail extends CodexSkillListItem {
	absolutePath: string;
	resolvedPath?: string;
	rawContent: string;
	previewAvailable: boolean;
	dependencies: CodexSkillDependency[];
	issues: CodexSkillIssue[];
}

export const codexSkillsKey = "/codex-skills";

export const codexSkillKey = (id: string) => `${codexSkillsKey}/${encodeURIComponent(id)}`;

export const listCodexSkills = async (): Promise<CodexSkillsResponse> => {
	const response = await httpClient.get<CodexSkillsResponse>(codexSkillsKey);
	return response.data;
};

export const getCodexSkill = async (id: string): Promise<CodexSkillDetail> => {
	const response = await httpClient.get<CodexSkillDetail>(codexSkillKey(id));
	return response.data;
};
