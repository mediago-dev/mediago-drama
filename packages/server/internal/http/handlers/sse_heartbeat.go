package handlers

import (
	"fmt"
	"net/http"
	"time"
)

// sseHeartbeatInterval is how long an SSE stream may stay idle before the
// handler emits a keepalive. A var so tests can shorten it.
var sseHeartbeatInterval = 15 * time.Second

// sseHeartbeatEventType is the named keepalive event clients may observe.
const sseHeartbeatEventType = "stream.ping"

// writeSSEHeartbeat emits a keepalive. The comment line keeps proxies from
// idling out the connection; the named event carries the same signal in a
// form the EventSource API can surface, since comments never reach clients.
func writeSSEHeartbeat(writer http.ResponseWriter) {
	fmt.Fprintf(writer, ": ping\nevent: %s\ndata: {}\n\n", sseHeartbeatEventType)
}
