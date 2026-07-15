//go:build !commercial

package main

import server "github.com/mediago-dev/mediago-drama/services/server/internal/app"

func configureEdition(_ *server.Config) error {
	return nil
}
