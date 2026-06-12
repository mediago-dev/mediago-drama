package generation_test

import (
	"fmt"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func ExampleResolveRoute() {
	route, err := generation.ResolveRoute(generation.RouteQuery{
		Kind:    generation.KindImage,
		RouteID: generation.RouteDMXSeedream5Lite,
	})
	if err != nil {
		panic(err)
	}

	fmt.Println(route.ID, route.Provider, route.SupportsReferenceURLs)

	// Output:
	// dmx.seedream-5-lite dmx true
}
