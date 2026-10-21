package generation_test

import (
	"fmt"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func ExampleResolveRoute() {
	route, err := generation.ResolveRoute(generation.RouteQuery{
		Kind:    generation.KindImage,
		RouteID: generation.RouteOfficialSeedream5Lite,
	})
	if err != nil {
		panic(err)
	}

	fmt.Println(route.ID, route.Provider, route.SupportsReferenceURLs)

	// Output:
	// official.seedream-5-lite volcengine true
}
