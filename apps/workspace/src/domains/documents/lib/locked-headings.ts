export interface LockedHeadingPlanTitle {
	sectionId: string;
	title: string;
	level: 1 | 2 | 3;
}

export interface LockedHeadingPlan {
	count: number;
	titles: LockedHeadingPlanTitle[];
}
