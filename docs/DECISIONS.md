# Decisões de Arquitetura

## 2026-09-12 — Stack e abordagem de bootstrap

**Decisão:** Começar o repositório limpo com multi-tenancy desde o dia 1.
Usar o projeto `lanchonete-qr-semi-final` apenas como **referência de domínio e UX**, não como código base a ser adaptado.

**Motivo:** A especificação proíbe explicitamente criar single-tenant e depois adaptar. Isolamento mal feito é o maior risco do projeto.

**Reaproveitamento permitido:**
- Padrões de UI/UX e fluxos operacionais
- Regras de negócio já validadas (status, sessões, setores, etc.)
- Ideias de SSE, rate-limit, seed

**Não reaproveitar:**
- Schema sem `store_id`
- Queries sem scoping de tenant
- Features legadas não utilizadas (ex.: ponto da carne)

## 2026-09-12 — Fastify em vez de HTTP nativo

**Decisão:** Usar Fastify.

**Motivo:** Schema validation, plugins maduros (cookie, helmet, rate-limit, cors), melhor base para crescer sem reescrever o servidor depois. Ainda mantém a simplicidade próxima do projeto de referência.

## 2026-09-12 — Documentação separada em GOLDEN_RULES

**Decisão:** Extrair o checklist e regras de ouro para `docs/GOLDEN_RULES.md`.

**Motivo:** Facilitar consulta rápida no dia a dia e nos PRs, sem misturar com a descrição de arquitetura.

## 2026-09-20 — Hardening de segurança e integridade (webhooks, CORS, totais, atomicidade)

**Contexto:** auditoria apontou 7 falhas críticas e 6 altas (webhooks sem
assinatura, CORS permissivo em produção, credenciais default, totais sem
adicionais, checkout/delivery não atômicos, corrida no QR, transições de status
sem guarda, erros 4xx como 500 e auditoria incompleta).

**Decisões:**

- **Webhook** exige HMAC-SHA256 do corpo bruto (`WEBHOOK_SECRET_<PROVIDER>`);
  sem segredo → 404, assinatura inválida → 401. `storeId`/`paymentId`/`markPaid`
  do body são ignorados; o pagamento é resolvido por
  `(provider, provider_payment_id)` e a loja vem da linha do pagamento.
  Divergência de valor (> 0.005) grava `amount_mismatch` e nunca marca `PAID`.
- **CORS fail-closed:** sem `CORS_ORIGIN`/`FRONTEND_ORIGIN` (ou `COOKIE_SECRET`)
  a API não sobe em produção; cookie padrão `SameSite=Lax` (seguro para SPA na
  mesma origem) e `Secure` obrigatório quando cross-site.
- **Login** com rate limit por IP e por identidade, hash dummy para usuário
  inexistente (resposta indistinguível) e auditoria sem senha/e-mail em claro.
- **Totais** passam a usar `order_items.addons_total` (migration 0020) e
  `SUM((unit_price + addons_total) * quantity) FILTER (WHERE status <> 'CANCELLED')`,
  excluindo pedidos cancelados; adicionais são resolvidos **por linha** do
  pedido, não por produto.
- **Checkout** e **delivery** acontecem em uma única transação; `createOrder`
  aceita `{ tx, afterInsert }` e a idempotência é checada **antes** das validações
  de estado/versão (retry após limpar carrinho devolve o mesmo pedido).
- **Sessões de mesa** usam índice único parcial + `ON CONFLICT DO NOTHING`
  (migration 0021); sessão expirada com consumo aberto **não** é fechada
  automaticamente.
- **Transições de status** usam `UPDATE ... WHERE status = $esperado RETURNING`
  dentro de transação; sem linha → 409. O status do pedido é derivado dos itens.
- **Erros:** handler global registrado **antes** das rotas; 4xx preservados com
  códigos estáveis, 5xx genérico sem stack.
- **Auditoria** centralizada em `auditRequest`/`auditSafe` (best effort),
  cobrindo login, pedidos, pagamentos, mesas, cardápio, permissões, settings e
  delivery, com metadados sanitizados e leitura restrita ao OWNER.
