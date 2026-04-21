# Chatbot Frontend

React + Vite chatbot UI for the demo application.

This package owns the browser experience and the feature flag that switches between direct AgentCore calls and BFF-mediated calls. Repository-level architecture and deployment context live in the root [README.md](../README.md).

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

Set `VITE_AGENT_MODE` in [chatbot-frontend/.env.example](.env.example):

| Mode | Behavior |
|---|---|
| `bff` | Sends chat requests to the BFF endpoint defined by `VITE_API_URL` |
| `direct` | Sends chat requests directly to AgentCore |

The current implementation requires Cognito sign-in before the chat UI is available in both modes.

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

## Notes

- The deployed frontend receives runtime configuration through `config.js`
- The app uses Cognito through Amplify for browser authentication
- When testing local BFF mode, point `VITE_API_URL` to the local BFF server, for example `http://localhost:3001`
