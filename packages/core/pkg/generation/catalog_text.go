package generation

const (
	openAIChatDocs     = "https://platform.openai.com/docs/api-reference/chat/create-chat-completion"
	openRouterChatDocs = "https://openrouter.ai/docs/api-reference/chat-completion"
	dmxChatDocs        = "https://doc.dmxapi.cn"
)

func textParams() RouteParamConfig {
	return identityRouteParamConfig([]RouteParam{
		numberRouteParam(ParamTemperature, 0.7, 0, 2),
		optionalNumberRouteParam(ParamMaxTokens, 1, 32768),
	})
}
