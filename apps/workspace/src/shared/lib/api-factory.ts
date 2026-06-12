import type { AxiosRequestConfig } from "axios";
import httpClient from "@/shared/lib/http";

type ResourceId = string | number;

interface ResourceOptions<ListPayload, ListResult> {
	key?: string;
	selectList?: (payload: ListPayload) => ListResult;
}

const normalizePath = (path: string): string => (path.startsWith("/") ? path : `/${path}`);

const resourcePath = (basePath: string, id?: ResourceId): string => {
	const path = normalizePath(basePath);
	return id === undefined ? path : `${path}/${encodeURIComponent(String(id))}`;
};

export const createResource = <
	Resource,
	CreateInput = Partial<Resource>,
	UpdateInput = Partial<Resource>,
	ListPayload = Resource[],
	ListResult = Resource[],
>(
	basePath: string,
	options: ResourceOptions<ListPayload, ListResult> = {},
) => {
	const key = options.key ?? normalizePath(basePath);
	const selectList =
		options.selectList ?? ((payload: ListPayload) => payload as unknown as ListResult);

	return {
		key,
		itemKey: (id: ResourceId) => resourcePath(key, id),
		list: async (config?: AxiosRequestConfig): Promise<ListResult> => {
			const response = await httpClient.get<ListPayload>(basePath, config);
			return selectList(response.data);
		},
		get: async (id: ResourceId, config?: AxiosRequestConfig): Promise<Resource> => {
			const response = await httpClient.get<Resource>(resourcePath(basePath, id), config);
			return response.data;
		},
		create: async (input: CreateInput, config?: AxiosRequestConfig): Promise<Resource> => {
			const response = await httpClient.post<Resource>(basePath, input, config);
			return response.data;
		},
		update: async (
			id: ResourceId,
			input: UpdateInput,
			config?: AxiosRequestConfig,
		): Promise<Resource> => {
			const response = await httpClient.put<Resource>(resourcePath(basePath, id), input, config);
			return response.data;
		},
		remove: async (id: ResourceId, config?: AxiosRequestConfig): Promise<void> => {
			await httpClient.delete(resourcePath(basePath, id), config);
		},
	};
};
