import type React from "react";
import { isProEdition } from "@/shared/lib/edition";
import { ProLicenseGate } from "./ProLicenseGate";

// LicenseGate wraps the app. In community builds isProEdition() folds to false
// and the app renders directly with no activation gate. Only Pro builds pull in
// ProLicenseGate, which blocks the app until a valid license is activated.
export const LicenseGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	if (!isProEdition()) {
		return <>{children}</>;
	}
	return <ProLicenseGate>{children}</ProLicenseGate>;
};
