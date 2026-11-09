
## Hardened relay mode

The console now supports the relay's `/auth/login` flow. Enter the bridge URL plus the relay username and password; the page stores only the short-lived session token in browser storage and uses it for HTTP and WebSocket requests.

Pairing is intentionally an administrative action rather than an automatic browser action. Use the relay's authenticated `POST /auth/pairings` endpoint to create a one-time code and device key, then enter both in the Android app's pairing screen. After activation, the APK must send `X-Device-Key` and must not use the global Android API key.

See the relay project's `SECURITY.md` for the full migration and revocation procedure.
