package app

import serviceshared "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/shared"

func firstNonEmpty(values ...string) string {
	return serviceshared.FirstNonEmpty(values...)
}
