export const OVERVIEW_DOCUMENT_ID = "overview";

export const isOverviewDocumentId = (id: string | null | undefined) =>
	id?.trim() === OVERVIEW_DOCUMENT_ID;
