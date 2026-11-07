# Matriz funcional — semi-final × Admin-Restaurant

- Data: 07/11/2026
- Base Admin: `main` em `d79278a92d4007235f72877ed351a21e16f93a28`
- Referência semi-final: `main` em `47c5d7fd77f601b142ed8a0bb2d519998c5e0d87`
- Fonte de inventário detalhado: `docs/AUDITORIA-FUNCIONAL-QR-ADMIN-SEMI-FINAL.md` (preservada; contém IDs CLI, PRD, GAR, CX e ADM e detalhes de regras).

## Como ler

- **Presente (código)**: há módulo/rota/tela/migration identificável; não significa validação operacional.
- **Parcial**: existe base, mas a comparação documental aponta diferença ou falta cobertura.
- **Ausente/não evidenciado**: não foi encontrada implementação correspondente na árvore e documentação inspecionadas.
- **A confirmar**: não foi feita inspeção ponta a ponta suficiente.
- Maturidade M0–M5 segue a escala da auditoria funcional original. Nesta auditoria estática, nenhum M3–M5 foi concedido sem executar testes.

## Matriz resumida

| Área | Semi-final | Admin-Restaurant | Estado | Maturidade provisória | Evidência / lacuna principal |
|---|---|---|---|---|---|
| Cliente QR e cardápio | QR de mesa, categorias, pesquisa, produto, adicionais, ingredientes removíveis, carrinho e sessão acumulativa | páginas customer/menu/cart/table-session e módulos menu/tables/customer | Parcial / presente | M2 | `frontend/src/pages/customer/*`, `src/modules/customer`, `menu`, `tables`; confirmar paridade de detalhes, UX e sessão |
| Preço e idempotência | Preço servidor, reenvio idempotente | repositórios orders/cart e migrations de carrinho/sessão | Presente, validar casos | M2 | `orders.repository.js`, `cart.repository.js`, migrations 0010/0020/0021 |
| Acompanhamento do cliente | Status e itens entregues, cancelamento permitido | sessão customer e leitura de pedidos | Parcial / a confirmar | M1–M2 | `customer-session.js`, `customer-plugin.js`; comparar cancelamento e atualização |
| Cozinha e bar | Filas independentes, estados por item, produção progressiva, alertas, SSE | kitchen routes, order status machine e realtime | Parcial | M2 | `src/modules/kitchen`, `orders/status-machine.js`, `realtime/store-events.js`; confirmar UI, alertas, ciclo completo e reconexão |
| Garçom | PWA, retirada/entrega individual e em lote, responsável, transferência, autoria, offline IndexedDB | waiter page e rotas de operação existem, sem PWA offline equivalente evidenciada | Parcial | M1 | `frontend/src/pages/staff/WaiterPage.jsx`; falta comprovar lote, responsabilidade, transferência e fila offline |
| Caixa — comanda | Lista, consumo por itens entregues, fechamento | cash routes/repository e sessions de mesa | Parcial | M2 | `src/modules/cash`, migration 0025/0026; separar sessão de mesa da sessão de turno do operador |
| Caixa — turno/ledger | Sessão de operador, suprimento/sangria/estorno e conciliação | issue #107/#108 descreve lacunas; migrations 0025/0026 são cash sessions/permissions | Parcial / pendente | M1 | issue #107/#108; verificar se escopo completo foi implementado antes de qualquer fechamento |
| Pagamento parcial/combinado | múltiplos meios, saldo, estorno rastreável | payments e cash existem; issue #109 permanece aberta | Parcial / pendente | M1–M2 | issue #109; validar soma, excesso, estorno vinculado, idempotência |
| PIX | QR estático/manual, sem confirmação automática | PIX estático e webhook/provider boundary existem | Presente no básico | M2 | `payments/pix-static.js`, `webhook-auth.js`; PIX dinâmico ainda depende de provider/configuração |
| Desconto/taxa/reautenticação | regras e auditoria financeira | RBAC, cash e security documentam controles | A confirmar | M1–M2 | `cash`, `permissions`, `SECURITY.md`; validar UX e trilha |
| Dashboard | métricas operacionais/financeiras e layout personalizável | dashboard administrativo básico | Parcial | M1 | `frontend/src/pages/admin/DashboardPage.jsx`; personalização equivalente não demonstrada |
| Cardápio administrativo | CRUD, fotos, adicionais, ingredientes, setor e disponibilidade | menu admin e menu repositories | Parcial | M2 | `MenuAdminPage.jsx`, `src/modules/menu`; comparar campos, imagens, ordenação e UX |
| Estoque | controle por produto, entrada/baixa, mínimo e alertas | sem módulo de estoque/recipe nas árvores consultadas | Ausente / não evidenciado | M0 | nenhuma pasta/migration de stock/ingredients/recipes na árvore Admin |
| Importação/reversão de cardápio | CSV em lote, preview e reversão | não evidenciado na árvore Admin | Ausente / não evidenciado | M0 | semi-final tem `db/cardapio-import.js`, `db/cardapio-reversao.js` e docs CSV |
| Mesas/praças/QR | configuração, ocupação, consumo, QR | tables, sessions, tokens e host tenant | Presente, paridade a confirmar | M2 | `src/modules/tables`, migrations 0006/0021; confirmar praças e rotação de token |
| Equipe/garçons | staff, garçom, login, permissões, OAuth e remoção | auth, permissions e RBAC | Parcial / a confirmar | M2 | separar identidade de funcionário e garçom; conferir lifecycle e OAuth |
| Relatórios | faturamento, período, pagamentos, top produtos, garçons, timezone e exportação | reports repository/routes e dashboard | Parcial | M1–M2 | `src/modules/reports`; comparar relatórios específicos e exportação |
| Auditoria/autoria | histórico de ações, ator e timestamp | audit module, immutable migration e logs | Presente, validar abrangência | M2 | `src/modules/audit`, migrations 0004/0018 |
| Privacidade/anonimização | dry-run, anonimização manual, retenção e direitos | CRM consent e docs security; equivalência funcional não confirmada | Parcial / a confirmar | M1 | `src/modules/crm/consent.js`, `crm-routes.js`; falta validar ferramentas operacionais |
| PWA offline/sync | IndexedDB, retry/backoff, coordenação de abas e conflitos | não evidenciado no frontend Admin | Ausente / não evidenciado | M0 | semi-final tem `public/garcom-pwa`, service worker e suites offline |
| Billing/planos SaaS | não existe no semi-final operacional single-tenant | billing module/migration e platform page | Exclusivo Admin | M1–M2 | `src/modules/billing`, `platform`; verificar gateway, ciclo de assinatura e limites |
| CRM | clientes/consentimento/histórico | módulo CRM existe | Admin tem base adicional | M1–M2 | não assumir paridade; confirmar histórico e consentimento completo |
| Jobs/automação | tarefas auxiliares | jobs persistidos/worker; dead-letter avançado proposto em PR #159 | Parcial | M1–M2 | PR #159 não está pronta para merge devido remoção de testes |
| Integrações de delivery | semi-final não é prova de canais externos | delivery próprio + provider interface/mock | Parcial | M1 | `delivery/provider.interface.js`, `providers/mock.provider.js`; integração real não evidenciada |
| Hardware/impressão | não evidenciado como funcionalidade completa | issue #134 propõe adapters | Ausente/roadmap | M0 | issue #134 |
| Multiunidade | não se aplica ao single-tenant | issue #132 e arquitetura plataforma | Roadmap | M0–M1 | verificar escopo SaaS futuro |

## Funcionalidades do semi-final que precisam de preservação explícita

1. Adicionais com preço por item, ingredientes removíveis e ponto da carne.
2. Pedidos acumulativos na sessão da mesa, com preço calculado no servidor.
3. Cozinha/bar independentes, estados por item e produção progressiva.
4. Retirada e entrega individual/em lote, atribuição e transferência de responsabilidade do garçom.
5. Operação offline da PWA do garçom com IndexedDB, idempotência e estado de sincronização confiável.
6. Caixa baseado em itens entregues, pagamentos parciais/divididos, múltiplos meios, desconto/taxa com reautenticação e comprovante de consumo.
7. Estoque simples por produto, entradas/baixas, mínimo e alertas.
8. Importação CSV com reversão.
9. Dashboard com cards personalizáveis.
10. Relatórios e histórico por ator/período.
11. Rotinas de privacidade/anonimização manual e limitações explícitas de retenção.

## Diferenças intencionais

- Billing, planos, onboarding, gestão global de plataforma e multi-tenant são capacidades próprias do Admin-Restaurant e não devem ser removidas para buscar paridade com o semi-final.
- A arquitetura de instalação única do semi-final não deve ser copiada. Todo dado operacional no Admin precisa permanecer isolado por `store_id`.
- Funcionalidades do semi-final que não são requisito do SaaS podem ser classificadas como fora de escopo, mas somente com decisão explícita.

## Regra de atualização

Ao fechar cada item, atualizar status com evidência de arquivo/símbolo, migration e teste executado. Não promover status para “implementado e validado” com base apenas em README ou issue marcada como concluída.
