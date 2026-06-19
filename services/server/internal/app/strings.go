package app

import serviceshared "github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"

func firstNonEmpty(values ...string) string {
	return serviceshared.FirstNonEmpty(values...)
}
