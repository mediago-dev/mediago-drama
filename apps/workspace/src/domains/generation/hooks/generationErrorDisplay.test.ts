import { describe, expect, it } from "vitest";
import {
	safeGenerationHistoryErrorText,
	visibleGenerationErrorDetail,
} from "@/domains/generation/hooks/generationErrorDisplay";

const volcengineModelNotOpenError =
	"official request failed with status 404: " +
	'{"error":{"code":"ModelNotOpen","message":"Your account 2100815854 has not activated the model doubao-seedance-2-0-mini-260615. Please activate the model service in the Ark Console.","type":"Not Found"}}';

describe("generationErrorDisplay", () => {
	it("extracts readable messages from prefixed provider JSON errors", () => {
		expect(visibleGenerationErrorDetail(volcengineModelNotOpenError)).toBe(
			"Your account 2100815854 has not activated the model doubao-seedance-2-0-mini-260615. Please activate the model service in the Ark Console.",
		);
	});

	it("prefers persisted error details over generic history content", () => {
		expect(safeGenerationHistoryErrorText(volcengineModelNotOpenError, "图像生成失败")).toBe(
			"Your account 2100815854 has not activated the model doubao-seedance-2-0-mini-260615. Please activate the model service in the Ark Console.",
		);
	});
});
