
## Real-time status updates

After the bridge health check succeeds, the page opens:

```text
ws://127.0.0.1:8787/ws?token=<browser-token>
```

or, for an HTTPS relay:

```text
wss://relay.example.com/ws?token=<browser-token>
```

The page shows `live`, `reconnecting`, or `HTTP only` in the connection indicator. It adds live queue, `SENT`, `DELIVERED`, `FAILED`, and inbound-message events to the activity feed.

For local browser testing, configure the mock/relay origin allowlist to include `http://127.0.0.1:8080`. For GitHub Pages, add the exact deployed origin such as `https://OWNER.github.io`—not `*`.
