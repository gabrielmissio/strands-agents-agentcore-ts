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
