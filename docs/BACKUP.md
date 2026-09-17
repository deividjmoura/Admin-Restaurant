# Estratégia de backup — issue #52 (T9)

Postgres em serviço gerenciado (**Neon**). Objetivo: recuperar dados de
tenant sem perda relevante em caso de incidente (falha de instância,
degradação acidental, bug de migration).

## O que o Neon já provê

- **Continuous WAL + PITR**: snapshots contínuos; restauração para qualquer
  ponto dentro da janela de retenção (plano-dependent; manter a maior
  disponível — mínimo 7 dias).
- **Branching de banco**: usado também como proteção de deploy (branchar o
  branch de produção para testar migrations antes de aplicar).
- **Replicação/HA** no próprio serviço — nada a operar.

## Camadas adicionais (nossa responsabilidade)

1. **Dump lógico regular** (`pg_dump -Fc`) — proteção contra erros de
   retenção/conta e como formato portátil:
   - Frequência: diária (cron do provedor ou `neon console`/CLI).
   - Retenção: 14 dias on-site (object storage, ex.: S3/R2) + 1 mensal
     (outro provider/região).
   - Criptografia em repouso (o storage já cifra; senhas do banco nunca vão
     para o dump de forma utilizável sem as credenciais do storage).
2. **Config/secrets fora do banco**: `.env` (JWT_SECRET, COOKIE_SECRET,
   DATABASE_URL) vive no gerenciador de segredos do deploy (Vercel/Render),
   versionado/auditado lá — o backup do banco sozinho não recria o serviço.

## RTO / RPO alvo

| Cenário | RPO | RTO |
|---------|-----|-----|
| Falha de instância (Neon) | ~0 (WAL) | minutos (recriar instância) |
| Degradação acidental (bug/erro humano) | ≤ 1 dia (PITR) | 30 min (restore de branch + redeploy) |
| Perda de conta/provider | ≤ 1 dia (dump diário) | 4 h (novo provider + restore do dump) |

## Procedimento de restore (resumo)

1. Confirmar ponto de restauração com o dono (timestamp do último estado
   bom — usar audit logs de login/mutações como referência).
2. `neon` → criar branch a partir do ponto (PITR) ou restaurar dump
   (`pg_restore -d <db_novo> -Fc`).
3. Validar no branch: rodar `npm run db:migrate` (idempotente) +
   `npm run test:isolation` com `DATABASE_URL` apontando para o branch.
4. Trocar o `DATABASE_URL` do deploy (ou promover o branch) e monitorar
   `/ready` (check de DB) + métricas de job.
5. Registrar o incidente no log de eventos (`COORDENACAO.md` ou post-mortem).

## Teste da estratégia

- **Semestralmente**: restore de um dump em ambiente isolado + rodar a suíte
  de testes (`npm run test:isolation`).
- **A cada mudança de provider/plano**: repetir o teste acima.
- O CI (T1) já garante que migrations + tests passam em banco limpo —
  requisito para qualquer restore.
