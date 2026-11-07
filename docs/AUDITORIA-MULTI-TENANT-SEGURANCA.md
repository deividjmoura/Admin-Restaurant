# Auditoria multi-tenant e segurança — Admin-Restaurant

- Base analisada: `main` SHA `d79278a92d4007235f72877ed351a21e16f93a28`
- Data: 07/11/2026
- Método: inspeção estática de arquitetura, tenant resolver/plugin, config, security docs, árvore de testes e issues. Não foi executada suíte nem fuzzing nesta entrega.

## 1. Controles positivos encontrados

- `src/modules/tenancy/resolve-tenant.js`: host normalizado; reserved hosts apex/platform não viram loja; prioridade subdomínio, domínio customizado e fallback header condicionado; fallback query exige rota opt-in.
- `src/modules/tenancy/tenant-plugin.js`: injeta store/storeId no request e expõe `requireTenant`; log contextualizado por store.
- `docs/ARCHITECTURE.md`: define contextos marketing/platform/store/customer, JWT por tipo, membership ativa e ausência de bypass SUPER_ADMIN.
- `docs/SECURITY.md`: descreve CSRF/origin, CORS fail-closed, cookies, rate limit, webhooks assinados, transações e validação de totais.
- `test/isolation/`: cobre entry hosts/contexts, customer sessions, HTTP isolation/security, order scoping, repository isolation, SSE tenant, menu cache, RBAC, payments e table session race.
- Migrations de stores/users/roles, permissões, audit, sessões customer, delivery checkout e caixa estão versionadas.

## 2. Achados e riscos

### MT-01 — revisão integral de queries ainda não comprovada (P0 até fechar auditoria)

Issue #105 permanece aberta. O escopo da issue solicita inventário módulo → queries → filtro de tenant e testes cross-tenant para leitura, escrita, cache, eventos e admin. A existência de repositories com storeId e testes parciais não prova que todas as queries e rotas estão cobertas.

**Ação:** inventariar todas as consultas em cada repository/route; checar joins e FKs compostas; testar IDs de loja A contra token/host da loja B. Manter issue aberta até evidência.

### MT-02 — fallback Redis em memória não escala horizontalmente (P1)

`src/infrastructure/redis.js` usa Map local para cache/pub-sub quando Redis não está ativo ou o cliente não pode ser importado. O manifest principal não declara `redis` nem `ioredis`. Isso é aceitável como fallback de desenvolvimento em processo único, mas não compartilha invalidação/eventos entre instâncias e perde estado no restart. Não tratar como equivalente a Redis em produção multi-réplica.

**Ação:** definir dependência opcional/extra documentada e ambiente local reproduzível; exigir Redis compartilhado (ou broker equivalente) quando múltiplas instâncias forem usadas. Adicionar teste multi-instância.

### MT-03 — PR #159 remove teste crítico de sessão de cliente (P0/P1)

O diff da PR substitui `test/isolation/customer-session.test.js` (828 linhas) por um arquivo de uma linha. Também remove do teste `entry-contexts.test.js` a verificação de `/api/menu` para token de plataforma. O PR altera fixtures e cabeçalhos host, mas a remoção do teste inteiro elimina proteção contra abuso de credencial customer, sessão de outra loja, expiração/revogação e ações proibidas. Não mesclar no estado atual.

**Ação:** restaurar a suíte e adaptar somente os fixtures necessários; garantir cobertura equivalente por testes explícitos. Revisar as alterações restantes antes de considerar merge.

### MT-04 — workflow CI usa contents:write (P2)

`.github/workflows/ci.yml` declara `contents: write` e `issues: write`. O job cria issue em falha, o que explica issues:write; contents:write não parece necessário pelo workflow visível.

**Ação:** reduzir permissões ao mínimo após validar todos os passos.

### MT-05 — status da CI da main falhou na SHA auditada (P1)

Run 42363761822 para SHA auditada terminou em failure. A API de jobs/logs retornou lista vazia nesta consulta; causa exata não confirmada. O contexto Vercel foi success. Não confundir sucesso de deploy frontend com CI completa.

**Ação:** abrir o run no GitHub Actions e capturar job/step que falhou; corrigir a causa em PR separada e reexecutar.

## 3. Superfície que precisa de revisão manual linha a linha

| Superfície | Arquivos/áreas | Verificações |
|---|---|---|
| Resolução do tenant | `tenancy/resolve-tenant.js`, `tenant-host.js`, `tenant-plugin.js` | Host spoofing, proxy trust, reserved hosts, fallback por header/origin |
| Autenticação | `auth/*`, `customer/*` | tipo de token, audience/issuer, expiração, revogação e troca de tenant |
| Autorização | todas as rotas com preHandler, `permissions/*` | membership ativa e permissão em toda mutação/leitura |
| Persistência | todos `*.repository.js` | store_id em WHERE/JOIN/UPDATE/DELETE e FKs compostas |
| Carrinho/pedidos | `tables/*`, `orders/*` | lock, idempotência, sessão fechada e replay cross-store |
| Pagamentos | `payments/*`, `cash/*` | valor devido, webhook, estorno, operador e loja derivada do registro |
| Cache | `menu/menu-cache.js`, `infrastructure/redis.js` | prefixo tenant, invalidação e fallback |
| Realtime | `realtime/store-events.js`, `kitchen/*` | canal por loja, autorização de assinatura, reconexão |
| Jobs | `jobs/*` | storeId obrigatório, payload validado, requeue tenant-aware |
| Arquivos | módulos de upload/URLs (se habilitados) | prefixo por tenant, autorização e URL assinada |
| Relatórios/exports | `reports/*`, `crm/*` | filtros tenant/timezone em agregações e exportações |
| Plataforma | `platform/*`, `billing/*` | operações globais explícitas e trilha auditável |

## 4. Cenários negativos mínimos

Executar em banco de teste com duas lojas A e B:
1. Token A + host B: deve retornar 403 sem revelar dados.
2. Token platform em rota de loja: deve negar; nenhum bypass implícito.
3. IDs de pedido, item, mesa, pagamento, sessão ou job de B consultados por A: 404/negado conforme contrato, sem mutação.
4. POST/PUT com `storeId` de B no body usando sessão A: ignorar/rejeitar campo; derivar tenant do contexto autenticado.
5. Cache de cardápio A nunca retornar conteúdo de B; invalidação A não invalidar B.
6. SSE de A não receber eventos de B, inclusive após reconexão e fallback.
7. Job criado em A não pode executar nem requeue um recurso de B.
8. Webhook com loja/pagamento divergente não deve alterar pagamento; assinatura inválida não deve persistir evento.
9. Export/relatório A não deve incluir dados de B por agregação/join.
10. Sessão customer do QR A não pode consultar pedido/pagamento de B nem sobreviver a revogação/fechamento conforme política.
11. Hostnames reserved (apex/platform) não podem ser convertidos em tenant por header/query.
12. Concorrência de checkout/pagamento não pode duplicar efeitos ou ultrapassar saldo devido.

## 5. Veredito

A arquitetura e os controles fundamentais existem e são promissores. Porém, a conclusão de “multi-tenant seguro” ainda não está demonstrada: issue #105 aberta, CI atual falhando e remoção de teste de sessão de cliente em PR aberta impedem fechar a auditoria. Nenhuma vulnerabilidade de cross-tenant foi confirmada nesta inspeção estática, mas também não foi possível declarar ausência delas.
