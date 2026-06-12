import type React from "react";
import { SWRConfig } from "swr";

export const SWRProvider: React.FC<React.PropsWithChildren> = ({ children }) => (
	<SWRConfig
		value={{
			refreshInterval: 0,
			revalidateOnFocus: false,
			revalidateOnReconnect: true,
			shouldRetryOnError: true,
			errorRetryCount: 3,
			errorRetryInterval: 5000,
			dedupingInterval: 2000,
		}}
	>
		{children}
	</SWRConfig>
);
