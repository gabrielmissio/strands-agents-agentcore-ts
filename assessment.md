# Assessment — strands-agents-agentcore-ts como template/bootstrapper

**Data:** 2026-08-11 (achados) · **atualizado em 2026-08-12** (remediação P0)
**Branch avaliada:** `feat/base-template-v2` (HEAD `165ab0d`)
**Metodologia:** leitura integral do código-fonte dos quatro pacotes (`agent/`, `chatbot-bff/`, `chatbot-frontend/`, `infra/`), dos stacks CDK, de todos os `README.md`, `.env.example` e testes; execução de `npm audit` em cada pacote. Este documento substitui integralmente a versão anterior de `assessment.md` — foi produzido do zero, sem reaproveitar suas conclusões.

Pergunta central: **este repositório serve como template/bootstrapper confiável para (a) demos, (b) novos projetos agênticos internos, e (c) pilotos em produção com dados sensíveis?**

---

## Atualização — 2026-08-12: remediação do P0

Por decisão explícita, os achados **#4** (`EVM_PRIVATE_KEY` sem Secrets Manager) e **#5** (a ferramenta `vanity_address`) ficam **fora de escopo por ora** e não foram alterados. O achado **#6** (`BlockPublicAccess` do bucket S3 comentado) também foi **mantido como está**: o comentário existe porque a SCP do ambiente de deploy atual proíbe a chamada `s3:PutBucketPublicAccessBlock` — é uma necessidade operacional real, não uma omissão, e alterá-lo quebraria a stack nesse ambiente.

Dos demais itens do P0, quatro foram implementados e validados (`npm run verify` — lint + typecheck + test — passa limpo nos quatro pacotes, 142 testes):

| # | Achado | Status | O que mudou |
|---|---|---|---|
| 1 | Container do agente roda como root | ✅ Corrigido | `USER node` adicionado ao estágio runtime de `agent/Dockerfile` |
| 2 | CORS travado em `*` na infra | ✅ Corrigido | `ALLOWED_ORIGIN` agora é uma env var real de `infra/.env`, propagada por `config.ts` → `app.ts` → `BffStack` (Lambdas + CORS preflight da API Gateway). Default permanece `*` (mesma razão de `PUBLIC_SIGNUP_ENABLED`: a URL do CloudFront não existe ainda no primeiro `cdk deploy --all`), mas agora é de fato configurável — testes de regressão em `infra/src/__tests__/stacks.test.ts` |
| 3 | Tokens Cognito em `localStorage`, sem CSP | ⚠️ Mitigado parcialmente | Adicionada uma `ResponseHeadersPolicy` no CloudFront (`frontend-stack.ts`) com CSP (`script-src 'self'`, sem `unsafe-inline`/`unsafe-eval`), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options` e `Referrer-Policy`. Isso fecha o vetor de injeção de script que exploraria o `localStorage`, mas **não move os tokens para fora dele** — isso exigiria tokens brokerados no BFF via cookie `httpOnly`, uma mudança de arquitetura maior, deixada como item de P1/P2 separado, não silenciosamente dada como resolvida |
| 4 | `EVM_PRIVATE_KEY` / `vanity_address` | ⏸️ Fora de escopo (decisão do usuário) | Não alterado |
| 5 | `BlockPublicAccess` do S3 comentado | ⏸️ Mantido como está (decisão do usuário) | Necessário para a stack funcionar sob a SCP do ambiente atual — não é mais tratado como bug neste documento |
| 6 | Dependências fixadas em `"latest"` | ✅ Corrigido | `agent/package.json` e `chatbot-bff/package.json` fixados nas versões hoje resolvidas (`@aws-sdk/client-bedrock-agentcore ^3.1032.0`, `@strands-agents/sdk 1.0.0-rc.4`, `@aws-sdk/client-cognito-identity-provider ^3.1108.0`); lockfiles regenerados, `npm ci` validado |

O restante do documento abaixo é o assessment original; os itens corrigidos permanecem descritos como estavam para preservar o histórico do achado, com uma marcação de status ao lado.

---

## Veredito executivo

| Caso de uso | Prontidão | Justificativa |
|---|---|---|
| **Demo / prova de conceito** | ✅ Pronto | Arquitetura clara, dois padrões de integração bem documentados, deploy de ponta a ponta funcional (`npm run deploy`), guardrails opcionais já pensados (throttle, budget, alarmes). |
| **Novo projeto agêntico interno (não sensível)** | ✅ Pronto | Boa base para copiar/adaptar. Os três gaps mais silenciosos para esse caso de uso — container root, CORS aberto sem alternativa, deps em `latest` — foram corrigidos em 2026-08-12. Ainda sem CI (P1) e sem MFA (P1), mas nenhum dos dois bloqueia esse caso de uso específico. |
| **Piloto em produção com dados sensíveis** | ❌ Ainda não pronto | O README raiz já sinaliza corretamente ("not a production-ready template"). Quatro dos seis itens do P0 foram corrigidos em 2026-08-12 (ver [Atualização](#atualização--2026-08-12-remediação-do-p0)); os dois restantes ficam fora de escopo por decisão deliberada, não por descuido. Os bloqueadores que restam são P1 — ver [Recomendações priorizadas](#recomendações-priorizadas). |

O repositório é **honesto sobre seu próprio estágio** — isso é um ponto forte raro em templates de referência, e a engenharia por trás das partes que *foram* endurecidas (escopo de IAM do `authenticatedRole`, namespacing de sessão por `sub`, dupla função Lambda para separar admin de chat, guardrails de custo) é de qualidade notavelmente acima da média para um "reference repo". O problema não é falta de cuidado — é que o cuidado foi aplicado de forma desigual: partes do sistema (Cognito, IAM do runtime, sessão) receberam tratamento de produção; outras (chave de carteira EVM, container root, CORS, telemetria) ainda estão em modo demo, e nada no runtime as distingue.

---

## Sumário de achados por severidade

| # | Severidade | Achado | Camada | Status |
|---|---|---|---|---|
| 1 | 🔴 Critical | Container do agente roda como root (sem `USER` no Dockerfile) | agent/ | ✅ Corrigido |
| 2 | 🟠 High | CORS travado em `*` na infra, mesmo com suporte a origem restrita no código | infra/ + chatbot-bff/ | ✅ Corrigido |
| 3 | 🟠 High | Tokens Cognito (id/access/refresh) em `localStorage` — Amplify default | chatbot-frontend/ | ⚠️ Mitigado (CSP); armazenamento em si não mudou |
| 4 | 🟠 High | Chave privada de carteira EVM (`EVM_PRIVATE_KEY`) vai em texto puro para env vars do runtime/subprocesso, sem Secrets Manager | agent/ + infra/ | ⏸️ Fora de escopo (decisão do usuário) |
| 5 | 🟠 High | Ferramenta MCP `vanity_address` devolve chave privada real na resposta do modelo | agent/ | ⏸️ Fora de escopo (decisão do usuário) |
| 6 | 🟠 High | Bucket S3 do frontend com `BlockPublicAccess.BLOCK_ALL` comentado por uma SCP específica do autor | infra/ | ⏸️ Mantido como está — necessário para a stack funcionar sob a SCP do ambiente atual |
| 7 | 🟠 High | Dependências AWS/Strands SDK fixadas em `"latest"` em dois pacotes | agent/ + chatbot-bff/ | ✅ Corrigido |
| 8 | 🟠 High | Processos MCP stdio compartilhados são ponto único de falha e gargalo de concorrência | agent/ | P1 |
| 9 | 🟡 Medium | Sem CSP/security headers no CloudFront nem no `index.html` | chatbot-frontend/ + infra/ | ✅ Corrigido |
| 10 | 🟡 Medium | Sem rate limit por usuário/sessão — só throttle global da API Gateway | chatbot-bff/ | P1 |
| 11 | 🟡 Medium | Superfície de prompt injection indireta sem mitigação (JSON externo cru volta ao contexto do modelo) | agent/ | P1 |
| 12 | 🟡 Medium | Servidor HTTP MCP sem autenticação, só allowlist de `Host` | agent/ | P1 |
| 13 | 🟡 Medium | Erro de RPC não tratado pode vazar API key embutida na `EVM_RPC_URL` | agent/ | P1 |
| 14 | 🟡 Medium | Sem VPC/isolamento de rede para o runtime do agente (`networkMode: PUBLIC` fixo) | infra/ | P1 |
| 15 | 🟡 Medium | Sem WAF em API Gateway ou CloudFront | infra/ | P1/P2 |
| 16 | 🟡 Medium | Sem MFA configurado no Cognito (suportado, não habilitado) | infra/ | P1 |
| 17 | 🟡 Medium | Logging não estruturado (`console.log`/`console.error`), sem correlation ID ponta a ponta | agent/ + chatbot-bff/ | P1 |
| 18 | 🟡 Medium | Sem telemetria de erro no frontend — incidentes de cliente são invisíveis para operação | chatbot-frontend/ | P1 |
| 19 | 🟡 Medium | Sem pipeline de CI — `npm run verify` existe mas não é executado automaticamente | repo/ | P1 |
| 20 | 🟡 Medium | Testes ausentes nos pontos de entrada Lambda (`handler.ts`, `admin-handler.ts`) e no núcleo do agente (`agent.ts`, `index.ts`, MCP servers) | chatbot-bff/ + agent/ | P1 |
| 21 | 🟢 Low | `ALLOWED_ORIGIN` documentado como controle de produção, mas ignorado pela infra | chatbot-bff/ | ✅ Corrigido (junto do #2) |
| 22 | 🟢 Low | `VITE_COGNITO_REGION` documentado e nunca lido pelo código | chatbot-frontend/ | P2 |
| 23 | 🟢 Low | Sem concorrência reservada/provisionada nas Lambdas | infra/ | P2 |
| 24 | 🟢 Low | Vulnerabilidade *high* em dependência transitiva de dev (`brace-expansion` via `aws-cdk-lib`) | infra/ | P2 |
| 25 | 🟢 Low | `MAX_BODY_LENGTH` não documentado apesar de README afirmar `.env.example` como fonte da verdade | agent/ | P2 |
| 26 | 🟢 Low | `window.__APP_CONFIG__` lido sem validação de forma | chatbot-frontend/ | P2 |
| 27 | 🟢 Low | Sem code-splitting — `AdminPanel` vai no bundle de todo usuário | chatbot-frontend/ | P2 |

---

## 1. Segurança

### 1.1 Críticos e altos

**[🔴 Critical] Container do agente roda como root. → ✅ Corrigido em 2026-08-12.**
`USER node` adicionado ao estágio runtime de `agent/Dockerfile`, logo após a cópia de `dist/`. Descrição original do achado, mantida como histórico:
`agent/Dockerfile` não declara `USER` em nenhum dos dois estágios; `CMD ["npm", "start"]` (linha 37) executa como root dentro de `node:22-slim`. Em um template pensado para pilotos com dados sensíveis, qualquer RCE numa dependência ou ferramenta (a superfície de tools MCP é grande — HTTP, stdio, x402) herda privilégio de root no container por padrão. É uma correção de poucas linhas (`RUN addgroup … && adduser …` + `USER node`) que deveria estar no template desde o início, não deixada para quem adaptar o repo.

**[🟠 High] CORS hard-coded em `*`, com suporte morto para restringi-lo. → ✅ Corrigido em 2026-08-12.**
`ALLOWED_ORIGIN` agora é uma env var de `infra/.env` (`resolveAllowedOrigin` em `config.ts`, default `*` preservado pela mesma razão de `PUBLIC_SIGNUP_ENABLED`), propagada por `app.ts` até `BffStack` — que agora usa o valor tanto no `environment` das duas Lambdas quanto em `defaultCorsPreflightOptions.allowOrigins`, em vez de hardcodar `'*'` nos dois lugares. Testes de regressão cobrindo o default e um valor configurado em `infra/src/__tests__/stacks.test.ts` (`describe('BffStack — allowedOrigin')`). Descrição original do achado, mantida como histórico:
`infra/src/stacks/bff-stack.ts:50` e `:161` fixam `ALLOWED_ORIGIN: '*'` nas duas Lambdas, sem prop na stack para sobrescrever. O código de `chatbot-bff/src/http.ts` e o `.env.example` sugerem que a origem é configurável — e é, mas só localmente; a infra nunca propaga o valor. Qualquer deploy deste template sai com CORS totalmente aberto, e o README (`chatbot-bff/README.md:38`) documenta a variável como se ela controlasse o comportamento em produção, o que induz a uma falsa sensação de controle.

**[🟠 High] Tokens de sessão Cognito em `localStorage`. → ⚠️ Mitigado parcialmente em 2026-08-12.**
O armazenamento em si **não mudou** — os tokens continuam em `localStorage`, decisão explicitamente fora de escopo desta rodada (mover para cookie `httpOnly` exige tokens brokerados pelo BFF, uma mudança de arquitetura, não um patch). O que foi adicionado é a camada de defesa que faltava: uma `ResponseHeadersPolicy` no CloudFront (`infra/src/stacks/frontend-stack.ts`) com CSP (`script-src 'self'`, sem `unsafe-inline`/`unsafe-eval` para scripts — só `style-src` precisa de `unsafe-inline`, por causa de `style={{...}}` inline do React), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy`. Isso fecha o vetor mais provável de injeção de script que leria o `localStorage`, mas não elimina o risco caso um XSS consiga contornar a CSP (ex.: uma dependência comprometida que já roda como script `'self'`). Teste de regressão em `infra/src/__tests__/stacks.test.ts` (`describe('FrontendStack — security response headers')`). Descrição original do achado, mantida como histórico:
`chatbot-frontend/src/lib/auth.ts:18-27` configura o Amplify sem `cookieStorage` nem `tokenProvider` customizado — o v6 usa `localStorage` por padrão para id/access/refresh token. Qualquer XSS (regressão futura, dependência comprometida) lê `localStorage` de forma síncrona e exfiltra o refresh token, que vale muito mais que uma sessão: é *account takeover* completo, não hijack pontual. Não há `dangerouslySetInnerHTML` hoje (o React escapa a saída do agente corretamente), mas a superfície de defesa está zerada — não há CSP (ver #9) para conter um XSS que venha de outro lugar (uma dependência de terceiro, por exemplo).

**[🟠 High] Chave privada de carteira em texto puro, sem Secrets Manager. → ⏸️ Fora de escopo (decisão explícita do usuário em 2026-08-12).** Não alterado.
`agent/.env.example` já avisa: `EVM_PRIVATE_KEY= # DO NOT PUT YOUR KEY IN THE ENV FILE!`. Mas `infra/src/app.ts:72-79` passa `EVM_PRIVATE_KEY` via `pickDefinedEnvironment` direto para `environmentVariables` do `CfnRuntime` (`infra/src/stacks/agent-stack.ts:190-194`) — ou seja, se alguém *seguir* o padrão de configuração do resto do template (variável de ambiente em `infra/.env`) para essa chave, ela fica em texto puro no template CloudFormation e nas variáveis de ambiente do runtime, legível por qualquer principal com `bedrock-agentcore:GetAgentRuntime`. Dentro do agente, `agent/src/agent.ts:32` repassa `process.env` inteiro (não só a chave) para o subprocesso MCP stdio via `env: process.env as Record<string, string>` — superfície de vazamento ainda maior. O aviso no `.env.example` é a única barreira, e é só um comentário.

**[🟠 High] A ferramenta `vanity_address` devolve uma chave privada real na resposta do modelo. → ⏸️ Fora de escopo (decisão explícita do usuário em 2026-08-12).** Não alterado.
`agent/src/mcp-servers/stdio-mcp-server.ts:99-127` chama `Wallet.createRandom()` e ecoa `wallet.privateKey` (linha 121) no texto de retorno da tool — que vai para o contexto do modelo, para o cliente, e potencialmente para logs. Há um aviso de "demo only" (linha 123), mas o padrão em si — gerar e devolver segredos via saída de LLM — é o tipo de atalho que sobrevive a um copy-paste e aparece em produção sem ninguém decidir conscientemente que deveria.

**[🟠 High] Bucket S3 do frontend sem `BlockPublicAccess` explícito, por causa de uma SCP específica do ambiente do autor. → ⏸️ Mantido como está (decisão explícita do usuário em 2026-08-12): o comentário é necessário para a stack funcionar sob a SCP do ambiente de deploy atual, não é um descuido.** Recomendação original preservada abaixo para quem adotar este template num ambiente sem essa restrição.
`infra/src/stacks/frontend-stack.ts:65-67`:
```ts
// NOTE: Current SCP forbids calls to s3:PutBucketPublicAccessBlock.
// temporarily comment out and leave default configuration behavior (...)
// blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
```
Isso é um workaround para uma restrição de organização do autor, deixado *no template*. Quem adotar este repo numa conta sem essa SCP herda um bucket sem bloqueio explícito de acesso público — o comportamento default do S3 hoje ainda costuma ser privado, mas depender do "comportamento padrão" em vez de uma negação explícita é exatamente o tipo de decisão que documentação nenhuma vai flagar até uma mudança futura (bucket policy, ACL, ou uma alteração de padrão da AWS) abrir o bucket. Isso deveria ser condicional a uma flag (`env var` tipo `S3_BLOCK_PUBLIC_ACCESS_UNSUPPORTED`), não um comentário permanente.

**[🟠 High] Duas dependências fixadas em `"latest"`. → ✅ Corrigido em 2026-08-12.**
Fixadas nas versões hoje resolvidas: `@aws-sdk/client-bedrock-agentcore` → `^3.1032.0` (nos dois pacotes), `@strands-agents/sdk` → `1.0.0-rc.4` (pin exato, não `^`, porque é pré-release — `^1.0.0-rc.4` só casaria com essa mesma versão de qualquer forma, segundo as regras de semver para pre-release), `@aws-sdk/client-cognito-identity-provider` → `^3.1108.0`. Lockfiles regenerados com `npm install` (só o range declarado mudou, a versão instalada é a mesma de antes) e `npm ci --dry-run` validado nos dois pacotes. Descrição original do achado, mantida como histórico:
`agent/package.json` (`@aws-sdk/client-bedrock-agentcore`, `@strands-agents/sdk`) e `chatbot-bff/package.json` (`@aws-sdk/client-bedrock-agentcore`, `@aws-sdk/client-cognito-identity-provider`) usam `"latest"` em vez de um range semver. O lockfile fixa a versão *hoje*, mas qualquer `npm run install:all` (o próprio script de bootstrap do repo) ou regeneração de lockfile — rotina ao clonar o template para um novo projeto — pode puxar uma versão nova sem aviso. Para um SDK que fala com IAM/Bedrock, isso é risco de supply chain e de reprodutibilidade, não só de "quebrar o build".

**[🟠 High] Processos MCP stdio compartilhados são ponto único de falha.**
`agent/src/agent.ts:14-19,28-34` cria `cryptoToolsMcp` e `oraculoDoBichoMcp` uma vez, em escopo de módulo, reaproveitados por todas as invocações do container. Não há supervisão nem restart automático — se um processo cair, toda sessão subsequente naquele container perde aquela ferramenta até o AgentCore reciclar a instância. Agravado pelo fato de que `vanity_address` roda até 1.000.000 iterações síncronas de `Wallet.createRandom()` (`stdio-mcp-server.ts:98-129`) no mesmo processo compartilhado — uma requisição longa trava as demais.

### 1.2 Médios

- **Prompt injection indireta sem mitigação.** `http-mcp-server.ts` e `x402-mcp-server.ts` devolvem JSON bruto de APIs externas (CoinGecko, backend x402) direto como conteúdo de tool-result, que volta para o contexto do modelo sem sanitização ou allowlist de campos. O system prompt (`agent.ts:60`, "speak like a caveman") não tem nenhuma instrução defensiva contra instruções injetadas via resposta de API comprometida.
- **Servidor HTTP MCP sem autenticação.** `http-mcp-server.ts:191-219` só valida o header `Host` contra `HTTP_MCP_ALLOWED_HOSTS`; qualquer chamador na rede aceita em `POST /mcp`. Baixo impacto na ferramenta de preço de cripto atual, mas é o padrão que será copiado para a próxima ferramenta MCP interna.
- **Vazamento de segredo via erro de RPC não tratado.** `agent/src/tools/evm-balance.ts:14` chama `getBalance` sem `try/catch` nem validação de endereço; erros do `ethers`/JSON-RPC costumam embutir a URL da requisição — e `EVM_RPC_URL` do `.env.example` é um endpoint Infura com API key na URL. Um erro de rede vaza a key no texto de erro devolvido ao modelo/usuário.
- **Sem isolamento de rede para o runtime do agente.** `agent-stack.ts:186-188` fixa `networkMode: 'PUBLIC'`, sem opção de VPC. Para um piloto com dados sensíveis que exija rede privada (requisito comum em compliance), isso é um teto arquitetural do template, não um parâmetro.
- **Sem WAF** em API Gateway ou CloudFront — nenhuma proteção contra abuso de camada 7 além do throttle de RPS da stage.
- **Sem MFA no Cognito.** `auth-stack.ts` não configura `mfa`/`mfaSecondFactor`; suportado pelo Cognito, não ligado. Política de senha também é mínima (8 caracteres, sem símbolo obrigatório) — aceitável para demo, insuficiente para dados sensíveis.
- **Logging não estruturado, sem correlation ID.** `agent/src/index.ts`, os três MCP servers e `chatbot-bff/src/handler.ts`/`local.ts` usam `console.log`/`console.error` com texto livre. Não existe um ID de requisição gerado e propagado do BFF até o agente e seus subprocessos MCP — depurar uma conversa específica de um usuário exige correlacionar timestamps manualmente entre CloudWatch log groups distintos. As permissões de X-Ray concedidas ao runtime (`agent-stack.ts:112-122`, `xray:PutTraceSegments` etc.) não têm nenhuma instrumentação correspondente no código do agente — não foi encontrada nenhuma chamada a X-Ray/OpenTelemetry em `agent/src`, então essas permissões hoje não têm efeito prático a menos que o runtime gerenciado do AgentCore instrumente automaticamente (não verificável a partir do código deste repo).
- **Sem telemetria de erro no frontend.** Nenhuma integração tipo Sentry; erros do cliente só aparecem transitoriamente na UI e desaparecem — em produção, uma falha recorrente do lado do browser é invisível para quem opera o sistema.

### 1.3 Pontos fortes de segurança (vale registrar, não só os problemas)

- **Escopo de IAM do `authenticatedRole` corrigido corretamente.** `auth-stack.ts:245-251` documenta explicitamente uma regressão anterior (a role chegou a carregar `bedrock-agentcore:InvokeAgentRuntime` em `*`, permitindo que qualquer usuário logado invocasse *qualquer* runtime da conta) e a correção — permissão concedida só pelo `agent-stack.ts`, escopada ao ARN do runtime específico — é o padrão certo, e há teste de assertions (`infra/src/__tests__/stacks.test.ts`) travando essa propriedade especificamente para não regredir de novo.
- **Sessões namespaced por `sub` do Cognito.** `chatbot-bff/src/session.ts:32-48` — um session id só é reaproveitado se pertencer ao chamador autenticado; caso contrário um novo é emitido silenciosamente. Fecha o vetor de session hijacking entre usuários.
- **Autorização de admin corretamente feita a partir de claims validadas pelo API Gateway**, nunca de um header decodificado manualmente (`admin.ts:89-94`), com auditoria estruturada de toda chamada admin — permitida, negada ou com erro (`admin.ts:203-242`).
- **Separação de função Lambda para admin vs. chat**, para que a função que retransmite saída do modelo nunca carregue `cognito-idp:AdminCreate*`.
- **Nenhum segredo hardcoded** encontrado em nenhum dos quatro pacotes; credenciais AWS vêm de IAM role, não de chaves estáticas.
- **Nenhum XSS de saída do LLM** — a saída do agente é renderizada como children JSX (React escapa automaticamente), sem `dangerouslySetInnerHTML` em lugar nenhum do frontend.

---

## 2. Escalabilidade

| Achado | Severidade | Nota |
|---|---|---|
| MCP stdio compartilhado sem supervisão/restart | Alta (já contada acima) | Ver 1.1 |
| Sem timeout por requisição no agente | Média | `agent/src/index.ts:37-45` faz stream sem wrapper de timeout; uma tool ou chamada de modelo travada segura a resposta HTTP indefinidamente. |
| Sem concorrência reservada/provisionada nas Lambdas | Baixa | Nada em `bff-stack.ts` configura `reservedConcurrentExecutions`; aceitável numa demo, mas numa conta compartilhada a Lambda de chat pode roubar concorrência de outras funções sem aviso. |
| Streaming de resposta bem implementado | Positivo | `handler.ts` usa `awslambda.streamifyResponse` corretamente pareado com `ResponseTransferMode.STREAM` na integração do API Gateway (`bff-stack.ts:131`); timeouts bem calibrados (60s para chat que streama, 29s para admin, alinhado ao teto de 29s do API Gateway REST buffered). |
| Clientes AWS SDK reaproveitados entre invocações | Positivo | `BedrockAgentCoreClient` e `CognitoIdentityProviderClient` instanciados em escopo de módulo — padrão correto para evitar overhead de reconexão em cada cold start. |
| Design "um `Agent` por request, `BedrockModel` compartilhado" | Positivo | `agent.ts:36-64` evita vazamento de estado de conversa entre requisições concorrentes, sem pagar o custo de recriar o client Bedrock a cada chamada — trade-off correto e documentado. |
| Rate limiting só a nível de conta, não por usuário | Média (já contada) | Ver seção de segurança — o único freio é o throttle global da stage; sem quota por `sub`. |

No geral, a arquitetura serverless (Lambda + AgentCore Runtime gerenciado + CloudFront/S3) escala horizontalmente por padrão — não há estado de servidor a gerenciar. O gargalo real de escalabilidade é o *design de tooling* do agente (processos MCP stdio compartilhados e sem timeout), não a infraestrutura em si.

---

## 3. Monitoramento & Logs da aplicação

**O que existe:**
- Alarmes CloudWatch para erros da Lambda de chat, Lambda de admin e 5XX da API Gateway (`bff-stack.ts:212-236`), com tópico SNS opcional por e-mail.
- Orçamento AWS Budget opcional (80%/100%) — alerta, não bloqueia gasto.
- Access logs da API Gateway sempre ativos, deliberadamente só com identidade e resultado (`requestId`, `status`, `latencyMs`, `sourceIp`, `actorSub`) — **nunca** o corpo da requisição (`dataTraceEnabled` desligado de propósito, comentário explícito em `bff-stack.ts:73-75`). Essa é uma decisão de design correta e rara de ver documentada tão claramente.
- Log de auditoria estruturado (JSON) para toda ação administrativa, com ator/ação/resultado (`admin.ts`).

**O que falta:**
- **Nenhum correlation ID** atravessando frontend → BFF → AgentCore → MCP subprocess. A única correlação disponível é o `requestId` do API Gateway, que não é ecoado ao cliente nem anexado à chamada ao AgentCore.
- **Nenhuma instrumentação de tracing** (X-Ray, OpenTelemetry) no código, apesar da IAM policy do runtime do agente já conceder permissões de X-Ray — permissão concedida, capacidade não usada.
- **Logging não estruturado no agente e no BFF** (`console.log`/`console.error` com texto livre) — dificulta parsing/alerta automatizado em CloudWatch Logs Insights.
- **Nenhuma telemetria de erro no frontend** — sem Sentry ou equivalente, incidentes do lado do cliente não geram nenhum sinal para operação.
- **Erros brutos passados para `console.error`** no BFF (`handler.ts:109`, `local.ts:111`) sem uma auditoria explícita de que payload de prompt nunca vaza para dentro do objeto de erro — funciona hoje porque os SDKs da AWS não embutem o corpo da requisição em suas exceções, mas não há teste que trave essa garantia, e é um regression path fácil.

Resumo: a telemetria de **infraestrutura** (alarmes, orçamento, access log de borda) é sólida. A telemetria de **aplicação** (rastreamento de requisição ponta a ponta, logs estruturados, erro de cliente) é o elo fraco — hoje, investigar "por que a conversa do usuário X falhou às 14:32" exige garimpar múltiplos log groups sem um ID comum.

---

## 4. Boas práticas, qualidade de código e testes

**Pontos fortes:**
- TypeScript `strict: true` herdado de `tsconfig.base.json` em todos os quatro pacotes.
- ESLint com `typescript-eslint/strict` no repo inteiro.
- Separação clara de lógica pura vs. glue code (ex: `chatbot-bff` separa `admin.ts`/`http.ts`/`session.ts` puros de `handler.ts`/`admin-handler.ts` como adaptadores Lambda).
- Testes com Vitest em todos os pacotes, sem dependência de credenciais AWS/Docker/browser para rodar — `npm test` funciona isolado.
- Comentários no código, quando existem, explicam o *porquê* de decisões não óbvias (ex: por que `authenticatedRole` não recebe policy na própria stack, por que duas `BucketDeployment` separadas, por que o atributo se chama `inviteLocale` e não `locale`) — nível de documentação de decisão de arquitetura acima da média.
- `npm audit` limpo (0 vulnerabilidades) em `agent/`, `chatbot-bff/` e `chatbot-frontend/`.

**Gaps:**
- **Sem pipeline de CI.** Não há `.github/workflows` nem qualquer outro CI configurado. `npm run verify` (lint + typecheck + test) existe como script, mas nada o executa automaticamente em PR — depende inteiramente de disciplina manual de quem contribui. Para um template que se propõe a acelerar entrega de vários projetos, isso é uma lacuna estrutural: cada fork herda a ausência de CI, não só o código.
- **Testes concentrados na lógica mais fácil de isolar, não na superfície de maior risco:**
  - Em `chatbot-bff`, `handler.ts` e `admin-handler.ts` — os pontos de entrada Lambda reais, onde a checagem de claims/autorização de fato acontece — não têm teste direto. As funções puras que eles chamam (`isAdminClaims`, `resolveSessionId`) são bem testadas isoladamente, mas nada garante que o handler continua *chamando* essas funções corretamente após um refactor futuro.
  - Em `agent/`, não há teste para `agent.ts` (wiring de tools/MCP), `index.ts` (a superfície HTTP real, streaming, tratamento de erro) nem para nenhum dos três MCP servers — exatamente as partes com mais interação externa e mais tratamento de erro.
- **Vulnerabilidade *high* em dependência transitiva de dev em `infra/`** (`brace-expansion` via `aws-cdk-lib`, DoS). Baixo impacto real (é dependência de build da CLI do CDK, não vai para runtime), mas confirma que ninguém roda `npm audit` como parte de um processo automatizado — de novo, sintoma da ausência de CI.
- **Sem `LICENSE`, `SECURITY.md` ou `CODEOWNERS`** no repositório — para um template que se pretende reutilizável por outros times, a ausência de um `SECURITY.md` (como reportar uma vulnerabilidade encontrada no template) é uma lacuna simples de fechar.

---

## 5. Coerência da documentação

A documentação deste repositório é, em geral, **incomumente honesta e detalhada** para um projeto de referência — o root README já avisa "not a production-ready template" e cada README de pacote documenta variáveis de ambiente, decisões de arquitetura e até o motivo de escolhas não óbvias (ex: por que os e-mails do Cognito caem em spam, e como corrigir com SES). Isso é raro e deveria ser preservado. As inconsistências encontradas são pontuais, não estruturais:

| Documento | Inconsistência | Severidade |
|---|---|---|
| `chatbot-bff/README.md:38` | Documenta `ALLOWED_ORIGIN` como se controlasse CORS em produção; a infra hard-coda `'*'` e ignora a variável nesse caminho. | Baixa |
| `chatbot-frontend/.env.example:15` + `README.md:68` | Lista `VITE_COGNITO_REGION` como variável obrigatória; nunca é lida em nenhum lugar do código-fonte (a variável realmente usada é `VITE_AWS_REGION`). | Baixa |
| `agent/README.md` | Não documenta `MAX_BODY_LENGTH` (`agent/src/limits.ts:11`), apesar de o README afirmar que `.env.example` é "a fonte da verdade" para variáveis de ambiente. | Baixa |
| `agent/README.md:85-89` | O exemplo de `docker run` só passa `EXCHANGE_RATE_MCP_URL`, mas `evmBalanceTool` e `oraculoDoBichoMcp` são incluídos incondicionalmente em todo agente (`agent.ts:62`) e dependem de `EVM_RPC_URL`/`EVM_PRIVATE_KEY`/`X402_APP_URL` — o comportamento quando essas variáveis faltam não é documentado. | Baixa |
| `infra/README.md` | Não menciona a lacuna de segurança do `EVM_PRIVATE_KEY` (achado #4) nem o comentário sobre `BlockPublicAccess` desabilitado (achado #6) — ambos são decisões/riscos que um operador que só lê o README nunca veria. | Média (é uma omissão que esconde risco, não um erro factual) |
| Root `README.md` — seção "Testing" | Verificado linha a linha contra os arquivos de teste reais dos quatro pacotes: **as alegações batem** com o código (inclusive a lista específica de o que `agent/`, `chatbot-bff/`, `infra/` e `chatbot-frontend/` cobrem, e o que deliberadamente não cobrem). Nenhuma divergência encontrada aqui. | — |
| `infra/README.md` | Descrição de guardrails, emails, grupos de admin e modo de auth batem com o código correspondente em `config.ts`/`auth-stack.ts`/`bff-stack.ts`. | — |
| `chatbot-frontend/README.md` | Descrição de i18n, autorização de admin (client-side é cosmético, BFF revalida) e modo de sign-up batem com o código. | — |

Conclusão sobre documentação: coerente na maior parte, com gaps pequenos e fáceis de corrigir. O gap mais importante identificado na leitura original não era uma frase errada — era a **ausência** de qualquer aviso, no README de infra ou no root, sobre o tratamento inseguro do `EVM_PRIVATE_KEY` e sobre o CORS aberto por padrão. Do lado do CORS isso já mudou: `infra/README.md` e `chatbot-bff/README.md` agora documentam explicitamente que `ALLOWED_ORIGIN` é configurável e o que acontece quando não é definido (ver [Atualização](#atualização--2026-08-12-remediação-do-p0)). O `EVM_PRIVATE_KEY` continua sem aviso equivalente em `infra/README.md` — permanece um item pendente, fora de escopo por ora.

---

## Recomendações priorizadas

### P0 — bloqueadores para qualquer piloto com dados sensíveis

1. ~~Adicionar `USER` não-root ao `agent/Dockerfile`.~~ **✅ Feito em 2026-08-12.**
2. ~~Tornar `ALLOWED_ORIGIN` de fato configurável na infra (prop de stack + env var).~~ **✅ Feito em 2026-08-12.** Default segue `'*'` por necessidade (URL do CloudFront não existe no primeiro deploy) — quem for a produção precisa setar `ALLOWED_ORIGIN` explicitamente após o primeiro deploy, isso não é automático.
3. Mover tokens do Cognito para armazenamento em memória ou cookie `httpOnly`/`secure` no frontend. **⚠️ Parcial:** a `ResponseHeadersPolicy` de CSP/HSTS no CloudFront foi adicionada em 2026-08-12 como camada de defesa; a migração do armazenamento em si (que exige tokens brokerados pelo BFF) continua pendente e é maior que um item de P0 — rebaixado para P1, ver item 9 abaixo.
4. Tratar `EVM_PRIVATE_KEY` via Secrets Manager, e remover ou isolar a tool `vanity_address`. **⏸️ Fora de escopo por decisão explícita do usuário (2026-08-12)** — não reavaliar automaticamente em rodadas futuras sem pedido explícito.
5. ~~Substituir o comentário de `BlockPublicAccess` por uma flag explícita.~~ **⏸️ Não fazer — decisão explícita do usuário (2026-08-12):** o comentário existe porque a SCP do ambiente de deploy atual proíbe `s3:PutBucketPublicAccessBlock`; é um requisito operacional, não uma pendência.
6. ~~Fixar `agent/package.json` e `chatbot-bff/package.json` em versões semver reais.~~ **✅ Feito em 2026-08-12.**

### P1 — antes de adoção mais ampla por outros times
7. Configurar CI (lint + typecheck + test + `npm audit` em PR) — o script `verify` já existe, falta só o gatilho.
8. Adicionar rate limit por usuário/sessão no BFF (não só o throttle global de API Gateway).
9. Decidir e implementar o design de armazenamento de tokens do Cognito fora de `localStorage` (ex.: cookie `httpOnly` brokerado pelo BFF) — a CSP adicionada em P0 mitiga, não substitui essa mudança.
10. Instrumentar correlation ID ponta a ponta (frontend → BFF → agente → MCP), e decidir conscientemente se X-Ray/OpenTelemetry entra ou se as permissões de X-Ray já concedidas devem ser removidas.
11. Cobrir com teste os pontos de entrada reais (`handler.ts`, `admin-handler.ts`, `agent.ts`, `index.ts`) — hoje o teste está concentrado na lógica pura ao redor deles, não neles.
12. Adicionar telemetria de erro no frontend (Sentry ou equivalente).
13. Habilitar MFA opcional no Cognito e revisar a política de senha para um contexto de dados sensíveis.

### P2 — robustez geral
14. Adicionar timeout por requisição no agente e supervisão/restart para os processos MCP stdio compartilhados.
15. WAF básico em API Gateway/CloudFront se o piloto for exposto publicamente.
16. `SECURITY.md` e `LICENSE` no repositório.
17. Corrigir as divergências pontuais de documentação restantes listadas na seção 5 (`VITE_COGNITO_REGION`, `MAX_BODY_LENGTH`).

---

## Conclusão

Como **template de referência para aprender e prototipar** os dois padrões de integração com Bedrock AgentCore, este repositório cumpre muito bem o que promete: a separação entre modo direto e modo BFF é didática, a infraestrutura sobe de ponta a ponta com um comando, e várias decisões de segurança (escopo de IAM, namespacing de sessão, separação de função admin/chat, guardrails de custo) foram claramente pensadas por alguém que já foi mordido por essas classes de bug antes — os comentários no código *documentam regressões passadas e por que a correção atual existe*, o que é um sinal de maturidade de engenharia real.

Como **bootstrapper para um piloto em produção com dados sensíveis**, ainda não está pronto — mas a distância diminuiu nesta rodada. Dos seis riscos originalmente mais silenciosos (os que ficariam copiados sem ninguém perceber, justamente por estarem cercados de código tão bem cuidado), quatro já não existem mais: container root, CORS aberto sem alternativa, e dependências em `latest` foram corrigidos; o risco de XSS sobre os tokens em `localStorage` ganhou uma camada de defesa real (CSP) mesmo sem o armazenamento em si ter mudado. Os dois que restam — segredo de carteira em texto puro e o comentário do `BlockPublicAccess` — ficam de fora por decisão explícita, não por omissão: o primeiro por escopo (feature de demo, não o core do template), o segundo porque é uma necessidade real do ambiente de deploy atual. O que falta agora para um piloto sensível está descrito no P1: armazenamento de token fora do `localStorage`, CI automatizado, rate limit por usuário, e observabilidade de ponta a ponta — nenhum item de superfície tão grande quanto os que já foram fechados.
