package generation

type familySpec struct {
	Family   ModelFamily
	Versions []ModelVersion
	Routes   []ModelRoute
}

var familySpecs = []familySpec{
	{
		Family: ModelFamily{
			ID:          FamilySeedream,
			Label:       "Seedream",
			Kind:        KindImage,
			Description: "ByteDance image generation and image fusion",
		},
		Versions: []ModelVersion{
			version(VersionSeedream5Lite, FamilySeedream, "Seedream 5.0 Lite", KindImage, "doubao-seedream-5.0-lite", false, true),
			version(VersionSeedream47, FamilySeedream, "Seedream 4.7", KindImage, "4.7", false, true),
			version(VersionSeedream45, FamilySeedream, "Seedream 4.5", KindImage, "bytedance-seed/seedream-4.5", false, true),
		},
		Routes: []ModelRoute{
			dmxRoute(RouteDMXSeedream5Lite, FamilySeedream, VersionSeedream5Lite, "DMX", "doubao-seedream-5.0-lite", AdapterDMXResponsesImage, "https://doc.dmxapi.cn/doubao-seedream-5.0-lite-Multi-image-fusion.html", seedreamParams(), false, true, ModelSeedream5Lite),
			officialRoute(RouteOfficialSeedream5Lite, FamilySeedream, VersionSeedream5Lite, KindImage, "Volcengine official", "doubao-seedream-5-0-260128", AdapterOfficialVolcengineImage, "https://www.volcengine.com/docs/82379/1541523", []string{"volcengine"}, seedreamParams(), false, true),
			jimengRoute(RouteJimengSeedream50, FamilySeedream, VersionSeedream5Lite, "即梦", "5.0", AdapterJimengCLIImage, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedreamParams(), false, true, ModelSeedream50),
			jimengRoute(RouteJimengSeedream47, FamilySeedream, VersionSeedream47, "即梦", "4.7", AdapterJimengCLIImage, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedreamParams(), false, true, ModelSeedream47),
			openRouterRoute(RouteOpenRouterSeedream45, FamilySeedream, VersionSeedream45, KindImage, "OpenRouter", "bytedance-seed/seedream-4.5", AdapterOpenRouterChatImage, openRouterImageDocs, openRouterImageParams(), false, true),
		},
	},
	{
		Family: ModelFamily{
			ID:          FamilyText,
			Label:       "Text",
			Kind:        KindText,
			Description: "OpenAI-compatible streaming chat text generation.",
		},
		Versions: []ModelVersion{
			version(VersionGPT55Text, FamilyText, "GPT-5.5 Text", KindText, "gpt-5.5", false, false),
			version(VersionGPT54Text, FamilyText, "GPT-5.4 Text", KindText, "gpt-5.4", false, false),
			version(VersionGPT54MiniText, FamilyText, "GPT-5.4 Mini Text", KindText, "gpt-5.4-mini", false, false),
			version(VersionGPT5MiniText, FamilyText, "GPT-5 Mini Text", KindText, "gpt-5-mini", false, false),
			version(VersionGPT41MiniText, FamilyText, "GPT-4.1 Mini Text", KindText, "gpt-4.1-mini", false, false),
			version(VersionGemini35FlashText, FamilyText, "Gemini 3.5 Flash Text", KindText, "gemini-3.5-flash", false, false),
			version(VersionGemini31ProText, FamilyText, "Gemini 3.1 Pro Preview Text", KindText, "gemini-3.1-pro-preview", false, false),
			version(VersionGemini31FlashLiteText, FamilyText, "Gemini 3.1 Flash Lite Text", KindText, "gemini-3.1-flash-lite", false, false),
			version(VersionMiniMaxM3Text, FamilyText, "MiniMax M3 Text", KindText, "MiniMax-M3", false, false),
			version(VersionMiniMaxM27Text, FamilyText, "MiniMax M2.7 Text", KindText, "MiniMax-M2.7", false, false),
			version(VersionMiniMaxM27HighspeedText, FamilyText, "MiniMax M2.7 Highspeed Text", KindText, "MiniMax-M2.7-highspeed", false, false),
			version(VersionDeepSeekV4FlashText, FamilyText, "DeepSeek V4 Flash Text", KindText, "deepseek-v4-flash", false, false),
			version(VersionDeepSeekV4ProText, FamilyText, "DeepSeek V4 Pro Text", KindText, "deepseek-v4-pro", false, false),
		},
		Routes: []ModelRoute{
			dmxRoute(RouteDMXGPT41MiniText, FamilyText, VersionGPT41MiniText, "DMX", "gpt-4.1-mini", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ModelGPT41MiniText),
			officialRoute(RouteOfficialGPT55Text, FamilyText, VersionGPT55Text, KindText, "OpenAI official", "gpt-5.5", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{ProviderOpenAI}, textParams(), false, false),
			officialRoute(RouteOfficialGPT54Text, FamilyText, VersionGPT54Text, KindText, "OpenAI official", "gpt-5.4", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{ProviderOpenAI}, textParams(), false, false),
			officialRoute(RouteOfficialGPT54MiniText, FamilyText, VersionGPT54MiniText, KindText, "OpenAI official", "gpt-5.4-mini", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{ProviderOpenAI}, textParams(), false, false),
			officialRoute(RouteOfficialGemini35FlashText, FamilyText, VersionGemini35FlashText, KindText, "Google official", "gemini-3.5-flash", AdapterOfficialGoogleChatText, "https://ai.google.dev/gemini-api/docs/models", []string{ProviderGoogle}, textParams(), false, false),
			officialRoute(RouteOfficialGemini31ProText, FamilyText, VersionGemini31ProText, KindText, "Google official", "gemini-3.1-pro-preview", AdapterOfficialGoogleChatText, "https://ai.google.dev/gemini-api/docs/models", []string{ProviderGoogle}, textParams(), false, false),
			officialRoute(RouteOfficialGemini31FlashLiteText, FamilyText, VersionGemini31FlashLiteText, KindText, "Google official", "gemini-3.1-flash-lite", AdapterOfficialGoogleChatText, "https://ai.google.dev/gemini-api/docs/models", []string{ProviderGoogle}, textParams(), false, false),
			officialRoute(RouteOfficialMiniMaxM3Text, FamilyText, VersionMiniMaxM3Text, KindText, "MiniMax 国内", "MiniMax-M3", AdapterOfficialMiniMaxChatText, "https://platform.minimaxi.com/docs/api-reference/model/text-model", []string{ProviderMiniMax}, textParams(), false, false),
			officialRoute(RouteOfficialMiniMaxM27Text, FamilyText, VersionMiniMaxM27Text, KindText, "MiniMax 国内", "MiniMax-M2.7", AdapterOfficialMiniMaxChatText, "https://platform.minimaxi.com/docs/api-reference/model/text-model", []string{ProviderMiniMax}, textParams(), false, false),
			officialRoute(RouteOfficialMiniMaxM27HighspeedText, FamilyText, VersionMiniMaxM27HighspeedText, KindText, "MiniMax 国内", "MiniMax-M2.7-highspeed", AdapterOfficialMiniMaxChatText, "https://platform.minimaxi.com/docs/api-reference/model/text-model", []string{ProviderMiniMax}, textParams(), false, false),
			officialRoute(RouteOfficialDeepSeekV4FlashText, FamilyText, VersionDeepSeekV4FlashText, KindText, "DeepSeek official", "deepseek-v4-flash", AdapterOfficialDeepSeekChatText, "https://api-docs.deepseek.com/quick_start/pricing", []string{ProviderDeepSeek}, textParams(), false, false),
			officialRoute(RouteOfficialDeepSeekV4ProText, FamilyText, VersionDeepSeekV4ProText, KindText, "DeepSeek official", "deepseek-v4-pro", AdapterOfficialDeepSeekChatText, "https://api-docs.deepseek.com/quick_start/pricing", []string{ProviderDeepSeek}, textParams(), false, false),
			openRouterRoute(RouteOpenRouterGPT41MiniText, FamilyText, VersionGPT41MiniText, KindText, "OpenRouter", "openai/gpt-4.1-mini", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
			officialRoute(RouteOfficialGPT41MiniText, FamilyText, VersionGPT41MiniText, KindText, "OpenAI official", "gpt-4.1-mini", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{"openai"}, textParams(), false, false),
			openRouterRoute(RouteOpenRouterGPT5MiniText, FamilyText, VersionGPT5MiniText, KindText, "OpenRouter", "openai/gpt-5-mini", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
			officialRoute(RouteOfficialGPT5MiniText, FamilyText, VersionGPT5MiniText, KindText, "OpenAI official", "gpt-5-mini", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{"openai"}, textParams(), false, false),
		},
	},
	{
		Family: ModelFamily{
			ID:          FamilyGPTImage,
			Label:       "GPT Image",
			Kind:        KindImage,
			Description: "OpenAI image generation models",
		},
		Versions: []ModelVersion{
			version(VersionGPTImage2, FamilyGPTImage, "GPT Image 2", KindImage, "gpt-image-2", false, true),
			version(VersionGPT54Image2, FamilyGPTImage, "GPT-5.4 Image 2", KindImage, "openai/gpt-5.4-image-2", false, false),
		},
		Routes: []ModelRoute{
			officialRoute(RouteOfficialGPTImage2, FamilyGPTImage, VersionGPTImage2, KindImage, "OpenAI official", "gpt-image-2", AdapterOfficialOpenAIImage, "https://platform.openai.com/docs/guides/image-generation", []string{"openai"}, officialGPTImageParams(), false, false),
			dmxRoute(RouteDMXGPTImage2, FamilyGPTImage, VersionGPTImage2, "DMX", "gpt-image-2-ssvip", AdapterDMXImagesGenerations, "https://doc.dmxapi.cn/gpt-image-2-image-edit.html", dmxGPTImageParams(), false, true, ModelGPTImage2),
			openRouterRoute(RouteOpenRouterGPT54Image2, FamilyGPTImage, VersionGPT54Image2, KindImage, "OpenRouter", "openai/gpt-5.4-image-2", AdapterOpenRouterChatImage, openRouterImageDocs, openRouterImageParams(), false, false),
		},
	},
	{
		Family: ModelFamily{
			ID:          FamilyNanoBanana,
			Label:       "Nano Banana",
			Kind:        KindImage,
			Description: "Gemini image generation models",
		},
		Versions: []ModelVersion{
			version(VersionNanoBanana31, FamilyNanoBanana, "Nano Banana 2 / Gemini 3.1 Flash Image", KindImage, "gemini-3.1-flash-image-preview", false, true),
			version(VersionNanoBananaPro, FamilyNanoBanana, "Nano Banana Pro / Gemini 3 Pro Image", KindImage, "gemini-3-pro-image-preview", false, true),
			version(VersionNanoBanana25, FamilyNanoBanana, "Nano Banana / Gemini 2.5 Flash Image", KindImage, "gemini-2.5-flash-image", false, true),
		},
		Routes: []ModelRoute{
			officialRoute(RouteOfficialNanoBanana31, FamilyNanoBanana, VersionNanoBanana31, KindImage, "Google official", "gemini-3.1-flash-image-preview", AdapterOfficialGoogleImage, "https://ai.google.dev/gemini-api/docs/image-generation", []string{"google"}, nanoBananaParams(), false, true),
			dmxRoute(RouteDMXNanoBanana31, FamilyNanoBanana, VersionNanoBanana31, "DMX", "gemini-3.1-flash-image-preview", AdapterDMXGeminiGenerate, "https://doc.dmxapi.cn/gemini-3.1-flash-image-preview-edit.html", nanoBananaParams(), false, true, ModelNanoBanana),
			openRouterRoute(RouteOpenRouterNanoBanana31, FamilyNanoBanana, VersionNanoBanana31, KindImage, "OpenRouter", "google/gemini-3.1-flash-image-preview", AdapterOpenRouterChatImage, openRouterImageDocs, openRouterImageParams(), false, false),
			openRouterRoute(RouteOpenRouterNanoBananaPro, FamilyNanoBanana, VersionNanoBananaPro, KindImage, "OpenRouter", "google/gemini-3-pro-image-preview", AdapterOpenRouterChatImage, openRouterImageDocs, openRouterImageParams(), false, false),
			openRouterRoute(RouteOpenRouterNanoBanana25, FamilyNanoBanana, VersionNanoBanana25, KindImage, "OpenRouter", "google/gemini-2.5-flash-image", AdapterOpenRouterChatImage, openRouterImageDocs, openRouterImageParams(), false, false),
		},
	},
	{
		Family: ModelFamily{
			ID:          FamilySeedance,
			Label:       "即梦 / Seedance",
			Kind:        KindVideo,
			Description: "ByteDance text-to-video models",
		},
		Versions: []ModelVersion{
			version(VersionSeedance20Fast, FamilySeedance, "Seedance 2.0 Fast", KindVideo, "doubao-seedance-2-0-fast-260128", true, false),
			version(VersionSeedance20Mini, FamilySeedance, "Seedance 2.0 Mini", KindVideo, "seedance2.0mini", true, true),
			version(VersionSeedance20, FamilySeedance, "Seedance 2.0", KindVideo, "bytedance/seedance-2.0", true, true),
			version(VersionSeedance20FastVIP, FamilySeedance, "Seedance 2.0 Fast VIP", KindVideo, "seedance2.0fast_vip", true, true),
			version(VersionSeedance20VIP, FamilySeedance, "Seedance 2.0 VIP", KindVideo, "seedance2.0_vip", true, true),
			version(VersionSeedance15Pro, FamilySeedance, "Seedance 1.5 Pro", KindVideo, "bytedance/seedance-1-5-pro", true, true),
		},
		Routes: []ModelRoute{
			dmxRoute(RouteDMXSeedance20Fast, FamilySeedance, VersionSeedance20Fast, "DMX", "doubao-seedance-2-0-fast-260128", AdapterDMXResponsesVideo, "https://doc.dmxapi.cn/doubao-seedance-2-0-fast-text-to-video.html", dmxSeedanceParams(), true, false, ModelJimengSeedance2Fast),
			jimengRoute(RouteJimengSeedance20Fast, FamilySeedance, VersionSeedance20Fast, "即梦", "seedance2.0fast", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ModelJimengSeedance2Fast),
			jimengRoute(RouteJimengSeedance20Mini, FamilySeedance, VersionSeedance20Mini, "即梦", "seedance2.0mini", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ""),
			jimengRoute(RouteJimengSeedance20, FamilySeedance, VersionSeedance20, "即梦", "seedance2.0", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ""),
			jimengRoute(RouteJimengSeedance20FastVIP, FamilySeedance, VersionSeedance20FastVIP, "即梦", "seedance2.0fast_vip", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ""),
			jimengRoute(RouteJimengSeedance20VIP, FamilySeedance, VersionSeedance20VIP, "即梦", "seedance2.0_vip", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceVIPParams(), true, true, ""),
			officialRoute(RouteOfficialSeedance20Fast, FamilySeedance, VersionSeedance20Fast, KindVideo, "Volcengine official", "doubao-seedance-2-0-fast-260128", AdapterOfficialVolcengineVideo, "https://www.volcengine.com/docs/82379/1520757", []string{"volcengine"}, officialSeedanceParams(), true, true),
			openRouterRoute(RouteOpenRouterSeedance20Fast, FamilySeedance, VersionSeedance20Fast, KindVideo, "OpenRouter", "bytedance/seedance-2.0-fast", AdapterOpenRouterVideo, openRouterVideoDocs, openRouterVideoParams(), true, true),
			openRouterRoute(RouteOpenRouterSeedance20, FamilySeedance, VersionSeedance20, KindVideo, "OpenRouter", "bytedance/seedance-2.0", AdapterOpenRouterVideo, openRouterVideoDocs, openRouterVideoParams(), true, true),
			openRouterRoute(RouteOpenRouterSeedance15Pro, FamilySeedance, VersionSeedance15Pro, KindVideo, "OpenRouter", "bytedance/seedance-1-5-pro", AdapterOpenRouterVideo, openRouterVideoDocs, openRouterVideoParams(), true, true),
		},
	},
	{
		Family: ModelFamily{
			ID:          FamilyMiniMaxSpeech,
			Label:       "MiniMax 国内 Speech",
			Kind:        KindAudio,
			Description: "MiniMax 国内文本转语音模型",
		},
		Versions: []ModelVersion{
			version(VersionMiniMaxSpeech28HD, FamilyMiniMaxSpeech, "Minimax-speech-2.8-hd", KindAudio, "speech-2.8-hd", false, false),
			version(VersionMiniMaxSpeech28Turbo, FamilyMiniMaxSpeech, "Minimax-speech-2.8-turbo", KindAudio, "speech-2.8-turbo", false, false),
		},
		Routes: []ModelRoute{
			officialRoute(RouteOfficialMiniMaxSpeech28HD, FamilyMiniMaxSpeech, VersionMiniMaxSpeech28HD, KindAudio, "MiniMax 国内", "speech-2.8-hd", AdapterOfficialMiniMaxSpeech, "https://platform.minimaxi.com/docs/api-reference/speech-t2a-http", []string{ProviderMiniMax}, minimaxSpeechParams(), false, false),
			officialRoute(RouteOfficialMiniMaxSpeech28Turbo, FamilyMiniMaxSpeech, VersionMiniMaxSpeech28Turbo, KindAudio, "MiniMax 国内", "speech-2.8-turbo", AdapterOfficialMiniMaxSpeech, "https://platform.minimaxi.com/docs/api-reference/speech-t2a-http", []string{ProviderMiniMax}, minimaxSpeechParams(), false, false),
		},
	},
}
