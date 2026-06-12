package mcp

import serviceshared "github.com/mediago-dev/mediago-drama/packages/server/internal/service/shared"

func firstNonEmpty(values ...string) string {
	return serviceshared.FirstNonEmpty(values...)
}

var (
	randomID     = serviceshared.RandomID
	mustRandomID = serviceshared.MustRandomID
)
