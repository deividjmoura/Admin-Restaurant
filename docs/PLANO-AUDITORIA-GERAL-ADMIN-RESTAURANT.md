# Plano de auditoria geral — Admin-Restaurant

Leia este documento inteiro antes de iniciar. A base de desenvolvimento é `deividjmoura/Admin-Restaurant`; a referência funcional é `deividjmoura/lanchonete-qr-semi-final`.

## Limites obrigatórios
- Trabalhe somente em Admin-Restaurant.
- NÃO altere o repositório lanchonete-qr-semi-final sob hipótese alguma. Use-o somente para consultar comportamento e requisitos funcionais.
- Analise a branch `main` atual. Registre SHA, data e hora antes de começar; não use snapshots antigos como baseline.
- Esta primeira etapa é somente auditoria e documentação. Não altere código funcional, migrations, configurações operacionais; não faça deploy, merge de PR nem feche issues.
- Não revele segredos. Não execute operações destrutivas nem testes contra produção.
- Não invente evidências nem resultados. Registre limitações de acesso e o que não foi possível confirmar.

## Documentos de referência
Leia `docs/DECISAO-ARQUITETURA-PORTABILIDADE-HOSPEDAGEM.md` e `docs/AUDITORIA-FUNCIONAL-QR-ADMIN-SEMI-FINAL.md`. Descubra os caminhos reais dos demais documentos de arquitetura, segurança, decisões, agentes, execução local, manifests, migrations e workflows. Não presuma que arquivos estejam na raiz.

## Objetivo
Auditar o estado real do Admin-Restaurant, compará-lo com o inventário funcional do semi-final e entregar diagnóstico baseado em código, rotas, serviços, componentes, migrations, testes, workflows e execução reproduzível. Distinguir implementado e evidenciado, implementado com validação incompleta, parcial, ausente, diferença intencional e inconclusivo. Um arquivo, mock, TODO ou teste isolado não prova que um fluxo ponta a ponta está entregue.

## Auditoria funcional
Inspecione e compare: cliente/cardápio/QR; categorias, pesquisa, produtos, imagens, preços, adicionais e ingredientes; carrinho, pedidos, comandas, acompanhamento, cancelamentos e idempotência; cozinha e bar, filas por setor, estados por item, produção progressiva, histórico e realtime; garçons, mesas, retirada/entrega, transferência, PWA/offline e sincronização; caixa, pagamentos parciais/divididos, descontos, taxas, reautenticação, PIX, comprovantes e fechamento; administração, staff, RBAC, OAuth, estoque, importação de catálogo e dashboard; relatórios, timezone, exportação, CRM, consentimento, anonimização; SaaS, onboarding, planos, limites, billing e webhooks. Registre separadamente funcionalidades futuras/fora de escopo, sem tratá-las automaticamente como defeitos.

Para cada requisito, mantenha ID, área, descrição, status no semi-final, status no Admin-Restaurant, evidência (caminho/símbolo/teste), lacuna, impacto, dependências, teste e prioridade. Preserve IDs do inventário existente quando aplicável.

## Isolamento multi-tenant — prioridade máxima
Faça auditoria dedicada. Verifique resolução de tenant por host/domínio/headers e confiança da origem; autenticação, sessões, cookies, tokens, revogação, vínculo usuário-loja; RBAC em cada rota/serviço; consultas SQL, joins, agregações, relatórios e operações em lote; FKs, índices, constraints e migrations; IDOR e IDs previsíveis; cache e invalidação; filas, jobs, retries e dead letters; SSE, tickets, canais e reconexão; uploads, storage e URLs assinadas; webhooks, callbacks, logs, auditoria, métricas e exports; concorrência, transações, locks e idempotência; painel da plataforma e operações cross-tenant.

Procure consultas sem filtro de tenant, filtros apenas no frontend, tenant derivado de entrada não confiável, relações entre lojas, checagem de tenant fora da operação final, chaves globais de cache/eventos, jobs sem contexto de tenant e endpoints administrativos excessivamente permissivos. Descreva cenários negativos reproduzíveis de acesso cruzado entre duas lojas. Não altere código/schema nesta etapa.

## Segurança e integridade
Inspecione senhas, sessões e revogação; CSRF, CORS, cookies e origem; OAuth/state/PKCE/callbacks; rate limiting; validação de entrada, SQL injection, XSS, SSRF, uploads e traversal; headers/CSP/proxy confiável; secrets e logs; assinatura/replay/idempotência de webhooks; trilha de auditoria financeira; dependências vulneráveis; privacidade, consentimento, retenção e anonimização. Diferencie vulnerabilidade confirmada, risco potencial e recomendação. Para cada achado registre evidência, impacto, gravidade, pré-condições e mitigação.

## Vercel existente
O projeto possui `frontend/vercel.json`. Preserve essa configuração e não a remova/substitua sem necessidade comprovada e autorização posterior. A existência do arquivo não prova deploy ativo.
Se houver acesso, verifique projeto, domínio, branch, último deploy, status, root directory, build/output, rewrites e variáveis (sem expor valores). Identifique exatamente quais componentes estão no Vercel. Confirme se é somente frontend SPA ou se há API/funções.
Avalie compatibilidade do frontend, backend Fastify, SSE/conexões persistentes, workers/tarefas em segundo plano e PostgreSQL. Verifique CORS, cookies, OAuth callbacks, proxy, URLs públicas, limites de runtime e conexões. Considere frontend no Vercel com backend em outro provedor. Se não houver acesso à conta, declare a limitação e faça análise estática; não afirme que o deploy funciona sem evidência. Não introduza dependência obrigatória do Vercel.

## Desenvolvimento local e portabilidade
Siga `docs/DECISAO-ARQUITETURA-PORTABILIDADE-HOSPEDAGEM.md`: local-first, independente de Railway/AWS/Vercel e sem domínio público obrigatório. Avalie Node/package manager, instalação limpa, `.env.example`, PostgreSQL, migrations, seed, frontend/API, hostnames `admin.localhost`, `loja1.localhost`, `loja2.localhost`, cookies, CORS, OAuth, Redis/cache, filas/workers, arquivos, e-mail, realtime, testes e health checks.
Inventarie acoplamentos de provedor em URLs, SDKs, variáveis, storage, filas, cron, logs, secrets, deploy e banco. Classifique como configuração portável, adaptador isolado, acoplamento espalhado, dependência operacional sem alternativa local ou não aplicável. Explique limitações de fallback em memória entre processos/reinícios/réplicas. Não crie abstrações prematuras.

## Infraestrutura e confiabilidade
Inspecione PostgreSQL, migrations, constraints, índices, pool, cache/pub-sub, filas, retry/backoff/dead-letter, SSE horizontal, persistência de uploads, jobs duplicados, graceful shutdown, health/readiness, logs/métricas/tracing/alertas, backups/restore e separação de ambientes.

## Testes
Descubra os scripts reais e execute o que for seguro: lint/typecheck, unitários, integração, isolamento, security guards, build frontend/backend, migrations em banco local de teste. Registre comando exato, versões, números de pass/fail/skipped, duração, erros sem segredos e limitações. Não use produção nem rode migrations destrutivas. Não corrija falhas nesta etapa.

## Issues e PRs
Faça inventário das issues e PRs abertas no Admin-Restaurant. Compare cada issue com a `main` atual, código, testes, commits e PRs relacionados. Classifique entregue, parcial, pendente, duplicada, obsoleta ou inconclusiva; cite evidência e recomendação. Para PRs, verifique base/head, diff, conflitos, checks, reviews, conteúdo já incorporado, placeholders e testes removidos/enfraquecidos. Checks verdes não bastam para aprovar merge. NÃO feche issues, NÃO faça merge e NÃO altere metadados nesta etapa.

## Priorização
P0: vazamento entre tenants, acesso indevido, corrupção/perda financeira ou indisponibilidade grave. P1: bloqueador de produção, segurança, integridade, backup/restore ou deploy não reproduzível. P2: lacunas funcionais e confiabilidade. P3: UX, otimização e melhorias. Cada tarefa deve incluir evidência, impacto, escopo, dependências, critério de aceite, testes e risco de regressão. Agrupe frentes paralelizáveis sem permitir edição concorrente dos mesmos arquivos/migrations.

## Entregáveis
Antes de criar, confira se os arquivos existem e atualize-os sem apagar conteúdo útil. Crie/atualize somente documentação no Admin-Restaurant:
- `docs/AUDITORIA-GERAL-ADMIN-RESTAURANT.md`: resumo executivo, escopo, SHAs, método e conclusões.
- `docs/MATRIZ-FUNCIONAL-ADMIN-RESTAURANT.md`: matriz funcional detalhada.
- `docs/AUDITORIA-MULTI-TENANT-SEGURANCA.md`: ameaças, evidências e cenários.
- `docs/AUDITORIA-PORTABILIDADE-HOSPEDAGEM.md`: local, Vercel, backend, Railway/AWS e dependências.
- `docs/PLANO-EXECUCAO-POS-AUDITORIA.md`: backlog P0-P3, dependências e critérios de aceite.

## Critérios de conclusão
Registre SHAs dos dois repositórios; inventarie docs e código; compare funcionalidades; inspecione multi-tenant e segurança; avalie Vercel e portabilidade local; execute testes ou declare bloqueios; faça triagem de issues/PRs sem alterá-las; documente achados com evidência e plano priorizado; revise os documentos gerados; confirme que o semi-final permaneceu intocado e que não houve mudança funcional, merge, deploy ou fechamento de issue.

## Relatório final
Entregue: SHA da main e data; maturidade geral; implementado/parcial/ausente; achados P0/P1; estado real do Vercel e limites de verificação; o que funciona localmente e dependências externas; resultados dos testes com números/comandos; contagem e classificação de issues/PRs; links dos documentos; plano de execução ordenado.

**Regra final:** primeiro evidência e diagnóstico. Só depois de apresentar a auditoria e receber autorização explícita, iniciar correções, merges, deploys ou fechamento de issues. O repositório `lanchonete-qr-semi-final` permanece intocado.