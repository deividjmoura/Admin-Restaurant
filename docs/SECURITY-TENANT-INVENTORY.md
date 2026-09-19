# Inventário inicial — isolamento multi-tenant (#105)

## Regra

O contexto de loja deve vir do tenant resolvido no backend. IDs enviados pelo cliente são identificadores de recursos, não autorização de tenant.

Para entidades de negócio, o padrão esperado é:

```sql
WHERE <resource_id> = $1
  AND store_id = $2
```

ou, em joins:

```sql
JOIN <entity> e
  ON e.id = x.<entity_id>
 AND e.store_id = x.store_id
WHERE x.store_id = $1
```

Recursos pertencentes a outra loja devem aparecer como inexistentes para a operação: **404**, não 403.

## Áreas revisadas nesta rodada

| Área | Estado | Evidência / ação |
|---|---|---|
| Tenancy | OK | `resolve-tenant.js` resolve host/custom domain/header; `store_id` do cliente não é fonte de verdade |
| Menu | OK | repositories filtram `store_id`; cache usa `menu:store:{storeId}` |
| Orders | OK | queries principais usam `store_id`; itens e joins são scoped |
| Tables | OK | tabelas/sessões usam `store_id` |
| Cart | HARDENED | resolução pública da sessão passou a usar `id + store_id` quando tenant está presente |
| Delivery | OK | zonas/pedidos usam `store_id`; tracking resolve pedido dentro do tenant |
| Reports | OK | consultas agregadas usam `store_id` e joins por `store_id` |
| Payments | HARDENED | criação agora valida `orderId` e `sessionId` contra a loja; webhook deriva tenant do pagamento |
| Realtime | OK + TESTE | canal em memória é indexado por `storeId`; teste dedicado impede entrega cruzada |
| Permissions | OK | `store_id` é obrigatório nos mappings e endpoints usam tenant resolvido |
| Store settings | OK | operações administrativas usam `request.storeId` |
| Auth/users | PLATFORM-SCOPED | usuários são globais; memberships são filtradas por `user_id`; acesso à loja é validado separadamente |
| Store lookup | PLATFORM-SCOPED | lookup de loja por ID/slug/domínio é resolução de tenant, não acesso a dados operacionais |

## Achados corrigidos

### 1. Pagamento podia receber alvo de outra loja

Antes, `createPayment(storeB, { orderId: orderA })` podia inserir um pagamento com `store_id = B` apontando para um pedido de A, porque as foreign keys existentes não garantiam que os dois registros compartilhavam o mesmo tenant.

Correção:
- validar `orderId + storeId`;
- validar `sessionId + storeId`;
- retornar erro de recurso inexistente quando o alvo não pertence à loja.

Cobertura:
- `test/isolation/payment-isolation.test.js`.

### 2. Webhook aceitava `body.storeId` como fonte de tenant

Antes, o webhook usava `body.storeId || request.storeId`. Um payload externo podia, portanto, escolher explicitamente a loja usada para processar um `paymentId`.

Correção:
- quando há `paymentId`, derivar `storeId` do próprio pagamento;
- rejeitar payment inexistente;
- se `body.storeId` existir, usar somente como consistência e nunca como fonte de autorização;
- sem `paymentId`, exigir tenant resolvido pelo host/header;
- rejeitar inconsistência entre tenant resolvido e payment.

Cobertura:
- `test/isolation/payment-isolation.test.js`.

### 3. Sessão pública do carrinho

A resolução da sessão já fazia comparação posterior com `request.storeId`, mas a consulta podia buscar uma sessão por ID antes da validação.

Correção:
- quando tenant está disponível, a própria query usa `id AND store_id`;
- o resultado continua sendo ocultado como 404.

Cobertura:
- `test/isolation/cart-tenant.test.js`.

## Realtime

`src/modules/realtime/store-events.js` mantém listeners em:

```text
storeId -> Set<listener>
```

O payload contém canal:

```text
store:<storeId>:orders
```

A rota SSE usa `request.storeId` resolvido pelo backend e assina somente esse canal.

Cobertura:
- `test/isolation/realtime-events.test.js`.

## Testes de regressão adicionados

- Pagamento com pedido de outro tenant.
- Pagamento com sessão de outro tenant.
- Webhook com `paymentId` de A + `storeId` adulterado de B.
- Carrinho de sessão de A acessado sob tenant B.
- Evento publicado em B não chega ao listener de A.

Baseline da suíte após os novos testes: **39 testes / 12 suítes**.

A suíte completa ainda deve ser executada em ambiente com `DATABASE_URL`; somente após essa execução o PR pode ser marcado como validado.

## Fora desta rodada

Não foram adicionadas novas funcionalidades. Não foi alterado schema do banco.

Itens que exigirem mudança de contrato ou arquitetura devem gerar Issues próprias em vez de crescer esta PR.

## Próxima revisão

Depois do merge desta PR, repetir o inventário sempre que surgir:
- novo repository;
- novo cache;
- novo consumer/producer de evento;
- nova fila/job;
- nova rota administrativa;
- nova integração externa;
- nova entidade com `store_id`.

A regra permanece: **Store A nunca pode ler, alterar, receber evento ou receber resposta que exponha dados de Store B.**
