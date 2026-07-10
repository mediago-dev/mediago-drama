import { Loader2 } from "lucide-react";
import type React from "react";
import useSWR from "swr";
import { getLicenseStatus, licenseStatusKey } from "@/domains/settings/api/license";
import { ActivationWall } from "./ActivationWall";

// ProLicenseGate blocks the app behind license activation. It is only reached
// from LicenseGate in Pro builds, so its hooks never run in community builds.
export const ProLicenseGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { data: status, isLoading, mutate } = useSWR(licenseStatusKey, getLicenseStatus);

	if (isLoading && !status) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-background text-muted-foreground">
				<Loader2 className="size-5 animate-spin" />
			</div>
		);
	}

	if (status?.activated) {
		return <>{children}</>;
	}

	return (
		<ActivationWall
			status={status}
			onActivated={(next) => void mutate(next, { revalidate: false })}
		/>
	);
};
