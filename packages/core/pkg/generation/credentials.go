package generation

// CredentialSpec describes one credential slot used by generation routes.
type CredentialSpec struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Description     string `json:"description"`
	CredentialLabel string `json:"credentialLabel,omitempty"`
	Placeholder     string `json:"placeholder,omitempty"`
	Help            string `json:"help,omitempty"`
	CredentialKind  string `json:"credentialKind,omitempty"`
}

// CredentialSpecs returns the credential slots referenced by the catalog.
func CredentialSpecs() []CredentialSpec {
	specs := []CredentialSpec{
		{
			ID:          ProviderDMX,
			Label:       "DMX",
			Description: "DMX aggregation platform",
		},
		{
			ID:          ProviderOpenRouter,
			Label:       "OpenRouter",
			Description: "OpenRouter multimodal routes",
		},
		{
			ID:          ProviderOpenAI,
			Label:       "OpenAI",
			Description: "OpenAI official text and image routes",
		},
		{
			ID:          ProviderGoogle,
			Label:       "Google Gemini",
			Description: "Google official Gemini text and image routes",
		},
		{
			ID:              ProviderMiniMax,
			Label:           "MiniMax 国内",
			Description:     "MiniMax 国内文本与语音生成路由",
			CredentialLabel: "MiniMax 国内 API Key",
			Placeholder:     "输入 MiniMax 国内 API Key",
			Help:            "用于 MiniMax-M3 / MiniMax-M2.7 文本生成，以及 speech-2.8-hd / speech-2.8-turbo 文本转语音生成。",
		},
		{
			ID:              ProviderDeepSeek,
			Label:           "DeepSeek",
			Description:     "DeepSeek official text generation routes",
			CredentialLabel: "DeepSeek API Key",
			Placeholder:     "输入 DeepSeek API Key",
			Help:            "用于 DeepSeek V4 Flash / V4 Pro 文本生成，也可作为智能体模型凭据。",
		},
		{
			ID:          ProviderVolcengine,
			Label:       "Volcengine",
			Description: "Seedream and Seedance official routes",
		},
		{
			ID:             ProviderJimeng,
			Label:          "即梦",
			Description:    "Jimeng CLI local OAuth session",
			CredentialKind: "oauth",
			Help:           "使用本地打包的即梦 CLI 登录，生成会消耗当前即梦账号额度。",
		},
	}

	result := make([]CredentialSpec, len(specs))
	copy(result, specs)
	return result
}

// FindCredentialSpec returns a credential slot by id.
func FindCredentialSpec(id string) (CredentialSpec, bool) {
	for _, spec := range CredentialSpecs() {
		if spec.ID == id {
			return spec, true
		}
	}

	return CredentialSpec{}, false
}
