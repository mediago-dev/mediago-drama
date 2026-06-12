import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { StateCreator } from "zustand";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

type ImmerStateCreator<T> = StateCreator<T, [["zustand/immer", never]], []>;

export const createStore = <T>(storeCreator: ImmerStateCreator<T>, name: string) => {
	const initializer = immer(storeCreator);

	if (import.meta.env.DEV) {
		return create<T>()(devtools(initializer, { name }));
	}

	return create<T>()(initializer);
};

export const formatDate = (date: string | Date) => new Date(date).toLocaleString("zh-CN");

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
