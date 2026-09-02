---
"@pantheon-systems/css-client": minor
"@pantheon-systems/puck-css": minor
"@pantheon-systems/p1-next-sdk": minor
---

**[Feature]** `brokerLogout()` is a new public export from `@pantheon-systems/css-client`. It asks the backend for the Auth0 logout URL and hands it back, reporting one of three outcomes — it does not navigate.

**[Fix]** Broker logout now ends the Auth0 session. Previously it only cleared the local token, so the next login signed the same user straight back in without a prompt.

### What Changed

- A failed logout no longer destroys the token, so it can be retried. The signed-in user's details are kept alongside it, rather than leaving a session that reports as authenticated with nobody attached.
- `createBrokerAuth().logout()` performs the redirect for you and returns the same three outcomes. If you call it, you need do nothing.
- `performLogout()` from `@pantheon-systems/puck-css` clears local state and returns the outcome, but does **not** redirect — on `signed_out` the caller must navigate to `outcome.logoutUrl`, or the Auth0 session stays alive.
- `useP1Auth().logout()` does perform that navigation for you, and now returns the outcome instead of `void`; ignoring the return value still compiles.
- Apps mounting `createP1AuthHandler` gain a `logout` route alongside `login` and `redeem`, so logout stays same-origin instead of calling the backend directly.
- A logout URL that is not `https:` is now rejected as an error rather than navigated to.
- `OAuthSession.logout()` returns the outcome instead of `void`. Calling it and ignoring the result is unchanged; writing your own `OAuthSession` implementation now means returning the outcome from `logout()`.

### Migration / Action Required

Only if you call `brokerLogout()` directly. It returns instead of navigating, so the redirect is yours to perform — and on `signed_out` that navigation is what actually ends the Auth0 session:

```ts
const outcome = await brokerLogout({ cssBaseUrl });

switch (outcome.status) {
  case 'signed_out':
    // Required. Without this the Auth0 session survives and the next
    // login signs the same user back in with no prompt.
    window.location.href = outcome.logoutUrl;
    break;

  case 'no_session':
    break; // Nothing to sign out of.

  case 'error':
    // The token is kept deliberately. Show the message and let the user
    // retry — clearing local state here renders them signed out while
    // they still hold a live credential.
    showError(outcome.message);
    break;
}
```
