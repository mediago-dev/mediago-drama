import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { StateCreator } from "zustand";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export const createStore = <T>(storeCreator: StateCreator<T>, name: string) => {
	if (process.env.NODE_ENV === "development") {
		return create(devtools(storeCreator, { name }));
	}
	return create(storeCreator);
};

export const formatDate = (date: string | Date) => {
	return new Date(date).toLocaleString("zh-CN");
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const debounce = <T extends (...args: unknown[]) => void>(func: T, wait: number): T => {
	let timeout: NodeJS.Timeout;
	return ((...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => func(...args), wait);
	}) as T;
};

export const throttle = <T extends (...args: unknown[]) => void>(func: T, limit: number): T => {
	let inThrottle: boolean;
	return ((...args) => {
		if (!inThrottle) {
			func(...args);
			inThrottle = true;
			setTimeout(() => {
				inThrottle = false;
			}, limit);
		}
	}) as T;
};

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
