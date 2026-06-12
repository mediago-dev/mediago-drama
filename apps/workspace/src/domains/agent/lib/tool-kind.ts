export const inferToolKind = (title: string) => {
	let normalized = title.trim().toLowerCase();
	normalized = normalized.startsWith("tool:")
		? normalized.slice("tool:".length).trim()
		: normalized;
	normalized = normalized.includes("/")
		? normalized.slice(normalized.lastIndexOf("/") + 1)
		: normalized;
	normalized = normalized.includes("__")
		? normalized.slice(normalized.lastIndexOf("__") + 2)
		: normalized;
	switch (normalized) {
		case "list_projects":
		case "load_skill":
		case "list_comments":
		case "get_comment":
			return "read";
		case "update_project_config":
		case "mutate_comment":
			return "edit";
		default:
			return "";
	}
};
