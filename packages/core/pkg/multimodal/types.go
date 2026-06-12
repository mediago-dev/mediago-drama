package multimodal

// Role identifies who produced a message.
type Role string

const (
	// RoleSystem marks instructions that define agent behavior.
	RoleSystem Role = "system"
	// RoleUser marks user-authored input.
	RoleUser Role = "user"
	// RoleAssistant marks model-authored output.
	RoleAssistant Role = "assistant"
	// RoleTool marks output returned by an internal tool.
	RoleTool Role = "tool"
)

// Modality identifies the media kind carried by a part.
type Modality string

const (
	// ModalityText carries plain text.
	ModalityText Modality = "text"
	// ModalityImage carries image bytes or a URI.
	ModalityImage Modality = "image"
	// ModalityAudio carries audio bytes or a URI.
	ModalityAudio Modality = "audio"
	// ModalityVideo carries video bytes or a URI.
	ModalityVideo Modality = "video"
	// ModalityFile carries arbitrary file bytes or a URI.
	ModalityFile Modality = "file"
)

// Part is a single multimodal input or output fragment.
type Part struct {
	Modality Modality
	Text     string
	MIMEType string
	Data     []byte
	URI      string
	Name     string
	Metadata map[string]any
}

// Message is an ordered collection of multimodal parts and model/tool metadata.
type Message struct {
	Role       Role
	Name       string
	Parts      []Part
	ToolCalls  []ToolCall
	ToolCallID string
	ToolName   string
	Reasoning  string
	Metadata   map[string]any
}

// GenerateRequest describes a provider generation request.
type GenerateRequest struct {
	Messages []Message
	Options  GenerateOptions
	Tools    []Tool
}

// GenerateOptions carries common provider generation controls.
type GenerateOptions struct {
	Model       string
	Temperature *float32
	MaxTokens   *int
	TopP        *float32
	Stop        []string
	ToolChoice  ToolChoice
	Metadata    map[string]any
}

// GenerateResponse describes a provider generation response.
type GenerateResponse struct {
	Messages []Message
	Usage    Usage
	Metadata map[string]any
}

// Usage captures common model token accounting.
type Usage struct {
	InputTokens     int
	OutputTokens    int
	TotalTokens     int
	ReasoningTokens int
	CachedTokens    int
}

// ToolChoice controls whether a model may or must call tools.
type ToolChoice string

const (
	// ToolChoiceAuto lets the model decide whether to call tools.
	ToolChoiceAuto ToolChoice = ""
	// ToolChoiceAllowed lets the model decide whether to call tools.
	ToolChoiceAllowed ToolChoice = "allowed"
	// ToolChoiceForbidden prevents tool calls.
	ToolChoiceForbidden ToolChoice = "forbidden"
	// ToolChoiceForced requires at least one tool call.
	ToolChoiceForced ToolChoice = "forced"
)

// Tool describes a callable capability that can be bound to a provider request.
type Tool struct {
	Name        string
	Description string
	Parameters  map[string]ToolParameter
	Metadata    map[string]any
}

// ToolParameter describes one JSON-schema-like tool parameter.
type ToolParameter struct {
	Type        ToolParameterType
	Description string
	Required    bool
	Enum        []string
	Items       *ToolParameter
	Properties  map[string]ToolParameter
}

// ToolParameterType is the JSON-compatible type of a tool parameter.
type ToolParameterType string

const (
	// ToolParameterObject describes an object parameter.
	ToolParameterObject ToolParameterType = "object"
	// ToolParameterString describes a string parameter.
	ToolParameterString ToolParameterType = "string"
	// ToolParameterNumber describes a number parameter.
	ToolParameterNumber ToolParameterType = "number"
	// ToolParameterInteger describes an integer parameter.
	ToolParameterInteger ToolParameterType = "integer"
	// ToolParameterBoolean describes a boolean parameter.
	ToolParameterBoolean ToolParameterType = "boolean"
	// ToolParameterArray describes an array parameter.
	ToolParameterArray ToolParameterType = "array"
)

// ToolCall describes a function/tool call requested by a model.
type ToolCall struct {
	ID        string
	Type      string
	Name      string
	Arguments string
	Index     *int
	Metadata  map[string]any
}

// ToolResult describes structured output returned by an internal tool.
type ToolResult struct {
	ToolCallID string
	ToolName   string
	Parts      []Part
	Metadata   map[string]any
}
