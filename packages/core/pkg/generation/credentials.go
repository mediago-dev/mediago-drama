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
			ID:          ProviderMediago,
			Label:       "MediaGo",
			Description: "MediaGo unified aggregation platform",
		},
		{
			ID:              ProviderDMX,
			Label:           "DMX",
			Description:     "DMX aggregation platform",
			CredentialLabel: "DMX API Key",
			Placeholder:     "输入 DMX API Key",
			Help:            "用于 DMX 聚合平台生成路由，也可作为智能体模型凭据。",
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
			ID:              ProviderAliyun,
			Label:           "阿里云百炼",
			Description:     "阿里云百炼万相图像与 HappyHorse 视频生成路由",
			CredentialLabel: "百炼 API Key",
			Placeholder:     "输入阿里云百炼 API Key",
			Help:            "用于 wan2.7-image-pro、wan2.7-image 图像生成与编辑，以及 HappyHorse 1.1 视频生成。",
		},
		{
			ID:             ProviderJimeng,
			Label:          "即梦",
			Description:    "Jimeng CLI local OAuth session",
			CredentialKind: "oauth",
			Help:           "使用本地打包的即梦 CLI 登录，生成会消耗当前即梦账号额度。",
		},
		{
			ID:             ProviderLibTV,
			Label:          "LibTV",
			Description:    "LibTV CLI local login session",
			CredentialKind: "oauth",
			Help:           "使用本地打包的 LibTV CLI 登录，生成会消耗当前 LibTV 账号额度。",
		},
		{
			ID:              ProviderXiaoyunque,
			Label:           "小云雀",
			Description:     "Pippit / 小云雀 CLI Access Key",
			CredentialLabel: "小云雀 Access Key",
			Placeholder:     "输入 XYQ_ACCESS_KEY",
			Help:            "使用本地打包的小云雀 / Pippit CLI，保存后将作为 XYQ_ACCESS_KEY 使用。",
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
