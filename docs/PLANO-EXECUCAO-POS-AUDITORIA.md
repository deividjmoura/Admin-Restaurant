# Plano de execução após auditoria — Admin-Restaurant

Este plano é derivado da inspeção estática de 07/11/2026. Nenhuma tarefa abaixo foi implementada nesta etapa. Revalidar contra a main antes de iniciar cada frente.

## P0 — segurança e proteção contra regressão

### P0-01 — Preservar testes de sessão customer
- Evidência: PR #159 remove 827 linhas líquidas/828 linhas do arquivo `test/isolation/customer-session.test.js`, deixando o arquivo com uma linha.
- Ação: não mesclar PR #159 como está; restaurar e adaptar os testes para os hosts canônicos sem reduzir cenários.
- Aceite: suite de customer session volta a cobrir origem real do QR, vínculo loja/mesa/sessão, expiração, revogação, replay, tentativa cross-tenant e operações proibidas.
- Testes: customer-session + entry-contexts + http-isolation.

### P0-02 — Completar revisão de isolamento cross-tenant
- Evidência: issue #105 aberta e matriz de testes parcial.
- Ação: inventariar cada repository/route, query, cache, evento, job, relatório e operação de plataforma.
- Aceite: duas lojas A/B; testes negativos para leitura/escrita/exports/SSE/jobs/cache/customer token; FKs/joins confirmados.
- Testes: todas as suítes de isolamento com banco real e fail=0/skipped=0.

## P1 — confiabilidade, CI e runtime

### P1-01 — Diagnosticar falha atual da CI
- Evidência: run 42363761822 (main SHA auditada) com conclusion failure.
- Ação: consultar logs/jobs no GitHub Actions; reproduzir em ambiente local idêntico; corrigir em PR isolada.
- Aceite: backend integration suite e frontend build verdes, sem skipped inesperados; issue automática de falha agrupada/encerrada somente após confirmar que cada run antigo foi superseded.
- Testes: `npm ci`, `npm run db:migrate`, `npm run db:seed`, `npm run test:suite`, `npm ci --prefix frontend`, `npm run build --prefix frontend`.

### P1-02 — Redis/pub-sub multi-instância
- Evidência: import dinâmico de redis/ioredis sem dependência declarada; fallback Map em memória.
- Ação: declarar/instalar cliente como dependência opcional ou adapter documentado; garantir serviço local via compose quando necessário; readiness informa backend ativo.
- Aceite: duas instâncias recebem eventos/invalidações sem vazamento entre tenants; restart não quebra estado compartilhado.
- Testes: integration com broker e teste de fallback single-process.

### P1-03 — Separar ciclo de vida do worker quando escalar
- Evidência: `src/server.js` inicia worker no mesmo processo da API.
- Ação: manter modo simples local; permitir comando/processo worker separado sem duplicar scheduler/claim.
- Aceite: API e worker podem operar isolados com idempotência/locks; graceful shutdown validado.
- Testes: worker integration, retries, lock timeout, duplicate claims.

### P1-04 — Vercel frontend + backend persistente
- Evidência: `frontend/vercel.json` é rewrite SPA; Fastify usa listener persistente e worker.
- Ação: documentar e validar URLs/CORS/cookies/Host/proxy entre SPA Vercel e API, ou proxy same-origin quando aplicável.
- Aceite: deploy frontend mantém navegação SPA e todas as rotas API/SSE apontam para backend correto; OAuth/cookies funcionam.
- Testes: smoke hospedado e reconexão SSE.

### P1-05 — backup e restore
- Evidência: decisão de portabilidade exige backup/restore; não foi executado nesta auditoria.
- Ação: validar runbook e drill em banco isolado.
- Aceite: backup restaurado, migrations compatíveis, contagem/consistência verificadas.

## P2 — paridade funcional do semi-final

### P2-01 — Caixa completo
- Evidência: issues #107–#110 ainda abertas na busca; escopos incluem sessão de operador, ledger, pagamento combinado/estorno e relatório.
- Ação: verificar implementação atual antes de desenvolver; completar somente lacunas.
- Aceite: pagamentos parciais/combinados, estorno rastreável, sessão de caixa, suprimento/sangria, conciliação e export.

### P2-02 — Produção por item
- Evidência: issue #114 aberta para estado agregado/produção parcial; semi-final tem ciclo detalhado por item.
- Ação: comparar estados, cancelamento por item, histórico, fila independente cozinha/bar e aceitação/retirada/entrega.
- Aceite: máquina de estados documentada/testada, pedido parcialmente pronto correto.

### P2-03 — Estoque, receitas e CMV
- Evidência: issues #119–#122 abertas; sem módulo stock/ingredients/recipes na árvore Admin observada.
- Ação: definir modelo tenant-aware, unidades/conversões, ficha técnica versionada, ledger e CMV.
- Aceite: saldo reconstruível, consumo por venda idempotente e relatórios com custo/origem.

### P2-04 — Importação de cardápio e reversão
- Evidência: semi-final possui importação/reversão; não evidenciado na árvore Admin.
- Ação: preview, validação, importação transacional e rollback por loja.
- Aceite: CSV inválido não altera catálogo; import pode ser revertido sem apagar alterações posteriores.

### P2-05 — Dashboard e relatórios
- Evidência: Admin tem dashboard/reports, mas a matriz classifica personalização e relatórios como parciais.
- Ação: inventariar métricas, filtros, timezone, export e personalização.
- Aceite: totais reconciliáveis com pedidos/pagamentos/entregas por tenant.

### P2-06 — Lifecycle de equipe e garçom
- Evidência: semi-final tem PWA, tokens, transferência e autoria; Admin tem RBAC/staff mas paridade precisa ser comprovada.
- Ação: conferir perfis, garçom separado de staff, desligamento, rotação/revogação de tokens e OAuth.
- Aceite: remoção/desativação revoga sessões/tokens e mantém auditoria.

## P3 — evolução

- PWA offline com fila IndexedDB, sync idempotente, conflitos e isolamento por loja.
- Adapters de impressora/gaveta/leitor/balança.
- Integrações externas de delivery e reconciliação de webhooks.
- CRM, promoções, loyalty e multiunidade, conforme prioridade comercial.
- Testes E2E em dispositivos reais e testes de carga de operação.

## Regra de execução

Antes de qualquer implementação, comparar a tarefa com a main atual e issues/PRs. Não criar trabalho duplicado. Não alterar o repositório semi-final. Não fazer merge/fechar issue automaticamente só por checks verdes; revisar diff, testes, escopo e regressões. Desenvolver localmente e manter portabilidade.
