package mcp

import serviceshared "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/shared"

func firstNonEmpty(values ...string) string {
	return serviceshared.FirstNonEmpty(values...)
}

var (
	randomID     = serviceshared.RandomID
	mustRandomID = serviceshared.MustRandomID
)
