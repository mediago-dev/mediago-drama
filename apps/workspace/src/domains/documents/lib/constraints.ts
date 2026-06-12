import type { DocumentOperation } from "@/domains/documents/lib/operations";

export interface TemplateConstraintRejection<Operation> {
	op: Operation;
	reason: string;
}

export interface TemplateConstraintResult<Operation> {
	accepted: Operation[];
	rejected: TemplateConstraintRejection<Operation>[];
}

export const enforceTemplateConstraints = <Operation extends DocumentOperation>(
	_document: unknown,
	operations: Operation[],
): TemplateConstraintResult<Operation> => ({
	accepted: operations,
	rejected: [],
});
