---
"@pantheon-systems/css-client": minor
---

**css-client:** Label requests for backend correlation. Every call now sends a W3C
`traceparent`, an `x-p1-request-id`, and `x-p1-sdk` identifying the calling package and
version, so a request can be traced from your application through the P1 backend to the
database.

The client does not collect, buffer, or transmit telemetry anywhere — it only labels the
API calls you already make, and issues no additional network requests.

Errors now carry the correlation id. `P1ApiError` (and its subclasses), `NetworkError`,
`AuthenticationError`, and `SessionExpiredError` expose `requestId`, and it is appended to
the error message as `[request id: …]` so it survives into logs and support tickets. The id
the server reports is preferred; when a request never reaches the API, the client-minted id
is used, so there is always something to quote.

Three new optional `P1ClientConfig` fields:

- `sdk` — `{ name, version }` for a wrapper SDK to identify itself instead of `css-client`.
- `clientId` — an application identifier sent as `x-p1-client-id`, for telling your own
  deployments apart in backend logs. Don't put anything personally identifying here.
- `getTraceparent` — supplies a `traceparent` from an ambient tracer, so a host application
  already running OpenTelemetry keeps one trace across its own spans and this client's
  requests. Omit it and each request starts a fresh trace.

No breaking changes; every new field is optional and existing behavior is unchanged.
