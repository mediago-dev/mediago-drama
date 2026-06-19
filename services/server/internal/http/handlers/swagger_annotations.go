//go:build !workspace_dist

package handlers

// SwaggerEnvelope documents the common JSON response envelope.
type SwaggerEnvelope struct {
	Code    int         `json:"code" example:"0"`
	Message string      `json:"message" example:"成功"`
	Data    interface{} `json:"data"`
	Success bool        `json:"success" example:"true"`
}

// SwaggerObject documents a flexible JSON request body.
type SwaggerObject map[string]interface{}
