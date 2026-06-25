import { describe, expect, it } from "vitest";
import { readAgentAttachment } from "./AgentAttachments";

describe("AgentAttachments", () => {
	it("keeps the original file for non-text attachments", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "reference.bin", {
			type: "application/octet-stream",
		});

		const attachment = await readAgentAttachment(file, "attachment-1", "project-1");

		expect(attachment.status).toBe("ready");
		expect(attachment.file).toBe(file);
		expect(attachment.text).toBeUndefined();
		expect(attachment.name).toBe("reference.bin");
	});

	it("keeps readable text while preserving the original file", async () => {
		const file = new File(["hello"], "notes.txt", { type: "text/plain" });

		const attachment = await readAgentAttachment(file, "attachment-1", "project-1");

		expect(attachment.file).toBe(file);
		expect(attachment.text).toBe("hello");
	});
});
