import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { type ApiError, type ApiResponse, ErrorCode } from "@/types/api";
import { apiBaseURL } from "@/shared/lib/api-base";

class HttpClient {
	private instance: AxiosInstance;

	constructor(baseURL = apiBaseURL()) {
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
		this.instance.interceptors.request.use(
			(config) => {
				const token = localStorage.getItem("token");
				if (token) {
					config.headers.Authorization = `Bearer ${token}`;
				}
				return config;
			},
			(error) => Promise.reject(error),
		);

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
					const message = isRequestTimeout(error)
						? "请求超时，请稍后重试"
						: "网络请求失败，请检查网络连接";
					const networkError: ApiError = {
						code: ErrorCode.NETWORK_ERROR,
						message,
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
		const response = await this.instance.get(url, config);
		return response.data;
	}

	async post<T = unknown>(
		url: string,
		data?: unknown,
		config?: AxiosRequestConfig,
	): Promise<ApiResponse<T>> {
		const response = await this.instance.post(url, data, config);
		return response.data;
	}

	async put<T = unknown>(
		url: string,
		data?: unknown,
		config?: AxiosRequestConfig,
	): Promise<ApiResponse<T>> {
		const response = await this.instance.put(url, data, config);
		return response.data;
	}

	async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
		const response = await this.instance.delete(url, config);
		return response.data;
	}

	async patch<T = unknown>(
		url: string,
		data?: unknown,
		config?: AxiosRequestConfig,
	): Promise<ApiResponse<T>> {
		const response = await this.instance.patch(url, data, config);
		return response.data;
	}
}

const isRequestTimeout = (error: { code?: unknown; message?: unknown }) =>
	error.code === "ECONNABORTED" ||
	(typeof error.message === "string" && error.message.toLowerCase().includes("timeout"));

export const httpClient = new HttpClient();
export default httpClient;
