# Regras de Ouro do Desenvolvimento

Antes de implementar **qualquer** funcionalidade, responda:

1. **Qual é o tenant dessa operação?**
2. **Quem pode executar?** (papel + store)
3. **Quais dados podem ser acessados?**
4. **Existe possibilidade de concorrência?**
5. **A operação precisa ser idempotente?**
6. **Precisa de transação de banco?**
7. **Precisa de evento interno?**
8. **Precisa de cache?** (e a chave é tenant-aware?)
9. **Pode ser assíncrona?** (fila)
10. **Como será monitorada?**
11. **Como será testada?** (incluindo isolamento multi-tenant)
12. **O que acontece se falhar?** (não derrubar o fluxo principal por falha secundária)

---

## Prioridades

```
segurança
> integridade dos dados
> correção
> manutenibilidade
> performance
> complexidade
```

Não adicionar complexidade sem necessidade real.

---

## Isolamento multi-tenant (obrigatório)

- Toda query de negócio deve filtrar por `store_id`.
- Nunca confiar em `store_id` enviado pelo cliente se o domínio/contexto já define o tenant.
- Cache, canais realtime e jobs de fila **sempre** tenant-aware.
- Teste automatizado: *Store A nunca acessa dados da Store B*.

---

## Idempotência

Operações críticas devem ser idempotentes:

- criação de pedido
- confirmação de pagamento / webhooks
- atualização de status
- impressão / notificações

Use `Idempotency-Key` ou identificador único de evento externo.

---

## Resiliência

Falha secundária **não** invalida o fluxo principal.

Exemplo correto:

```
Pedido criado → resposta ao cliente
                ↓
            print job na fila (retry se impressora offline)
```

Exemplo errado: bloquear a criação do pedido porque a impressora falhou.

---

## Migrations

- Toda alteração de schema é versionada.
- Nunca alterar produção manualmente.
- Preferir mudanças compatíveis quando houver clientes em versões diferentes.

---

## Checklist de PR (Fase 1+)

- [ ] Tenant está claro em todas as queries/rotas novas?
- [ ] Autorização server-side (não só no frontend)?
- [ ] Teste de isolamento considerado / adicionado?
- [ ] Erros padronizados (`AppError`) sem stack trace para o cliente?
- [ ] Secrets fora do código?
