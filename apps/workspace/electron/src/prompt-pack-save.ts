import { basename, extname } from "node:path";

const maxPromptPackSaveBytes = 32 << 20;
const maxPromptPackFilenameBytes = 240;

export interface ParsedPromptPackSaveRequest {
	data: Uint8Array;
	filename: string;
}

export const parsePromptPackSaveRequest = (value: unknown): ParsedPromptPackSaveRequest => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid prompt pack save request");
	}

	const request = value as Record<string, unknown>;
	if (!(request.data instanceof Uint8Array)) {
		throw new Error("prompt pack data must be bytes");
	}
	if (request.data.byteLength === 0) {
		throw new Error("prompt pack data is empty");
	}
	if (request.data.byteLength > maxPromptPackSaveBytes) {
		throw new Error("prompt pack data exceeds the size limit");
	}

	const rawFilename = typeof request.filename === "string" ? request.filename.trim() : "";
	const filename = basename(rawFilename.replaceAll("\\", "/"))
		.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!filename || Buffer.byteLength(filename, "utf8") > maxPromptPackFilenameBytes) {
		throw new Error("invalid prompt pack filename");
	}
	if (extname(filename).toLowerCase() !== ".mgpack") {
		throw new Error("prompt pack filename must end with .mgpack");
	}

	return { data: request.data, filename };
};
