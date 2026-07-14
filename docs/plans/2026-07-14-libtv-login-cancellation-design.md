# LibTV Login Cancellation Design

## Context

The bundled LibTV CLI exposes `login web`, which starts a local callback server and waits until browser authorization completes. It has no headless or detached device-code mode. The server currently lets that process live for up to ten minutes after returning the login URL, so abandoning authorization can leave a callback process that conflicts with a retry.

## Design

The settings service will track the active LibTV login process in memory. Each attempt receives an identifier, cancellation function, and completion signal. Registering a new attempt cancels and waits for any older attempt before the new flow begins. Clearing the LibTV credential also cancels and waits for the active attempt before invoking `libtv logout`.

Completion removes only the matching attempt, preventing an older goroutine from deleting a newer registration. Successful natural completion keeps the existing behavior of persisting the OAuth marker. Cancellation produces a command error, so the completion goroutine must not persist a marker.

## Error Handling

Cancellation waits for a bounded interval. If the process does not exit, retry or logout returns an error rather than claiming recovery succeeded while a callback server remains alive. The existing UI confirmation and toast paths surface that error and keep the action retryable.

## Verification

A fake LibTV CLI will emit a login URL and then block. Tests will verify that clearing terminates the process, runs logout, and permits a second login attempt. Existing natural-completion tests continue to verify marker persistence.
