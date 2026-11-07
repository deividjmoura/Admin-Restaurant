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
pendentes não eram descontados na criação à época; confirmação de pendentes e
webhooks, concorrência, pagamentos históricos, estornos e rateio exigem análise
integral antes de se considerar o problema resolvido. Não contornar o risco com
uma alteração isolada de query nem presumir que a suíte verde o elimina.

Antes de qualquer implantação, combinar contrato para pagamentos mistos,
reconciliação e migração de clientes/retentativas, e validar em homologação com
backup. Não se afirma pagamento real, cobrança em produção ou perda financeira.

## Mitigação parcial de escopos mistos (2026-11-07)

Novas criações por pedido são bloqueadas se a comanda tiver pagamento `PENDING`
ou `PAID`; novas criações por comanda são bloqueadas se qualquer pedido dela
possuir pagamento `PENDING` ou `PAID`. O resumo também retorna
`PAYMENT_SCOPE_CONFLICT` (409) quando o outro escopo impede cálculo confiável.
Criações concorrentes pela aplicação usam o lock da sessão de mesa antes do
pedido; a associação é conferida novamente após os locks. `REFUNDED`, `FAILED` e
`CANCELLED` não bloqueiam a troca de escopo. Nenhum rateio é feito.

**Incompatibilidade:** um restaurante não pode pagar parte por pedido e parte
pela comanda enquanto houver pagamentos ativos no outro escopo. Pendente bloqueia
mesmo sem confirmação, pois pode ser pago externamente mais tarde; o sistema
atual não oferece cancelamento seguro para todos os pendentes. Atendimento e
operação precisam conciliar com o provedor antes de tentar outra forma; não mudar
status, apagar pagamentos ou reenviar automaticamente para desbloquear. Consultas
em dados históricos mistos podem passar a responder 409. Replays existentes
podem não obter o resumo. Confirmar compatibilidade de clientes e acesso a
reconciliação antes de qualquer rollout. Os dados existentes não são alterados.

### Limitações críticas — bloqueio de implantação mantido

Esta proteção de escopos não torna o fluxo financeiro seguro por completo. Antes
da reserva descrita abaixo, um experimento isolado mostrou que um pedido de
R$ 10 aceitou **dois pagamentos PENDING de R$ 10** e ambas as confirmações
passaram a PAID, totalizando R$ 20. A confirmação ainda não revalida saldo. Nenhum
provedor real foi acionado; isso demonstra comportamento interno, não prova de
cobrança ou dano em produção.

A proteção de mistura atua em criação e resumo, não nas confirmações manuais ou
webhooks de registros legados; estes podem mudar estado apesar de uma situação
histórica conflitante. Rejeitar um webhook de pagamento real sem plano de
reconciliação pode ocultar dinheiro efetivamente recebido; não implementar isso
sem desenhar persistência de evidência, reprocessamento, alertas e operação. A
mudança não protege SQL direto, mudanças diretas nas associações de pedido, nem
concorrência com outras rotas que não usam o mesmo protocolo de lock. Estornos,
pedidos cancelados, pagamentos externos e sessões encerradas também requerem
revisão de regra e testes. Testes de concorrência cobrem criações pela aplicação,
não todas as transições ou configurações de isolamento.

**Não implantar até** projetar e verificar o ciclo completo de reservas,
confirmações manuais, webhooks autenticados, idempotência, estornos e conciliação
de pagamentos legados, com estratégia para estados externos já recebidos.


## Reserva de pagamentos pendentes (2026-11-07)

Na criação individual ou combinada, `availableToInitiate` limita novas reservas:
`max(0, itens + frete - pagos - pendentes)`, calculado em centavos. `due`
continua significando total não pago (não desconta pendentes); `pendingTotal`
mostra os pendentes. Uma operação idempotente existente não cria nova reserva.
A serialização anterior da sessão/pedido protege criações pela aplicação; valores
históricos em excesso não são apagados e deixam disponibilidade zero. A reserva
não é garantia sobre confirmações legadas ou estados externos.

**Mudança incompatível e risco de disponibilidade:** antes era possível criar
vários pendentes até o valor devido; agora o primeiro pode reservar tudo e impedir
outros meios de pagamento. Não existe expiração/cancelamento seguro universal
nem reconciliação automatizada. Uma pessoa autorizada ou abusiva pode bloquear
novas tentativas; não contornar apagando pagamentos nem supondo que um PIX ou
provider não possa confirmar depois. É necessário projetar autorização, limites,
recuperação e verificação junto ao provedor antes do rollout.

Bloqueio de implantação **mantido**: confirmações de pendentes antigos excessivos,
webhooks, disputas, alterações/cancelamento de pedido, race com transições que não
compartilham lock, dados legados e reconciliação externa não foram resolvidos.
Também não há prova de integração financeira real. Não cancelar automaticamente
uma reserva nem rejeitar evidência de recebimento real sem protocolo de conciliação.
