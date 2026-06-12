# core

Shared Go library for multimodal provider integrations.

All Claude, OpenAI, video, image, audio, and future multimodal adapter contracts
belong here. CLI packages should import `core` when they need multimodal
capabilities instead of implementing provider logic locally.

The public packages define mediago-drama contracts. Provider SDKs and orchestration
frameworks are kept behind internal adapters so upper layers do not depend on
their types directly. Eino is the current internal execution layer for chat
model adapters.

Media generation is organized as model families first (Seedream, GPT Image,
Gemini, Seedance), with official, DMX, and OpenRouter handled as
execution channels for each route.

## Quick start

```bash
go mod tidy
task check
task test
```

## Layout

```text
pkg/generation/          # public media generation contracts and model catalog
pkg/generation/runtime/  # route-aware runtime over official / DMX / OpenRouter channels
pkg/generation/dmx/      # DMX provider adapter facade
pkg/generation/official/ # first-party provider adapter facade
pkg/generation/openrouter/ # OpenRouter provider adapter facade
pkg/multimodal/          # public multimodal provider contracts
internal/einoadapter/    # Eino <-> core conversion and provider wrappers
go.mod                   # module declaration
Taskfile.yml             # go-task tasks (fmt / vet / test / tidy / check)
LICENSE                  # MIT
```

## Use as a dependency

```bash
go get github.com/mediago-dev/mediago-drama/packages/core
```

```go
import "github.com/mediago-dev/mediago-drama/packages/core/pkg/multimodal"

func main() {
    _ = multimodal.GenerateRequest{}
}
```

## License

MIT — see [LICENSE](LICENSE).
