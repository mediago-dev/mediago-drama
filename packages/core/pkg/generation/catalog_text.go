package generation

const (
	openAIChatDocs     = "https://platform.openai.com/docs/api-reference/chat/create-chat-completion"
	openRouterChatDocs = "https://openrouter.ai/docs/api-reference/chat-completion"
	dmxChatDocs        = "https://doc.dmxapi.cn"
)

func textParams() []ParamSpec {
	return []ParamSpec{
		numberParam("temperature", "Temperature", 0.7, 0, 2),
		optionalNumberParam("maxTokens", "Max tokens", 1, 32768),
	}
}
