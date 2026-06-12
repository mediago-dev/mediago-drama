package generation

const (
	ProviderOpenAI     = "openai"
	ProviderGoogle     = "google"
	ProviderVolcengine = "volcengine"
	ProviderDMX        = "dmx"
	ProviderOpenRouter = "openrouter"

	AdapterOfficialPlanned         = "official.planned"
	AdapterOfficialOpenAIImage     = "official.openai.image"
	AdapterOfficialOpenAIChatText  = "official.openai.chat_text"
	AdapterOfficialGoogleImage     = "official.google.image"
	AdapterOfficialVolcengineImage = "official.volcengine.image"
	AdapterOfficialVolcengineVideo = "official.volcengine.video"
	AdapterOpenRouterChatImage     = "openrouter.chat.image"
	AdapterOpenRouterChatText      = "openrouter.chat.text"
	AdapterOpenRouterVideo         = "openrouter.video"
	AdapterDMXChatText             = "dmx.chat.text"
	AdapterDMXResponsesImage       = "dmx.responses.image"
	AdapterDMXImagesGenerations    = "dmx.images.generations"
	AdapterDMXGeminiGenerate       = "dmx.gemini.generate_content"
	AdapterDMXResponsesVideo       = "dmx.responses.video"
)
