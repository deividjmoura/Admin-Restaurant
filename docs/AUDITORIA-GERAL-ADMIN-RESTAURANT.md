# Auditoria geral — Admin-Restaurant

- Data: 07/11/2026
- Estado analisado: branch `main`
- SHA da base analisada: `d79278a92d4007235f72877ed351a21e16f93a28`
- Referência funcional: `lanchonete-qr-semi-final`
- SHA da referência: `47c5d7fd77f601b142ed8a0bb2d519998c5e0d87`
- Escopo desta entrega: inspeção estática de árvores, documentação, manifests, configurações, módulos selecionados, migrations, testes listados, issues, PRs e status de CI.
- Limitação: não foi possível clonar/executar o projeto neste ambiente conectado ao GitHub; portanto nenhum teste local, build, migration ou cenário E2E foi executado nesta auditoria. Não atribuir maturidade M4/M5 sem execução reproduzível.

## 1. Resumo executivo

O Admin-Restaurant é uma aplicação SaaS multi-tenant real em estrutura, não apenas um protótipo de interface: contém backend Fastify, PostgreSQL, módulos de tenancy, auth, permissões, pedidos, mesas, cozinha, caixa, delivery, pagamentos, relatórios, billing, jobs, realtime e uma SPA React separada. A árvore auditada tem 276 entradas, 28 migrations principais (0001–0028), 39 arquivos sob `test/` (incluindo README/helpers) e 151 arquivos sob `src/` + `frontend/src/`.

O semi-final tem uma superfície funcional e operacional mais extensa: árvore com 759 entradas, 40 migrations (0001–0040), 136 arquivos sob `tests/` (incluindo suites e helpers) e aplicações web/PWA mais amplas. Esses números são contagens de arquivos versionados, não métricas diretas de qualidade. A diferença mostra que a paridade funcional não deve ser presumida.

A auditoria funcional preexistente em `docs/AUDITORIA-FUNCIONAL-QR-ADMIN-SEMI-FINAL.md` já documenta um inventário detalhado e classifica várias áreas do Admin como parciais/a confirmar. Esta auditoria confirma a direção geral: a base multi-tenant existe, mas o Admin ainda não demonstra paridade integral com as rotinas operacionais maduras do semi-final.

## 2. Evidências positivas encontradas

- Arquitetura separa frontend e API: `frontend/` (React/Vite) e `src/` (Fastify).
- Multi-tenancy tem módulo dedicado: `src/modules/tenancy/`, com resolução por subdomínio, domínio customizado e fallback de header controlado.
- Banco PostgreSQL usa migrations versionadas em `migrations/`.
- Contextos de entrada e papéis de plataforma/loja/cliente estão documentados em `docs/ARCHITECTURE.md`, `docs/ENTRY-CONTEXTS.md` e `docs/CUSTOMER-SESSIONS.md`.
- Há testes de isolamento cobrindo auth, sessão de cliente, contexto de entrada, host, HTTP, pedidos, caixa, pagamentos, SSE, cache, RBAC, tabelas e resolução de tenant.
- Segurança documenta proteção de webhook, validação de valores, atomicidade, cookies, CORS, sessões e escopo por loja.
- Há módulos para pagamentos PIX/webhook, delivery/provider adapter, CRM/consentimento, billing, relatórios, observabilidade e jobs persistidos.
- A configuração Vercel existente é um rewrite de SPA para `/index.html`; o status Vercel observado na SHA auditada estava success.

## 3. Lacunas e riscos prioritários

### P0 — não declarar isolamento concluído sem auditoria integral

A issue #105 continua aberta e descreve explicitamente lacunas no inventário de queries, cache, eventos/realtime e rotas administrativas. A existência de testes não substitui a inspeção completa. Não foi executada nesta etapa uma suíte negativa cross-tenant completa nem revisão linha a linha de todos os repositories/handlers.

### P1 — CI da main falhando

O workflow `.github/workflows/ci.yml` executado para a SHA auditada terminou com `conclusion=failure` (run 42363761822). O status contextual Vercel estava success, mas isso não equivale à aprovação da suíte GitHub Actions. A API consultada não retornou os jobs/logs desse run; causa exata permanece inconclusiva e precisa ser obtida no GitHub Actions UI/logs ou rerun controlado.

### P1 — PR #159 contém remoção extensa de testes

A única PR aberta encontrada na busca foi #159, para jobs/dead-letter. O diff reporta 216 adições e 882 remoções em 12 arquivos. Em particular, substitui `test/isolation/customer-session.test.js` de 828 linhas por um arquivo de uma linha e remove um caso de `/api/menu` do teste de contexto de entrada. Mesmo que existam ajustes válidos na funcionalidade de jobs, essa perda de cobertura é regressão grave. Não mesclar sem restaurar cobertura equivalente e revisar o restante do diff. A PR está aberta, não mesclada, e a issue #138 continua aberta.

### P1 — Redis não é dependência instalada no manifest

`src/infrastructure/redis.js` tenta importar dinamicamente `redis` ou `ioredis`, mas nenhum dos dois aparece em `dependencies` do `package.json` auditado. Com `REDIS_URL` configurado sem instalar cliente, o código cai em memória. Isso pode ser intencional como fallback local, mas não fornece pub/sub compartilhado entre processos/instâncias. É bloqueio para realtime/cache distribuído se o deploy exigir múltiplas réplicas.

### P2 — paridade operacional incompleta

A matriz existente marca como parcial/a confirmar cozinha/bar, garçom, caixa, dashboard, cardápio administrativo, relatórios, privacidade e offline. Estoque detalhado, importação/reversão CSV e PWA offline não têm evidência suficiente no Admin. O semi-final possui recursos concretos nessas áreas, documentados em README, módulos e migrations.

### P2 — workflow CI com permissões maiores que o mínimo aparente

O workflow declara `contents: write` e `issues: write`. A criação automática de issue na falha explica a permissão de issues, mas não foi identificada necessidade de escrita em contents no fluxo. Avaliar redução para menor privilégio, sem alterar durante esta auditoria.

## 4. Estado de Vercel

Foi confirmado no repositório:
- `frontend/vercel.json` faz rewrite de todas as rotas para `/index.html`.
- O status associado à SHA auditada apresenta contexto `Vercel: success`.

Não foi possível confirmar por esta conexão o domínio ativo, root directory configurado no projeto, variáveis, histórico de deploy, nem se o Vercel está hospedando exclusivamente o frontend. O arquivo e o status não provam por si só toda a topologia. Pela estrutura, Vercel é adequado para a SPA estática; o backend Fastify, SSE persistente e worker contínuo precisam de runtime/processo adequado separado ou adaptação arquitetural. Não remover a configuração atual.

## 5. Issues e PRs

- Busca do GitHub retornou 54 issues abertas no Admin-Restaurant.
- Parte relevante são issues automáticas de falha de CI em commits antigos (#160–#169); devem ser agrupadas por run/causa e não tratadas como 10 bugs independentes sem comparação com main.
- Issues de roadmap ainda abertas incluem #105 (auditoria multi-tenant), #107–#110 (caixa), #114 (estado agregado/produção), #119–#122 (estoque/ficha técnica/ledger/CMV), entre outras.
- Uma PR aberta foi encontrada: #159. Ver análise acima.
- Nenhuma issue foi fechada e nenhuma PR foi mesclada nesta auditoria.

## 6. Maturidade provisória

| Área | Diagnóstico provisório | Maturidade máxima comprovada nesta auditoria |
|---|---|---|
| Fundação SaaS/tenancy | Estrutura e módulos presentes; auditoria integral pendente | M2 |
| Auth/RBAC/sessões | Código e testes dedicados presentes; execução não realizada | M2 |
| Cardápio/cliente/QR | Backend e telas principais presentes; paridade detalhada pendente | M2 |
| Pedidos/mesas/carrinho | Módulos, migrations e testes presentes | M2 |
| Cozinha/bar/realtime | Backend e eventos presentes; equivalência visual/operacional parcial | M2 |
| Garçom/offline/PWA | Paridade não demonstrada; semi-final tem PWA offline mais completa | M1 |
| Caixa/pagamentos | Módulos e migrations presentes; sessão de caixa/ledger e paridade a fechar | M2 |
| Delivery | Módulo próprio e adapter presentes; integrações reais a validar | M1–M2 |
| Estoque/receitas/CMV | Não evidenciado no Admin auditado | M0 |
| Relatórios/dashboard | Base presente, cobertura menor/indeterminada | M1–M2 |
| Jobs/filas | Base persistida existe; melhoria #138 em PR insegura para merge como está | M1–M2 |
| Billing/SaaS | Módulo e migration presentes; fluxo real/provedor a validar | M1–M2 |
| Portabilidade | Configuração por env e PostgreSQL; Redis fallback limitado; execução local não validada | M1 |

M2 aqui significa implementação localizada em código/configuração e testes existentes no repositório, não execução comprovada nesta auditoria. Nenhuma área recebe M3–M5 nesta entrega porque não foi possível executar testes.

## 7. Próximos passos recomendados

1. Resolver a falha atual da CI e agrupar issues automáticas antigas por causa.
2. Bloquear merge da PR #159 até restaurar o teste de sessão de cliente e as verificações removidas.
3. Concluir auditoria P0 de isolamento em repositories, rotas, cache, SSE, jobs, exports e painel de plataforma.
4. Fechar paridade operacional cliente → produção → garçom → caixa com critérios e testes por item.
5. Decidir explicitamente escopo de estoque/importação/offline e criar implementação tenant-aware somente depois.
6. Validar setup local com instalação limpa e PostgreSQL local.
7. Confirmar topologia Vercel (frontend) + backend Fastify em runtime compatível.
8. Executar teste de backup/restore e validação em segundo provedor antes de declarar portabilidade.

## 8. Integridade da referência

O repositório `lanchonete-qr-semi-final` foi somente consultado. Nenhuma escrita, commit, issue, PR, migration ou configuração foi feita nele durante esta auditoria.
