export const projectCreateRequestEvent = "aigc-production-os:create-project";

export const requestProjectCreate = () => {
	window.dispatchEvent(new Event(projectCreateRequestEvent));
};
