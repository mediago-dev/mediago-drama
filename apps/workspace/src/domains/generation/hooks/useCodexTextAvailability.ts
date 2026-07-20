import useSWR from "swr";
import { codexAccountKey, getCodexAccount } from "@/domains/settings/api/settings";

export const useCodexTextAvailability = () => {
	const { data } = useSWR(codexAccountKey, getCodexAccount, { shouldRetryOnError: false });
	return data?.status === "loggedIn";
};
