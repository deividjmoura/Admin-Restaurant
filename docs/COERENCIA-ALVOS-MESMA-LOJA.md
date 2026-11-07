# Coerência de adicionais e pagamentos na mesma loja

Revisão local sobre a branch de auditoria, 2026-11-07. Os testes
`test/isolation/same-store-target-coherence.test.js` verificam que os
repositórios de pedido e carrinho rejeitam adicional de outro produto da mesma
loja sem gravar pedido/item ou avançar a versão do carrinho, aceitam adicional
válido, e que o repositório de pagamentos rejeita pedido e sessão diferentes,
e que a nova regra rejeita ambos os alvos, mesmo quando correspondem. São testes dos caminhos de aplicação,
não prova de integridade para SQL direto nem para todos os fluxos.

## Consultas para investigação de dados legados

Em ambiente autorizado, com cópia sanitizada, contar divergências; não executar
reparos automáticos. Adicional de pedido nulo é um snapshot legítimo depois da
exclusão do adicional original e deve ser preservado.

```sql
SELECT 'cart_addon_product' AS relacao, count(*) AS inconsistencias
FROM cart_item_addons x
JOIN cart_items i ON i.id=x.cart_item_id AND i.store_id=x.store_id
JOIN product_addons a ON a.id=x.addon_id AND a.store_id=x.store_id
WHERE i.product_id<>a.product_id
UNION ALL
SELECT 'order_addon_product', count(*) FROM order_item_addons x
JOIN order_items i ON i.id=x.order_item_id AND i.store_id=x.store_id
JOIN product_addons a ON a.id=x.addon_id AND a.store_id=x.store_id
WHERE i.product_id<>a.product_id
UNION ALL
SELECT 'payment_order_session', count(*) FROM payments p
JOIN orders o ON o.id=p.order_id AND o.store_id=p.store_id
WHERE p.session_id IS NOT NULL AND o.table_session_id IS DISTINCT FROM p.session_id;
```

As FKs 0034 asseguram identidade de loja, não estas correspondências; a
alteração direta dos pais, concorrência e outros caminhos também precisam ser
considerados antes de propor constraints. Investigar positivos de forma
contextual; não presumir que histórico deve ser editado ou descartado.

## Achado: semântica ambígua ao informar os dois alvos

Antes da proteção descrita abaixo, `amountDue` usava a união dos itens do pedido
e da sessão quando ambos eram informados e o pagamento registrava os dois IDs.
Experimento anterior em banco
PostgreSQL descartável, sem gateway real: sessão com pedido A de R$ 10 e pedido B
de R$ 20; `amountDue` de A retorna R$ 10, com A e sessão retorna R$ 30; a criação
de pagamento `OTHER`, **PENDING**, de R$ 25 com ambos os IDs foi aceita e
vinculada a A e à sessão. Isso pode ser válido se o valor for da comanda inteira,
mas é ambíguo e pode apresentar o pagamento como associado a um único pedido de
valor inferior; efeitos de confirmação, resumos, estornos, concorrência e mistura
de pagamentos por pedido e sessão exigem análise antes de definir correção.

## Mitigação aplicada e risco remanescente

Após decisão de usar um único alvo, a aplicação rejeita ambos os IDs com
`PAYMENT_TARGET_AMBIGUOUS` em criação, pagamento combinado e resumo. É mudança
incompatível: clientes devem enviar somente `orderId` ou `sessionId`. Retentativas
com ambos os IDs, **inclusive de pagamentos históricos**, passam a falhar; não
reenviar com novos parâmetros/chave sem reconciliar o pagamento original. Dados
históricos permanecem inalterados. Isso é validação da aplicação, não constraint
SQL; `GET /api/payments` continua aceitando ambos como filtros de listagem.

**Risco financeiro ainda aberto — bloquear implantação até revisar.** Em um
experimento posterior no PostgreSQL descartável, pedido único de R$ 10 foi pago
por sessão usando split `OTHER` com status PAID. O resumo da sessão ficou R$ 0,
mas `amountDue` por pedido permaneceu R$ 10 e aceitou novo pagamento PENDING de
R$ 10 para o pedido. Não houve gateway real ou cobrança em produção. A regra de
alvo único não impede essa sobreposição entre solicitações distintas. Pagamentos
pendentes também não são descontados por desenho; confirmação de pendentes e
webhooks, concorrência, pagamentos históricos, estornos e rateio exigem análise
integral antes de se considerar o problema resolvido. Não contornar o risco com
uma alteração isolada de query nem presumir que a suíte verde o elimina.

Antes de qualquer implantação, combinar contrato para pagamentos mistos,
reconciliação e migração de clientes/retentativas, e validar em homologação com
backup. Não se afirma pagamento real, cobrança em produção ou perda financeira.
