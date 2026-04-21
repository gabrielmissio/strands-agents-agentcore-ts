# poc-strands-agents-ts

## Troubleshooting

### 1. Docker ARM64 build fails with `exec format error`

If `cdk deploy` fails while publishing the `poc-strands-agents-agent` asset and the Docker build stops at `RUN npm install` with `/bin/sh: exec format error`, the host Docker engine is not ready to run the `linux/arm64` image build configured for the agent runtime.

Typical failure summary:

```text
poc-strands-agents-agent: fail: docker build --platform linux/arm64 ...
#8 [4/5] RUN npm install
#8 0.140 exec /bin/sh: exec format error
ERROR: failed to build: process "/bin/sh -c npm install" did not complete successfully
```

Fix it in a separate terminal so your current deploy logs stay visible:

```bash
cd infra
npm run docker:setup-arm64
```

Then retry the deploy command.
