import type { AgentActionContext, AgentActions } from "./action-types";
import { createAgentActivityActions } from "./activity-actions";
import { createAgentLifecycleActions } from "./lifecycle-actions";

export const createAgentActions = (context: AgentActionContext): AgentActions => ({
	...createAgentLifecycleActions(context),
	...createAgentActivityActions(context),
});
