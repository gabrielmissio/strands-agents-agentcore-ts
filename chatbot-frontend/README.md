# Chatbot Frontend

React + Vite chatbot UI for the demo application.

This package owns the browser experience. For deployed environments, infra derives the frontend transport mode from `AGENT_AUTH_MODE`; this package still exposes `VITE_AGENT_MODE` for local standalone development. Repository-level architecture and deployment context live in the root [README.md](../README.md).

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Useful scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the local Vite development server |
| `npm run build` | Type-check and build the production bundle |
| `npm run preview` | Preview the built bundle locally |
| `npm run typecheck` | Run `tsc --noEmit` on its own, without building |
| `npm run test` | Run the test suite (vitest) |

## Runtime modes

Set `VITE_AGENT_MODE` in [chatbot-frontend/.env.example](.env.example) for local development:

| Mode | Behavior |
|---|---|
| `bff` | Sends chat requests to the BFF endpoint defined by `VITE_API_URL` |
| `direct` | Sends chat requests directly to AgentCore |

The current implementation requires Cognito sign-in before the chat UI is available in both modes.

## Sign-up mode

`VITE_PUBLIC_SIGNUP_ENABLED` (mirrors `PUBLIC_SIGNUP_ENABLED` in `infra/`, injected via `config.js` in deployed environments) toggles which auth screen [`AuthScreen`](src/components/AuthScreen.tsx) renders:

- `true` (default): sign in, or sign up and confirm via email code.
- `false`: sign in only — no sign-up form. An admin provisions the account (see [infra/README.md](../infra/README.md#user-provisioning-invite-only)), and the first sign-in answers Cognito's `NEW_PASSWORD_REQUIRED` challenge to replace the temporary password.

## Admin panel

Members of the Cognito `admins` group (see [infra/README.md](../infra/README.md#admin-group)) get an **Admin** badge in the chat header that opens [`AdminPanel`](src/components/AdminPanel.tsx) — list existing users and invite new ones without leaving the browser. There is no router here: `App.tsx` just swaps which component it renders.

The badge and the panel are reachability only. [`src/lib/session-roles.ts`](src/lib/session-roles.ts) reads the `cognito:groups` claim decoded in the browser, which proves nothing to a server — the BFF's `/admin/users` routes re-check group membership on every call (see `chatbot-bff/src/admin.ts`), so a stale or forged client-side claim can under-grant access but never over-grant it.

## i18n

[`src/lib/i18n/`](src/lib/i18n) is a dependency-free translation layer: `core.ts` handles fallback resolution and CLDR pluralization via `Intl.PluralRules`, `context.ts`/`index.tsx` wire it into React (`useI18n()`, `<I18nProvider>`), and `messages/` holds one catalog per locale (`en-US`, `pt-BR`). Every component that renders copy calls `t('some.key')`; a key missing from the active locale falls back to `en-US`, and a key missing everywhere renders as the key itself — a visible `admin.inviteTitle` in the UI is a bug report, an empty string would just look like a deliberately blank label.

The active locale is detected once (a past choice in `localStorage`, then the browser's language list, then English) and changeable at runtime via [`LanguageSwitcher`](src/components/LanguageSwitcher.tsx), shown on the auth screen, the chat header, and the admin panel. Signing up also writes the current locale to the user's `custom:inviteLocale` attribute, so the account's invite/verification emails go out in the same language — see [infra/README.md](../infra/README.md#emails).

Server error codes (from the BFF's `/admin/users` routes) are localized separately: `translateErrorCode()` maps a code like `emailAlreadyExists` onto `error.emailAlreadyExists` in the catalog, falling back to the server's English message if the code is unrecognized. The server itself never ships prose to translate.

## Environment variables

Use [chatbot-frontend/.env.example](.env.example) as the source of truth.

| Variable | Required | Purpose |
|---|---|---|
| `VITE_AGENT_MODE` | Yes | Selects `bff` or `direct` mode |
| `VITE_API_URL` | For `bff` mode | Base URL for the BFF |
| `VITE_COGNITO_USER_POOL_ID` | Yes | Cognito user pool ID |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | Yes | Cognito app client ID |
| `VITE_COGNITO_IDENTITY_POOL_ID` | Yes | Cognito identity pool ID |
| `VITE_COGNITO_REGION` | Yes | Cognito region |
| `VITE_AGENT_RUNTIME_ARN` | For `direct` mode | Target AgentCore runtime ARN |
| `VITE_AGENT_ENDPOINT_NAME` | No | AgentCore qualifier, defaults to `DEFAULT` |
| `VITE_AWS_REGION` | Yes | AWS region used by the frontend config |
| `VITE_AGENTCORE_URL` | No | Optional explicit AgentCore base URL override |
| `VITE_PUBLIC_SIGNUP_ENABLED` | No | `false` hides self sign-up and switches the auth screen to invite-only. Defaults to enabled |

## Notes

- The deployed frontend receives runtime configuration through `config.js`
- In deployed environments, `VITE_AGENT_MODE` is supplied by `infra/` based on `AGENT_AUTH_MODE`
- The app uses Cognito through Amplify for browser authentication
- When testing local BFF mode, point `VITE_API_URL` to the local BFF server, for example `http://localhost:3001`
