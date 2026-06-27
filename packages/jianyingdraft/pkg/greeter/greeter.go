// Package greeter is a placeholder public package for the
// jianyingdraft library. Replace its contents with the
// real public API of your library. Files placed under pkg/ are part
// of the published surface and follow semantic versioning.
package greeter

import "fmt"

// Greet returns a greeting addressed to name. It is the canonical
// placeholder API of this template — rename or replace it as you build
// out the library.
func Greet(name string) string {
	if name == "" {
		name = "world"
	}
	return fmt.Sprintf("Hello, %s!", name)
}
