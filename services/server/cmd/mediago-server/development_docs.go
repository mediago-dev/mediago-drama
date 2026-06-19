//go:build !workspace_dist

package main

import "fmt"

func printDevelopmentDocsURL(addr string) {
	fmt.Printf("Swagger UI: http://%s/docs/index.html\n", addr)
}
