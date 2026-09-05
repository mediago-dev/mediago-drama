package generation

type familySpec struct {
	Family   ModelFamily
	Versions []ModelVersion
	Routes   []ModelRoute
}

var familySpecs = []familySpec{
	{
		Family: ModelFamily{
			ID:          FamilyWhereslowImage,
			Label:       "Nano Banana 2",
			Kind:        KindImage,
			Description: "Custom Gemini image generation",
		},
		Versions: []ModelVersion{
			version(VersionWhereslowNanoBanana2, FamilyWhereslowImage, "Nano Banana 2", KindImage, "nano-banana-2", false, true),
		},
		Routes: []ModelRoute{
			{
				ID:                    RouteWhereslowNanoBanana2,
				FamilyID:              FamilyWhereslowImage,
				VersionID:             VersionWhereslowNanoBanana2,
				Label:                 "自定义 Gemini",
				Kind:                  KindImage,
				Provider:              ProviderWhereslowImage,
				Model:                 "nano-banana-2",
				Adapter:               AdapterWhereslowImage,
				DocURL:                "https://ai.google.dev/api/generate-content",
				Async:                 false,
				SupportsReferenceURLs: true,
				MaxReferenceURLs:      4,
				Status:                RouteStatusAvailable,
				AuthKeys:              []string{ProviderWhereslowImage},
				Params:                routeParamSpecs(KindImage, nanoBananaParams().CanonicalParams),
				ParamGroups:           routeParamGroups(KindImage, nanoBananaParams().CanonicalParams),
				Combos:                cloneParamCombos(nanoBananaParams().Combos),
				CanonicalParams:       nanoBananaParams().CanonicalParams,
				Translation:           nanoBananaParams().Translation,
			},
		},
	},
	{
		Family: ModelFamily{
			ID:          FamilyGPTText,
			Label:       "GPT",
			Kind:        KindText,
			Description: "GPT text generation models.",
		},
		Versions: []ModelVersion{
			version(VersionGPT56SolText, FamilyGPTText, "GPT-5.6 Sol", KindText, "gpt-5.6-sol", false, false),
			version(VersionGPT55Text, FamilyGPTText, "GPT-5.5 Text", KindText, "gpt-5.5", false, false),
			version(VersionGPT54Text, FamilyGPTText, "GPT-5.4 Text", KindText, "gpt-5.4", false, false),
			version(VersionGPT54MiniText, FamilyGPTText, "GPT-5.4 Mini Text", KindText, "gpt-5.4-mini", false, false),
			version(VersionGPT5MiniText, FamilyGPTText, "GPT-5 Mini Text", KindText, "gpt-5-mini", false, false),
			version(VersionGPT41MiniText, FamilyGPTText, "GPT-4.1 Mini Text", KindText, "gpt-4.1-mini", false, false),
		},
		Routes: concatModelRoutes(
			[]ModelRoute{
				dmxRoute(RouteDMXGPT41MiniText, FamilyGPTText, VersionGPT41MiniText, "DMX", "gpt-4.1-mini", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ModelGPT41MiniText),
				dmxRoute(RouteDMXGPT55Text, FamilyGPTText, VersionGPT55Text, "DMX", "gpt-5.5", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				dmxRoute(RouteDMXGPT54Text, FamilyGPTText, VersionGPT54Text, "DMX", "gpt-5.4", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				dmxRoute(RouteDMXGPT54MiniText, FamilyGPTText, VersionGPT54MiniText, "DMX", "gpt-5.4-mini", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				mediagoTextRoute(RouteMediagoGPT41MiniText, FamilyGPTText, VersionGPT41MiniText, "gpt-4.1-mini"),
				mediagoTextRoute(RouteMediagoGPT5MiniText, FamilyGPTText, VersionGPT5MiniText, "gpt-5-mini"),
				mediagoTextRoute(RouteMediagoGPT55Text, FamilyGPTText, VersionGPT55Text, "gpt-5.5"),
				mediagoTextRoute(RouteMediagoGPT54Text, FamilyGPTText, VersionGPT54Text, "gpt-5.4"),
				mediagoTextRoute(RouteMediagoGPT54MiniText, FamilyGPTText, VersionGPT54MiniText, "gpt-5.4-mini"),
			},
			[]ModelRoute{
				officialRoute(RouteOfficialGPT56SolText, FamilyGPTText, VersionGPT56SolText, KindText, "OpenAI 官方", "gpt-5.6-sol", AdapterOfficialOpenAIChatText, "https://developers.openai.com/api/docs/models/gpt-5.6-sol", []string{ProviderOpenAI}, gpt56SolTextParams(), false, false),
				officialRoute(RouteOfficialGPT55Text, FamilyGPTText, VersionGPT55Text, KindText, "OpenAI official", "gpt-5.5", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{ProviderOpenAI}, textParams(), false, false),
				officialRoute(RouteOfficialGPT54Text, FamilyGPTText, VersionGPT54Text, KindText, "OpenAI official", "gpt-5.4", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{ProviderOpenAI}, textParams(), false, false),
				officialRoute(RouteOfficialGPT54MiniText, FamilyGPTText, VersionGPT54MiniText, KindText, "OpenAI official", "gpt-5.4-mini", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{ProviderOpenAI}, textParams(), false, false),
				officialRoute(RouteOfficialGPT41MiniText, FamilyGPTText, VersionGPT41MiniText, KindText, "OpenAI official", "gpt-4.1-mini", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{"openai"}, textParams(), false, false),
				officialRoute(RouteOfficialGPT5MiniText, FamilyGPTText, VersionGPT5MiniText, KindText, "OpenAI official", "gpt-5-mini", AdapterOfficialOpenAIChatText, openAIChatDocs, []string{"openai"}, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGPT55Text, FamilyGPTText, VersionGPT55Text, KindText, "OpenRouter", "openai/gpt-5.5", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGPT54Text, FamilyGPTText, VersionGPT54Text, KindText, "OpenRouter", "openai/gpt-5.4", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGPT54MiniText, FamilyGPTText, VersionGPT54MiniText, KindText, "OpenRouter", "openai/gpt-5.4-mini", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGPT41MiniText, FamilyGPTText, VersionGPT41MiniText, KindText, "OpenRouter", "openai/gpt-4.1-mini", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGPT5MiniText, FamilyGPTText, VersionGPT5MiniText, KindText, "OpenRouter", "openai/gpt-5-mini", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
			},
		),
	},
	{
		Family: ModelFamily{
			ID:          FamilyGeminiText,
			Label:       "Gemini",
			Kind:        KindText,
			Description: "Gemini text generation models.",
		},
		Versions: []ModelVersion{
			version(VersionGemini35FlashText, FamilyGeminiText, "Gemini 3.5 Flash Text", KindText, "gemini-3.5-flash", false, false),
			version(VersionGemini31ProText, FamilyGeminiText, "Gemini 3.1 Pro Preview Text", KindText, "gemini-3.1-pro-preview", false, false),
			version(VersionGemini31FlashLiteText, FamilyGeminiText, "Gemini 3.1 Flash Lite Text", KindText, "gemini-3.1-flash-lite", false, false),
		},
		Routes: concatModelRoutes(
			[]ModelRoute{
				dmxRoute(RouteDMXGemini35FlashText, FamilyGeminiText, VersionGemini35FlashText, "DMX", "gemini-3.5-flash", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				dmxRoute(RouteDMXGemini31ProText, FamilyGeminiText, VersionGemini31ProText, "DMX", "gemini-3.1-pro-preview", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				dmxRoute(RouteDMXGemini31FlashLiteText, FamilyGeminiText, VersionGemini31FlashLiteText, "DMX", "gemini-3.1-flash-lite", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				mediagoTextRoute(RouteMediagoGemini35FlashText, FamilyGeminiText, VersionGemini35FlashText, "gemini-3.5-flash"),
				mediagoTextRoute(RouteMediagoGemini31ProText, FamilyGeminiText, VersionGemini31ProText, "gemini-3.1-pro-preview"),
				mediagoTextRoute(RouteMediagoGemini31FlashLiteText, FamilyGeminiText, VersionGemini31FlashLiteText, "gemini-3.1-flash-lite"),
			},
			[]ModelRoute{
				officialRoute(RouteOfficialGemini35FlashText, FamilyGeminiText, VersionGemini35FlashText, KindText, "Google official", "gemini-3.5-flash", AdapterOfficialGoogleChatText, "https://ai.google.dev/gemini-api/docs/models", []string{ProviderGoogle}, textParams(), false, false),
				officialRoute(RouteOfficialGemini31ProText, FamilyGeminiText, VersionGemini31ProText, KindText, "Google official", "gemini-3.1-pro-preview", AdapterOfficialGoogleChatText, "https://ai.google.dev/gemini-api/docs/models", []string{ProviderGoogle}, textParams(), false, false),
				officialRoute(RouteOfficialGemini31FlashLiteText, FamilyGeminiText, VersionGemini31FlashLiteText, KindText, "Google official", "gemini-3.1-flash-lite", AdapterOfficialGoogleChatText, "https://ai.google.dev/gemini-api/docs/models", []string{ProviderGoogle}, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGemini35FlashText, FamilyGeminiText, VersionGemini35FlashText, KindText, "OpenRouter", "google/gemini-3.5-flash", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGemini31ProText, FamilyGeminiText, VersionGemini31ProText, KindText, "OpenRouter", "google/gemini-3.1-pro-preview", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterGemini31FlashLiteText, FamilyGeminiText, VersionGemini31FlashLiteText, KindText, "OpenRouter", "google/gemini-3.1-flash-lite", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
			},
		),
	},
	{
		Family: ModelFamily{
			ID:          FamilyMiniMaxText,
			Label:       "MiniMax",
			Kind:        KindText,
			Description: "MiniMax text generation models.",
		},
		Versions: []ModelVersion{
			version(VersionMiniMaxM3Text, FamilyMiniMaxText, "MiniMax M3 Text", KindText, "MiniMax-M3", false, false),
			version(VersionMiniMaxM27Text, FamilyMiniMaxText, "MiniMax M2.7 Text", KindText, "MiniMax-M2.7", false, false),
			version(VersionMiniMaxM27HighspeedText, FamilyMiniMaxText, "MiniMax M2.7 Highspeed Text", KindText, "MiniMax-M2.7-highspeed", false, false),
		},
		Routes: concatModelRoutes(
			[]ModelRoute{
				dmxRoute(RouteDMXMiniMaxM3Text, FamilyMiniMaxText, VersionMiniMaxM3Text, "DMX", "MiniMax-M3", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				dmxRoute(RouteDMXMiniMaxM27Text, FamilyMiniMaxText, VersionMiniMaxM27Text, "DMX", "MiniMax-M2.7", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				dmxRoute(RouteDMXMiniMaxM27HighspeedText, FamilyMiniMaxText, VersionMiniMaxM27HighspeedText, "DMX", "MiniMax-M2.7-highspeed", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				mediagoTextRoute(RouteMediagoMiniMaxM3Text, FamilyMiniMaxText, VersionMiniMaxM3Text, "MiniMax-M3"),
				mediagoTextRoute(RouteMediagoMiniMaxM27Text, FamilyMiniMaxText, VersionMiniMaxM27Text, "MiniMax-M2.7"),
				mediagoTextRoute(RouteMediagoMiniMaxM27HighspeedText, FamilyMiniMaxText, VersionMiniMaxM27HighspeedText, "MiniMax-M2.7-highspeed"),
			},
			[]ModelRoute{
				officialRoute(RouteOfficialMiniMaxM3Text, FamilyMiniMaxText, VersionMiniMaxM3Text, KindText, "MiniMax 国内", "MiniMax-M3", AdapterOfficialMiniMaxChatText, "https://platform.minimaxi.com/docs/api-reference/model/text-model", []string{ProviderMiniMax}, textParams(), false, false),
				officialRoute(RouteOfficialMiniMaxM27Text, FamilyMiniMaxText, VersionMiniMaxM27Text, KindText, "MiniMax 国内", "MiniMax-M2.7", AdapterOfficialMiniMaxChatText, "https://platform.minimaxi.com/docs/api-reference/model/text-model", []string{ProviderMiniMax}, textParams(), false, false),
				officialRoute(RouteOfficialMiniMaxM27HighspeedText, FamilyMiniMaxText, VersionMiniMaxM27HighspeedText, KindText, "MiniMax 国内", "MiniMax-M2.7-highspeed", AdapterOfficialMiniMaxChatText, "https://platform.minimaxi.com/docs/api-reference/model/text-model", []string{ProviderMiniMax}, textParams(), false, false),
				openRouterRoute(RouteOpenRouterMiniMaxM3Text, FamilyMiniMaxText, VersionMiniMaxM3Text, KindText, "OpenRouter", "minimax/minimax-m3", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterMiniMaxM27Text, FamilyMiniMaxText, VersionMiniMaxM27Text, KindText, "OpenRouter", "minimax/minimax-m2.7", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterMiniMaxM27HighspeedText, FamilyMiniMaxText, VersionMiniMaxM27HighspeedText, KindText, "OpenRouter", "minimax/minimax-m2.7-highspeed", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
			},
		),
	},
	{
		Family: ModelFamily{
			ID:          FamilyDeepSeekText,
			Label:       "DeepSeek",
			Kind:        KindText,
			Description: "DeepSeek text generation models.",
		},
		Versions: []ModelVersion{
			version(VersionDeepSeekV4FlashText, FamilyDeepSeekText, "DeepSeek V4 Flash Text", KindText, "deepseek-v4-flash", false, false),
			version(VersionDeepSeekV4ProText, FamilyDeepSeekText, "DeepSeek V4 Pro Text", KindText, "deepseek-v4-pro", false, false),
		},
		Routes: concatModelRoutes(
			[]ModelRoute{
				dmxRoute(RouteDMXDeepSeekV4FlashText, FamilyDeepSeekText, VersionDeepSeekV4FlashText, "DMX", "deepseek-v4-flash", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				dmxRoute(RouteDMXDeepSeekV4ProText, FamilyDeepSeekText, VersionDeepSeekV4ProText, "DMX", "deepseek-v4-pro", AdapterDMXChatText, dmxChatDocs, textParams(), false, false, ""),
				mediagoTextRoute(RouteMediagoDeepSeekV4FlashText, FamilyDeepSeekText, VersionDeepSeekV4FlashText, "deepseek-v4-flash"),
				mediagoTextRoute(RouteMediagoDeepSeekV4ProText, FamilyDeepSeekText, VersionDeepSeekV4ProText, "deepseek-v4-pro"),
			},
			[]ModelRoute{
				officialRoute(RouteOfficialDeepSeekV4FlashText, FamilyDeepSeekText, VersionDeepSeekV4FlashText, KindText, "DeepSeek official", "deepseek-v4-flash", AdapterOfficialDeepSeekChatText, "https://api-docs.deepseek.com/quick_start/pricing", []string{ProviderDeepSeek}, textParams(), false, false),
				officialRoute(RouteOfficialDeepSeekV4ProText, FamilyDeepSeekText, VersionDeepSeekV4ProText, KindText, "DeepSeek official", "deepseek-v4-pro", AdapterOfficialDeepSeekChatText, "https://api-docs.deepseek.com/quick_start/pricing", []string{ProviderDeepSeek}, textParams(), false, false),
				openRouterRoute(RouteOpenRouterDeepSeekV4FlashText, FamilyDeepSeekText, VersionDeepSeekV4FlashText, KindText, "OpenRouter", "deepseek/deepseek-v4-flash", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
				openRouterRoute(RouteOpenRouterDeepSeekV4ProText, FamilyDeepSeekText, VersionDeepSeekV4ProText, KindText, "OpenRouter", "deepseek/deepseek-v4-pro", AdapterOpenRouterChatText, openRouterChatDocs, textParams(), false, false),
			},
		),
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
			version(VersionSeedance20MiniLite, FamilySeedance, "Seedance 2.0 Mini Lite", KindVideo, "Seedance_2.0_mini_lite", true, true),
			version(VersionSeedance15Pro, FamilySeedance, "Seedance 1.5 Pro", KindVideo, "bytedance/seedance-1-5-pro", true, true),
		},
		Routes: []ModelRoute{
			dmxRoute(RouteDMXSeedance20Fast, FamilySeedance, VersionSeedance20Fast, "DMX", "doubao-seedance-2-0-fast-260128", AdapterDMXResponsesVideo, "https://doc.dmxapi.cn/doubao-seedance-2-0-fast-text-to-video.html", dmxSeedanceParams(), true, false, ModelJimengSeedance2Fast),
			jimengRoute(RouteJimengSeedance20Fast, FamilySeedance, VersionSeedance20Fast, "即梦", "seedance2.0fast", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ModelJimengSeedance2Fast),
			libTVRoute(RouteLibTVSeedance20Fast, FamilySeedance, VersionSeedance20Fast, "LibTV", "Seedance 2.0 Fast VIP", AdapterLibTVCLIVideo, "https://www.liblib.tv/cli", libTVSeedanceParams(), true, true, "", withReferenceURLLimit(15)),
			xiaoyunqueRoute(RouteXiaoyunqueSeedance20Fast, FamilySeedance, VersionSeedance20Fast, "小云雀", "seedance2.0_fast_vision", AdapterPippitCLIVideo, "https://github.com/Pippit-dev/cli", pippitSeedanceParams(), true, true, ""),
			jimengRoute(RouteJimengSeedance20Mini, FamilySeedance, VersionSeedance20Mini, "即梦", "seedance2.0mini", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ""),
			libTVRoute(RouteLibTVSeedance20Mini, FamilySeedance, VersionSeedance20Mini, "LibTV", "Seedance 2.0 Mini", AdapterLibTVCLIVideo, "https://www.liblib.tv/cli", libTVSeedanceParams(), true, true, "", withReferenceURLLimit(15)),
			xiaoyunqueRoute(RouteXiaoyunqueSeedance20Mini, FamilySeedance, VersionSeedance20Mini, "小云雀", "Seedance_2.0_mini", AdapterPippitCLIVideo, "https://github.com/Pippit-dev/cli", pippitSeedanceParams(), true, true, ""),
			jimengRoute(RouteJimengSeedance20, FamilySeedance, VersionSeedance20, "即梦", "seedance2.0", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ""),
			libTVRoute(RouteLibTVSeedance20, FamilySeedance, VersionSeedance20, "LibTV", "Seedance 2.0 VIP", AdapterLibTVCLIVideo, "https://www.liblib.tv/cli", libTVSeedanceStandardParams(), true, true, "", withReferenceURLLimit(15)),
			xiaoyunqueRoute(RouteXiaoyunqueSeedance20, FamilySeedance, VersionSeedance20, "小云雀", "seedance2.0_vision", AdapterPippitCLIVideo, "https://github.com/Pippit-dev/cli", pippitSeedanceStandardParams(), true, true, ""),
			jimengRoute(RouteJimengSeedance20FastVIP, FamilySeedance, VersionSeedance20FastVIP, "即梦", "seedance2.0fast_vip", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceParams(), true, true, ""),
			jimengRoute(RouteJimengSeedance20VIP, FamilySeedance, VersionSeedance20VIP, "即梦", "seedance2.0_vip", AdapterJimengCLIVideo, "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", jimengSeedanceVIPParams(), true, true, ""),
			xiaoyunqueRoute(RouteXiaoyunqueSeedance20MiniLite, FamilySeedance, VersionSeedance20MiniLite, "小云雀", "Seedance_2.0_mini_lite", AdapterPippitCLIVideo, "https://github.com/Pippit-dev/cli", pippitSeedanceParams(), true, true, ModelXiaoyunqueSeedance2Mini),
			officialRoute(RouteOfficialSeedance20Fast, FamilySeedance, VersionSeedance20Fast, KindVideo, "Volcengine official", "doubao-seedance-2-0-fast-260128", AdapterOfficialVolcengineVideo, "https://www.volcengine.com/docs/82379/1520757", []string{"volcengine"}, officialSeedanceParams(), true, true),
			officialRoute(RouteOfficialSeedance20Mini, FamilySeedance, VersionSeedance20Mini, KindVideo, "Volcengine official", "doubao-seedance-2-0-mini-260615", AdapterOfficialVolcengineVideo, "https://www.volcengine.com/docs/82379/1520757", []string{"volcengine"}, officialSeedanceParams(), true, true),
			officialRoute(RouteOfficialSeedance20, FamilySeedance, VersionSeedance20, KindVideo, "Volcengine official", "doubao-seedance-2-0-260128", AdapterOfficialVolcengineVideo, "https://www.volcengine.com/docs/82379/1520757", []string{"volcengine"}, officialSeedanceParams(), true, true),
			openRouterRoute(RouteOpenRouterSeedance20Fast, FamilySeedance, VersionSeedance20Fast, KindVideo, "OpenRouter", "bytedance/seedance-2.0-fast", AdapterOpenRouterVideo, openRouterVideoDocs, openRouterVideoParams(), true, true),
			openRouterRoute(RouteOpenRouterSeedance20, FamilySeedance, VersionSeedance20, KindVideo, "OpenRouter", "bytedance/seedance-2.0", AdapterOpenRouterVideo, openRouterVideoDocs, openRouterVideoParams(), true, true),
			openRouterRoute(RouteOpenRouterSeedance15Pro, FamilySeedance, VersionSeedance15Pro, KindVideo, "OpenRouter", "bytedance/seedance-1-5-pro", AdapterOpenRouterVideo, openRouterVideoDocs, openRouterVideoParams(), true, true),
		},
	},
	{
		Family: ModelFamily{
			ID:          FamilyHappyHorse,
			Label:       "HappyHorse",
			Kind:        KindVideo,
			Description: "阿里云百炼 HappyHorse 1.1 有声视频生成模型",
		},
		Versions: []ModelVersion{
			version(VersionHappyHorse11, FamilyHappyHorse, "HappyHorse 1.1", KindVideo, ModelHappyHorse11, true, true),
		},
		Routes: concatModelRoutes(
			[]ModelRoute{
				officialRoute(RouteOfficialHappyHorse11, FamilyHappyHorse, VersionHappyHorse11, KindVideo, "阿里云百炼", ModelHappyHorse11, AdapterOfficialAliyunHappyHorseVideo, happyHorse11DocURL, []string{ProviderAliyun}, happyHorse11Params(), true, true, withReferenceURLLimit(9)),
			},
			[]ModelRoute{
				mediagoRoute(RouteMediagoHappyHorse11, FamilyHappyHorse, VersionHappyHorse11, KindVideo, ModelHappyHorse11T2V, AdapterMediagoVideo, mediagoHappyHorse11Params(), true, true, withReferenceURLLimit(9)),
			},
		),
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
