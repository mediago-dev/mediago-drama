const auxiliarySkillNames = new Set(["auto-mention-resolver"]);

export const orderSkillsForPrimaryFlows = <Skill extends { name: string }>(skills: Skill[]) =>
	[...skills].sort((first, second) => {
		const firstAuxiliary = auxiliarySkillNames.has(first.name);
		const secondAuxiliary = auxiliarySkillNames.has(second.name);
		if (firstAuxiliary !== secondAuxiliary) return firstAuxiliary ? 1 : -1;
		return 0;
	});
