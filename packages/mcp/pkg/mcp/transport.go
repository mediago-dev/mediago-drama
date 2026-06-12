package mcp

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// HTTPServerSessionTimeout is the shared streamable HTTP MCP session timeout.
const HTTPServerSessionTimeout = 10 * time.Minute

// RunStdio runs an MCP server over stdio and treats EOF as a clean shutdown.
func RunStdio(
	ctx context.Context,
	server *mcpsdk.Server,
	input io.Reader,
	output io.Writer,
	logMessage string,
	logAttrs ...any,
) error {
	err := server.Run(ctx, &mcpsdk.IOTransport{
		Reader: io.NopCloser(input),
		Writer: writeCloser{Writer: output},
	})
	if isCleanEOF(err) {
		slog.Debug(logMessage, append(logAttrs, "reason", "eof")...)
		return nil
	}
	if err != nil {
		slog.Error(logMessage, append(logAttrs, "error", err)...)
		return err
	}
	slog.Debug(logMessage, append(logAttrs, "reason", "completed")...)
	return nil
}

type writeCloser struct {
	io.Writer
}

func (writeCloser) Close() error {
	return nil
}

func isCleanEOF(err error) bool {
	return err != nil && (errors.Is(err, io.EOF) || strings.Contains(err.Error(), "EOF"))
}
