# Reports / Dashboard (Fase 8 / Epic #9)

Todas as consultas **obrigatoriamente** filtram por `store_id`.

## Rotas (staff)

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/reports/dashboard?preset=today` | Resumo + top produtos + série + live |
| GET | `/api/reports/summary?preset=week` | Só métricas |
| GET | `/api/reports/top-products?limit=10` | Ranking |
| GET | `/api/reports/live` | Sessões abertas, pedidos ativos, pagamentos pending |

**preset:** `today` \| `yesterday` \| `week` \| `month` \| `custom` (com `from` & `to` ISO)

Timezone: `APP_TIMEZONE` (default `America/Sao_Paulo`).
