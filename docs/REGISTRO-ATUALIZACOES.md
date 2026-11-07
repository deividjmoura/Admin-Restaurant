# Registro de atualizações do repositório

Este é o registro contínuo das alterações. **Todo agente deve adicionar uma
entrada na mesma entrega após qualquer mudança no repositório**, inclusive
alterações de documentação, testes e configuração. Preserve o histórico, não
registre segredos ou dados pessoais, e diferencie alterações locais de mudanças
publicadas/implantadas. Se nada foi alterado, nenhuma entrada é necessária.

## Modelo para novas entradas

```markdown
## AAAA-MM-DD — Resumo
- Objetivo e escopo:
- Mudanças e caminhos:
- Testes: comando, resultado, contagem, falhas/skips e ambiente:
- Limitações/riscos e compatibilidade:
- Próximos passos:
- Publicação/deploy: não realizado ou link/identificação comprovada.
```

## 2026-11-07 — Auditoria e documentação preliminar

- Objetivo: auditar o Admin-Restaurant e propor uma ordem de execução, sem alterar o repositório de referência.
- Mudanças locais: `docs/AUDITORIA-GERAL-ADMIN-RESTAURANT.md`, `docs/MATRIZ-FUNCIONAL-ADMIN-RESTAURANT.md`, `docs/AUDITORIA-MULTI-TENANT-SEGURANCA.md`, `docs/AUDITORIA-PORTABILIDADE-HOSPEDAGEM.md`, `docs/PLANO-EXECUCAO-POS-AUDITORIA.md`. A main remota avançou posteriormente com documentos próprios de mesmo nome; estas versões locais não foram reconciliadas ou publicadas.
- Evidência: análise da main então em `d79278a92d4007235f72877ed351a21e16f93a28`; repositório de referência retornou 403 neste ambiente. O inventário de 105 IDs foi enumerado, com análise parcial e limitações explícitas.
- Testes então: `npm run test:unit` 25 aprovados; `node --test test/unit/config.test.js` 8 aprovados; `npm run web:build` passou. Sem PostgreSQL nessa etapa, a suíte de isolamento não foi validada.
- Publicação/deploy: não realizados nesta sessão.

## 2026-11-07 — Proteção do webhook de billing

- Objetivo: impedir alteração indevida de assinatura entre lojas e reprocessamento do mesmo evento.
- Mudanças: `src/modules/billing/billing-routes.js`, `billing.repository.js` e `README.md`; `migrations/0030_billing_webhook_events.sql`; `test/isolation/billing-webhook.test.js`. Provider mock explicitamente habilitado e HMAC sobre corpo bruto, referência de assinatura resolvida no servidor, verificação de divergência, evento/alteração transacionais e deduplicação persistente. A migration 0030 evita colidir com 0029 proposta no PR #159.
- Testes: PostgreSQL 18.6 local descartável; `npm run db:migrate` em banco limpo aplicou 29 migrations; segunda execução não encontrou pendências. `node --test test/isolation/billing-webhook.test.js`: 12 aprovados, 0 falhas, 0 skips. `npm run web:build` passou.
- Limitações: contrato anterior de segredo em texto puro não é compatível; provider real continua desabilitado e exige adaptador e validação próprios. Deduplicação de ID idêntico não resolve eventos distintos fora de ordem. Atualização requer migration antes de habilitar webhook.
- Publicação/deploy: não realizados nesta sessão.

## 2026-11-07 — CI local, segurança de logs e registro obrigatório

- Objetivo: reproduzir e corrigir falhas da suíte sem remover testes; documentar continuamente o trabalho dos agentes.
- Mudanças: fixtures de autenticação em `test/helpers/fixtures.js`; hosts e expectativas em `test/isolation/cash-payments.test.js`, `cash-session.test.js`, `entry-contexts.test.js`, `http-security.test.js` e `observability.test.js`; captura real de logs em `customer-session.test.js`. O cardápio permanece público; testes continuam negando acesso de plataforma às rotas protegidas. Testes fail-closed reinicializam cache de configuração antes de cada cenário.
- Segurança: `src/infrastructure/request-context.js` registra padrão da rota, não URL bruta com token QR; `src/infrastructure/logger.js` evita URL bruta no serializer. Teste de sessão verifica log efetivamente capturado e ausência de token.
- Registro: criado `AGENTS.md` e este documento; `docs/AGENTES.md` passou a exigir atualização do registro por todos os agentes após qualquer alteração.
- Testes: PostgreSQL 18.6 local descartável com migrations/seed. Os seis arquivos afetados: `node --test test/isolation/cash-payments.test.js test/isolation/cash-session.test.js test/isolation/customer-session.test.js test/isolation/entry-contexts.test.js test/isolation/http-security.test.js test/isolation/observability.test.js` — 125 aprovados, 0 falhas, 0 cancelados, 0 skips. `SKIP_MIGRATE=1 npm run test:suite`: 302 aprovados, 0 falhas, 0 cancelados, 0 skips; guard aprovado, 224,25 s. `npm run web:build`: passou. `git diff --check`: passou.
- Limitações: resultado é local, não prova que o GitHub Actions remoto está verde nem substitui revisão de segurança integral; não foram feitos deploy ou merge. A suíte anterior falhou com 20 falhas e 25 cancelados antes dos ajustes.
- Próximos passos: revisar alterações e validar CI remoto após publicação autorizada; continuar auditoria sistemática de isolamento e avaliar dependências/Redis.
- Publicação/deploy: não realizados nesta sessão.

## 2026-11-07 — Isolamento do cardápio no banco

- Objetivo: impedir que produto, categoria e adicional de lojas distintas sejam relacionados por SQL direto, falhas de aplicação ou concorrência.
- Mudanças: `migrations/0031_menu_tenant_constraints.sql` adiciona chaves únicas compostas e FKs categoria/produto e produto/adicional; valida dados existentes e aborta sem modificá-los se já houver vínculo cruzado. `migrations/rollback/0031_menu_tenant_constraints.sql` reverte as constraints. `test/isolation/menu-tenant-constraints.test.js` cobre operações HTTP e SQL entre lojas, caminho válido e alteração de loja de categoria. `docs/INTEGRIDADE-MULTITENANT-CARDAPIO.md` documenta pré-checagem, locks, backup e reversão.
- Testes: PostgreSQL 18.6 local descartável; migration aplicada em banco já migrado. Três suítes de isolamento executadas em conjunto: 15 aprovados, 0 falhas/skips/cancelados; após incluir teste adicional de mudança da loja da categoria, `node --test test/isolation/menu-tenant-constraints.test.js` passou 8 testes. Ensaio separado em banco descartável verificou que dados cruzados legados abortam a migration sem perdas e que aplicar, reverter e reaplicar funciona. `SKIP_MIGRATE=1 npm run test:suite`: 310 aprovados, 0 falhas, 0 cancelados, 0 skips; guard aprovado, 222,77 s.
- Limitações: esta etapa protege somente relações do cardápio, não fecha a auditoria de todos os módulos. FKs podem exigir locks e a migration pode falhar com dados legados inconsistentes; nenhum banco de produção foi consultado ou alterado. Antes de implantação, consultar contagens, investigar e planejar a correção, sem apagar dados automaticamente.
- Próximos passos: ampliar a análise para sessões, pedidos, pagamentos e relações restantes; avaliar caches e realtime em múltiplas instâncias. Revisar e validar em ambiente de homologação antes de publicar.
- Publicação/deploy: não realizados nesta sessão.
