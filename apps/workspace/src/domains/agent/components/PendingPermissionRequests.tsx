import type React from "react";
import { PermissionRequestCard } from "@/domains/agent/components/PermissionRequestCard";
import {
	selectAgentPermissionRequests,
	selectAgentRemovePermissionRequest,
	selectAgentSessionId,
	useAgentStore,
} from "@/domains/agent/stores";

export const PendingPermissionRequests: React.FC = () => {
	const requests = useAgentStore(selectAgentPermissionRequests);
	const sessionId = useAgentStore(selectAgentSessionId);
	const removePermissionRequest = useAgentStore(selectAgentRemovePermissionRequest);

	if (requests.length === 0) return null;

	return (
		<section
			aria-label="待确认工具权限"
			aria-live="polite"
			className="max-h-56 overflow-y-auto border-t border-border bg-ide-panel px-3 py-2"
		>
			<div className="space-y-2">
				{requests.map((request) => (
					<PermissionRequestCard
						key={request.requestId}
						request={request}
						sessionId={sessionId}
						onDecided={() => removePermissionRequest(request.requestId)}
					/>
				))}
			</div>
		</section>
	);
};
