# Backup e restauração

Issue **#52** / Epic #10 — operação.

## Princípios

1. **Backup fora do servidor da API** — o Postgres (Neon ou self-hosted) é a fonte da verdade; a API é efêmera.
2. **Testar restauração** pelo menos uma vez por trimestre (ou após mudança de schema grande).
3. **Segredos** (`JWT_SECRET`, `COOKIE_SECRET`, tokens de webhook) ficam em secret manager / env do deploy, **não** no dump público.

## Neon (recomendado)

- Point-in-time recovery (PITR) e branches de preview já cobrem o essencial.
- Manter **pelo menos 7 dias** de retenção em produção.
- Branch de staging a partir de snapshot (sem dados reais de cartão — o sistema não armazena PAN).

Checklist:

```text
[ ] Projeto Neon em região próxima dos clientes
[ ] Retenção PITR ≥ 7 dias
[ ] Branch `staging` a partir de main (sem tráfego de produção)
[ ] Credenciais de produção só no ambiente de deploy
```

## Self-hosted Postgres

```bash
# Dump lógico diário (cron fora da API)
pg_dump "$DATABASE_URL" -Fc -f "backup-$(date +%F).dump"
# Enviar para object storage (S3/R2/GCS) com lifecycle 30d
```

Restauração:

```bash
pg_restore -d "$DATABASE_URL_NEW" --clean --if-exists backup-YYYY-MM-DD.dump
npm run db:migrate   # garante schema_migrations alinhado
```

## O que **não** precisa de backup de app

- Arquivos locais da API (stateless)
- Cache Redis (rebuildable)
- Jobs `completed` antigos (opcional: purge > 30d)

## Jobs e impressão

A tabela `jobs` é recuperável pelo dump. Jobs `pending`/`dead` após restore podem ser reprocessados ou limpos manualmente — a venda já foi persistida em `orders`/`payments`.
