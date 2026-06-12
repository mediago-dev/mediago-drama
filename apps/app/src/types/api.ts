export interface ApiResponse<T = unknown> {
	code: number;
	message: string;
	data: T;
	success: boolean;
}

export interface ApiError {
	code: number;
	message: string;
	details?: unknown;
}

export const ErrorCode = {
	SUCCESS: 0,
	INVALID_PARAMS: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	INTERNAL_ERROR: 500,
	NETWORK_ERROR: -1,
} as const;
