import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { type ApiError, type ApiResponse, ErrorCode } from "@/types/api";

class HttpClient {
	private instance: AxiosInstance;

	constructor(baseURL = "/api/v1") {
		this.instance = axios.create({
			baseURL,
			timeout: 10000,
			headers: {
				"Content-Type": "application/json",
			},
		});

		this.setupInterceptors();
	}

	private setupInterceptors() {
		this.instance.interceptors.response.use(
			(response: AxiosResponse<ApiResponse>) => {
				const { data } = response;

				if (data.success && data.code === ErrorCode.SUCCESS) {
					return response;
				}

				const error: ApiError = {
					code: data.code,
					message: data.message,
					details: data,
				};

				return Promise.reject(error);
			},
			(error) => {
				if (error.response) {
					const apiError: ApiError = {
						code: error.response.status,
						message: error.response.data?.message || error.message,
						details: error.response.data,
					};
					return Promise.reject(apiError);
				}

				if (error.request) {
					const networkError: ApiError = {
						code: ErrorCode.NETWORK_ERROR,
						message: "网络请求失败，请检查本机服务",
						details: error,
					};
					return Promise.reject(networkError);
				}

				return Promise.reject({
					code: ErrorCode.INTERNAL_ERROR,
					message: error.message,
					details: error,
				});
			},
		);
	}

	async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
		const response = await this.instance.get<ApiResponse<T>>(url, config);
		return response.data;
	}

	async post<T = unknown>(
		url: string,
		data?: unknown,
		config?: AxiosRequestConfig,
	): Promise<ApiResponse<T>> {
		const response = await this.instance.post<ApiResponse<T>>(url, data, config);
		return response.data;
	}

	async put<T = unknown>(
		url: string,
		data?: unknown,
		config?: AxiosRequestConfig,
	): Promise<ApiResponse<T>> {
		const response = await this.instance.put<ApiResponse<T>>(url, data, config);
		return response.data;
	}

	async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
		const response = await this.instance.delete<ApiResponse<T>>(url, config);
		return response.data;
	}
}

export const httpClient = new HttpClient();
export default httpClient;
