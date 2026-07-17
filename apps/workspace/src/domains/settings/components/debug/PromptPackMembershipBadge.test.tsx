import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PromptPack } from "@/domains/settings/api/packs";
import {
	PromptPackMembershipBadge,
	promptPackMembershipToneClassName,
} from "./PromptPackMembershipBadge";

const packs: PromptPack[] = [
	{
		id: "builtin",
		name: "MediaGo 默认技能包",
		version: "1.0.0",
		source: "default",
		enabled: true,
	},
	{
		id: "local.ai-anime",
		name: "AI 动漫风格",
		version: "1.0.0",
		source: "local",
		enabled: true,
	},
];

describe("PromptPackMembershipBadge", () => {
	afterEach(cleanup);

	it("keeps the default pack neutral", () => {
		render(<PromptPackMembershipBadge packId="builtin" packs={packs} />);

		expect(screen.getByLabelText("所属技能包：默认技能包")).toHaveClass(
			"bg-ide-toolbar",
			"text-foreground",
		);
	});

	it("assigns a stable color tone to a custom pack", () => {
		const firstTone = promptPackMembershipToneClassName("local.ai-anime", false);
		const secondTone = promptPackMembershipToneClassName("local.ai-anime", false);

		expect(firstTone).toBe(secondTone);
		render(<PromptPackMembershipBadge packId="local.ai-anime" packs={packs} />);
		expect(screen.getByLabelText("所属技能包：AI 动漫风格")).toHaveClass(...firstTone.split(" "));
	});

	it("uses the pack id when choosing tones", () => {
		expect(promptPackMembershipToneClassName("pack.alpha", false)).not.toBe(
			promptPackMembershipToneClassName("pack.bravo", false),
		);
	});
});
