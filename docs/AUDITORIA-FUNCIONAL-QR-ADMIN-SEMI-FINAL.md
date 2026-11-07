# Auditoria funcional comparativa: QR Admin (semi-final) × Admin-Restaurant

> **Objetivo:** registrar todas as funcionalidades documentadas no repositório `lanchonete-qr-semi-final` e comparar seu estado com o `Admin-Restaurant`, identificando maturidade, lacunas e cuidados para uma eventual implementação multi-tenant.
>
> **Regra principal:** o `Admin-Restaurant` é a única base de desenvolvimento. O `lanchonete-qr-semi-final` é referência funcional. Não copiar sua arquitetura single-tenant nem alterar seu repositório como parte desta iniciativa.

- Data da auditoria: 07/11/2026
- Repositórios:
  - Referência funcional: [deividjmoura/lanchonete-qr-semi-final](https://github.com/deividjmoura/lanchonete-qr-semi-final)
  - Base de desenvolvimento: [deividjmoura/Admin-Restaurant](https://github.com/deividjmoura/Admin-Restaurant)
- Fontes iniciais: README e package.json do semi-final; módulos de pedidos, cardápio, garçons e relatórios consultados; README, package.json, roadmap, documentação de arquitetura/segurança e módulo de pedidos do Admin-Restaurant.
- **Limite desta versão:** inventário documental e inspeção de código-fonte selecionado. Não representa execução de testes, validação visual de todas as telas, nem auditoria linha a linha de todas as rotas. Itens marcados como “a confirmar” exigem inspeção específica antes de virar conclusão definitiva.

## 1. Como interpretar a comparação

| Classificação | Significado |
|---|---|
| **Equivalente / presente** | A capacidade existe no Admin-Restaurant em nível funcional comparável. Ainda deve ser validada em todos os fluxos e tenants. |
| **Parcial** | Existe uma base, mas faltam comportamentos, detalhes de UX, regras ou cobertura que o semi-final já oferece. |
| **Ausente / não evidenciado** | Não foi encontrada evidência suficiente no material inspecionado do Admin-Restaurant. Não significa que seja impossível ou que nunca exista em código não inspecionado. |
| **A confirmar** | Há indícios, mas é necessária inspeção de rotas, telas, migrations e testes para fechar o diagnóstico. |

**Maturidade** avalia o que está descrito/implementado no semi-final, não a qualidade presumida de produção. “Maduro” não significa automaticamente seguro para SaaS multi-tenant.

## 2. Inventário completo das funcionalidades documentadas no semi-final

### 2.1 Cliente, cardápio e QR Code

| ID | Funcionalidade no semi-final | Detalhamento que deve ser preservado |
|---|---|---|
| CLI-01 | Acesso ao cardápio por QR Code | Cliente lê QR da mesa e abre o cardápio no navegador, sem instalar aplicativo. |
| CLI-02 | Navegação por categorias | Categorias ordenadas e produtos agrupados. |
| CLI-03 | Pesquisa de produtos | Busca de itens no cardápio. |
| CLI-04 | Detalhes do produto | Nome, descrição, preço, foto e disponibilidade. |
| CLI-05 | Adicionais | Opções/adicionais configurados por produto, com preço próprio. |
| CLI-06 | Ingredientes removíveis | Cliente pode remover ingredientes permitidos. |
| CLI-07 | Ponto da carne | Opção quando habilitada para o produto. |
| CLI-08 | Carrinho e envio | Montagem do carrinho e envio para a comanda da mesa. |
| CLI-09 | Comanda acumulativa | Novos pedidos podem ser adicionados à sessão da mesa já aberta. |
| CLI-10 | Acompanhamento | Cliente acompanha andamento e itens entregues. |
| CLI-11 | Cancelamento pelo cliente | Cancelamento sujeito às regras e estados permitidos. |
| CLI-12 | Identificação por sessão/QR | QR fixo identifica a sessão; não há rotação automática do token ao fechar a comanda, conforme documentação atual. |
| CLI-13 | Proteção de preço | Preço e regras são resolvidos no servidor, não confiados ao navegador. |
| CLI-14 | Idempotência | Reenvio de pedido com a mesma chave não deve duplicar a operação. |

### 2.2 Cozinha e bar

| ID | Funcionalidade no semi-final | Detalhamento |
|---|---|---|
| PRD-01 | Separação por setor | Cada item segue o setor de produção configurado no cardápio. |
| PRD-02 | Filas independentes | Cozinha e bar trabalham em filas próprias e em paralelo. |
| PRD-03 | Recebimento de itens | Visualização de itens novos/recebidos. |
| PRD-04 | Início de preparo | Alteração de estado por item para em produção. |
| PRD-05 | Conclusão de preparo | Conclusão independente por item. |
| PRD-06 | Ciclo de estados por item | Recebido → em produção → concluído → aceito → retirado → entregue; cancelamentos autorizados têm estado terminal. |
| PRD-07 | Produção progressiva | Um item pode ficar pronto e seguir para retirada enquanto outros itens da comanda continuam em produção. |
| PRD-08 | Atualização em tempo real | SSE com reconexão/fallback no cliente. |
| PRD-09 | Alertas sonoros | Alertas nas telas compatíveis. |
| PRD-10 | Histórico de transições | Registro de ator, horário e transições por item. |

### 2.3 Garçom e atendimento

| ID | Funcionalidade no semi-final | Detalhamento |
|---|---|---|
| GAR-01 | PWA instalável | Área do garçom instalável, servida pelo backend. |
| GAR-02 | Consulta de mesas | Visualização das mesas e comandas. |
| GAR-03 | Fila compartilhada | Consulta da fila de itens prontos. |
| GAR-04 | Retirada individual | Retirada de um item por vez. |
| GAR-05 | Retirada em lote | Retirada de vários itens. |
| GAR-06 | Entrega individual | Confirmação de entrega por item. |
| GAR-07 | Entrega em lote | Confirmação de vários itens. |
| GAR-08 | Responsável automático | Primeiro garçom a retirar item pronto pode assumir a mesa se ainda não houver responsável. |
| GAR-09 | Atendimento colaborativo | Mais de um garçom pode atuar conforme regras do servidor. |
| GAR-10 | Transferência de responsabilidade | Transferência explícita da mesa/responsabilidade. |
| GAR-11 | Histórico e autoria | Ator e horário associados às operações. |
| GAR-12 | Lançamento de pedidos | Garçom pode lançar pedidos conforme permissões. |
| GAR-13 | Operação offline | Pedidos sem conexão persistidos em IndexedDB e reenviados quando a conexão retorna. |
| GAR-14 | Sincronização idempotente | Chave de idempotência, backoff e coordenação entre abas. |
| GAR-15 | Estado de sincronização confiável | Pedido só é indicado como sincronizado após confirmação válida do servidor. |
| GAR-16 | Tratamento de falhas/conflitos | Falhas e conflitos permanecem visíveis para revisão; rascunho local não equivale a pedido recebido. |
| GAR-17 | Limites offline documentados | Limpeza de dados, desinstalação ou perda do aparelho pode eliminar pedidos não sincronizados; API não é cacheada pelo Service Worker. |

### 2.4 Caixa, pagamentos e fechamento

| ID | Funcionalidade no semi-final | Detalhamento |
|---|---|---|
| CX-01 | Lista de comandas abertas | Caixa acompanha sessões em aberto. |
| CX-02 | Total cobrável por entrega | Apenas itens efetivamente entregues compõem o consumo cobrável. |
| CX-03 | Pagamento parcial | Lançamentos parciais em dinheiro, PIX, débito e crédito. |
| CX-04 | Pagamento dividido | Múltiplos lançamentos e saldo restante. |
| CX-05 | Desconto | Aplicação conforme permissões. |
| CX-06 | Taxa de serviço | Aplicação de taxa configurável; padrão documentado de 10% quando variável ausente/inválida. |
| CX-07 | Reautenticação financeira | Login e senha de admin ativo para desconto maior que zero ou ajuste da taxa padrão, com motivo e auditoria. |
| CX-08 | Cancelamento com motivo | Registro do motivo. |
| CX-09 | Comprovante de consumo | Emissão de comprovante; não equivale a nota fiscal. |
| CX-10 | Fechamento de comanda | Fecha a sessão e libera mesa quando não há pendências. |
| CX-11 | PIX estático | QR/chave estático; pagamento marcado manualmente após conferência bancária. |
| CX-12 | Ausência de confirmação bancária | Sistema não é gateway e não confirma transferência automaticamente. |
| CX-13 | Rastreabilidade de operador | Lançamentos podem registrar conta staff/operador e preservar nome informado no momento do lançamento. |

### 2.5 Administração, cardápio e estoque

| ID | Funcionalidade no semi-final | Detalhamento |
|---|---|---|
| ADM-01 | Dashboard operacional/financeiro | Faturamento, pedidos, ticket médio, pagamentos, produtos, entregas, mesas e garçons. |
| ADM-02 | Dashboard personalizável | Organizar, redimensionar, ocultar/exibir cards e ajustar títulos/legendas. |
| ADM-03 | Categorias | Cadastro/ordenação de categorias. |
| ADM-04 | Produtos | Cadastro e edição de nome, descrição, preço, foto e disponibilidade. |
| ADM-05 | Adicionais | Gestão de adicionais e preços. |
| ADM-06 | Ingredientes removíveis | Configuração por produto. |
| ADM-07 | Setor de produção | Configuração do destino cozinha/bar por produto. |
| ADM-08 | Controle de estoque por produto | Ativar/desativar controle e definir saldo. |
| ADM-09 | Entrada e baixa de estoque | Registrar entrada e retirar unidade/quantidade. |
| ADM-10 | Estoque mínimo | Alerta para saldo menor ou igual ao mínimo, inclusive esgotados. |
| ADM-11 | Ajuste rápido de estoque | Ajuste direto pela área de alerta. |
| ADM-12 | Disponibilidade separada do estoque | Produto pode permanecer pausado manualmente mesmo após reposição. |
| ADM-13 | Mesas e praças | Configuração, ocupação e consumo. |
| ADM-14 | Geração de QR Codes | Geração dos QR das mesas. |
| ADM-15 | Gestão de garçons | Cadastro, links/tokens e acompanhamento. |
| ADM-16 | Contas internas | Logins por perfil. |
| ADM-17 | Permissões | Controle por papel/perfil. |
| ADM-18 | Senhas | Troca, redefinição e políticas de credenciais. |
| ADM-19 | Google OAuth opcional | Vinculação de e-mail verificado a conta ativa previamente cadastrada; não cria contas. |
| ADM-20 | Acompanhamento operacional | Comandas, responsáveis, transferências e entregas. |
| ADM-21 | Limpeza/anonimização manual | Prévia e anonimização de dados pessoais de contas fechadas anteriores à data de corte. |
| ADM-22 | Preservação financeira na anonimização | Pagamentos, valores, formas, datas e autoria são preservados. |
| ADM-23 | Importação de cardápio CSV | Importação em lote de catálogo, com regras específicas documentadas. |
| ADM-24 | Prévia e reversão da importação | Ponto de restauração da importação anterior; reversão condicionada à ausência de alterações posteriores. |
| ADM-25 | Gestão de fotos | Ferramentas/scripts de diagnóstico, correção e sincronização de fotos. |

### 2.6 Relatórios e histórico

| ID | Funcionalidade no semi-final | Detalhamento |
|---|---|---|
| REL-01 | Relatório de vendas por período | Filtro por data inicial/final. |
| REL-02 | Resumo financeiro | Faturamento, vendas brutas, serviço, descontos, total cobrado e ticket médio. |
| REL-03 | Pagamentos por forma | Quebra por forma de pagamento. |
| REL-04 | Pedidos por status | Quantidade total e distribuição por estado. |
| REL-05 | Produtos em destaque | Ranking/top produtos. |
| REL-06 | Série diária | Vendas/contas por dia no período. |
| REL-07 | Relatório por garçom | Contas, vendas, serviço, descontos e total por responsável. |
| REL-08 | Detalhe de contas | Mesa, cliente quando disponível, valores, desconto, taxa, forma e horário. |
| REL-09 | Fuso horário | Período interpretado no fuso configurado da operação, padrão documentado America/Sao_Paulo. |
| REL-10 | Impressão/PDF | Dados preparados para PDF/impressão. |
| REL-11 | Limite de consulta | Detalhamento de contas limitado a 500 registros no código consultado; validar paginação/necessidade operacional. |

### 2.7 Segurança, auditoria, confiabilidade e privacidade

| ID | Funcionalidade no semi-final | Detalhamento |
|---|---|---|
| SEG-01 | Autorização no servidor | Interface não é autoridade para preço, permissão, estado ou fechamento. |
| SEG-02 | Sessões e perfis | Controle de acesso por perfil. |
| SEG-03 | Proteção CSRF/origem | Proteções para operações autenticadas. |
| SEG-04 | Rate limiting | Limites em tentativas/operações sensíveis. |
| SEG-05 | Política de senha | Troca obrigatória de credenciais iniciais/compartilhadas. |
| SEG-06 | Revogação de sessão | Troca/redefinição de senha revoga sessões. |
| SEG-07 | Reautenticação sensível | Reautenticação para ações financeiras administrativas. |
| SEG-08 | Auditoria transacional | Eventos de operações críticas e alterações administrativas. |
| SEG-09 | Identidade do ator | Separação entre ator garçom e conta staff/operador. |
| SEG-10 | Health check | GET /healthz executa SELECT 1 com timeout e indica indisponibilidade do banco. |
| SEG-11 | Gate de migrations | Inicialização de produção bloqueia servidor se migrations falharem. |
| SEG-12 | Anonimização manual | Dry-run e execução manual para dados pessoais em contas fechadas. |
| SEG-13 | Retenção | Prazo de 24 meses aprovado/documentado, mas validação contábil/jurídica e rotina de descarte ainda pendentes. |
| SEG-14 | Consulta geral da auditoria | Não há tela administrativa geral para pesquisar todos os eventos; consulta técnica por banco/relatórios autorizados. |
| SEG-15 | Limitações operacionais documentadas | Testes em aparelhos físicos, retomada offline, alertas externos e restore real precisam de validação operacional. |

### 2.8 Recursos explicitamente não implementados no semi-final

Estes itens não devem ser tratados como funcionalidades entregues:

- Multi-tenant/multi-loja.
- Gateway PIX e confirmação bancária automática; PIX atual é estático/manual.
- Nota fiscal; documento atual é comprovante de consumo.
- Web Push com aplicativo fechado.
- Rotação automática do token fixo do QR da mesa ao fechar a comanda.
- Tela geral de consulta de auditoria.
- Descarte automático de dados por política de retenção.
- Validação completa em aparelhos físicos Android/iOS e retomada offline.
- Confirmação de configuração/entrega de alertas externos por e-mail.
- Drill real de backup e restauração no provedor.
- Monitoramento e procedimento de recuperação integralmente confirmados.

## 3. Comparação com o Admin-Restaurant

A tabela abaixo é o diagnóstico inicial com base na documentação e nos módulos inspecionados do Admin-Restaurant. “Parcial” não é uma crítica: significa que não se deve declarar paridade até fechar os detalhes.

| Área | Semi-final | Admin-Restaurant | Estado inicial | Trabalho/validação necessária |
|---|---|---|---|---|
| QR e cardápio público | Fluxo completo por QR, categorias, busca, fotos, adicionais e removíveis | Contextos de loja/cliente, menu e resolução de tenant existentes | **Parcial / a confirmar** | Comparar navegação, busca, fotos, opções, disponibilidade e experiência real do cliente. |
| Carrinho e envio de pedido | Comanda acumulativa, chave idempotente, validações | Carrinho/versão, pedidos idempotentes e sessões de cliente documentados | **Presente, paridade a confirmar** | Verificar edição, reenvio, conflitos, carrinho compartilhado e isolamento por tenant. |
| Acompanhamento pelo cliente | Status e itens entregues | Sessões de cliente e leitura de pedidos existentes | **Parcial / a confirmar** | Validar tela, atualização em tempo real, permissões e histórico. |
| Cozinha e bar | Filas independentes por setor, ciclo completo por item, SSE e alertas | Máquina de status de pedido/item e eventos realtime previstos | **Parcial** | Confirmar telas e separação por setor, transições equivalentes, aceitação/retirada, som e reconexão. |
| Garçom | PWA completa, lote, responsabilidade, transferência e offline | Rotas de waiter/itens prontos/entrega existem | **Parcial** | Validar PWA, lote, atribuição/transferência, autoria e principalmente sincronização offline IndexedDB. |
| Caixa | Pagamento parcial/dividido, quatro formas, desconto/taxa com reautenticação, comprovante | Sessões e fechamento do caixa existem; PIX estático e adaptador CARD constam do roadmap | **Parcial** | Verificar pagamentos parciais/divididos, saldo, taxas, descontos, motivo, reautenticação, comprovante e conciliação. |
| PIX | Estático/manual, sem confirmação bancária | PIX estático; PIX dinâmico consta como pendência (#51) | **Equivalente no básico** | Preservar comportamento manual e planejar PIX dinâmico sem confundir intenção com pagamento confirmado. |
| Dashboard | Indicadores + layout personalizável | Dashboard básico documentado | **Parcial** | Inventariar cada métrica, filtros, cards, personalização, persistência por usuário/loja. |
| Cardápio administrativo | CRUD, fotos, adicionais, removíveis, setor, disponibilidade | Módulo/menu e dados de produto existem | **Parcial / a confirmar** | Conferir todos os campos, UX, ordenação, upload/serving de fotos e regras. |
| Estoque | Controle por produto, entradas/baixas, mínimo e alertas | Não há evidência suficiente no roadmap/documentação consultada | **Ausente / a confirmar** | Inspecionar schema e código; se ausente, desenhar estoque tenant-aware e transacional. |
| Importação CSV e reversão | Importação em lote e reversão segura | Não evidenciado na documentação consultada | **Ausente / a confirmar** | Inspecionar módulo de catálogo; planejar validação, preview, auditoria e rollback por loja. |
| Mesas e praças | Cadastro, ocupação, consumo e QR | Gestão de mesas/sessões e QR contextualizados por tenant | **Presente, paridade a confirmar** | Conferir praças, geração/rotação de QR, ocupação, bloqueios e fechamento. |
| Garçons e equipe | Cadastro/token, logins, perfis, Google OAuth | RBAC, staff e sessões documentados | **Presente, paridade a confirmar** | Verificar cadastro de garçons separado de staff, vínculos, tokens, desligamento, OAuth e trilha de autoria. |
| Relatórios | Período, diário, formas, status, top produtos, por garçom e contas | Dashboard/relatórios básicos; cobertura detalhada não confirmada | **Parcial / a confirmar** | Mapear todos os indicadores e relatórios, timezone, exportação/PDF, paginação e atribuição de serviço. |
| Auditoria | Eventos transacionais, autoria e histórico por item | Auditoria e segurança previstas no núcleo | **Presente, paridade a confirmar** | Comparar ações cobertas, contexto, ator, request ID, integridade e consulta administrativa. |
| Anonimização/privacidade | Dry-run, anonimização manual e preservação financeira | Políticas e controles de segurança existem; equivalência funcional não confirmada | **Parcial / a confirmar** | Definir retenção por tenant, direitos do titular, anonimização e preservação legal/financeira. |
| PWA offline | Persistência local, backoff, idempotência e coordenação entre abas | Não evidenciado no material consultado | **Ausente / a confirmar** | Validar conectividade, fila local, reenvio seguro e isolamento de dados por loja/dispositivo. |
| Health/migrations | Health check e gate de migrations | Infraestrutura e migrations existentes | **Presente, paridade a confirmar** | Validar health real, readiness, deploy e comportamento em falha de migration. |
| Segurança de sessão | CSRF, rate limit, revogação, reautenticação | Fastify, cookies, JWT/customer sessions, RBAC e controles de segurança documentados | **Presente, paridade a confirmar** | Auditar cada fluxo e garantir que tenant não possa ser escolhido/confiado pelo cliente. |

## 4. Arquitetura multi-tenant: regras obrigatórias para qualquer adaptação

Nenhuma funcionalidade deve ser portada literalmente sem revisão. O semi-final assume um estabelecimento por instalação; o Admin-Restaurant precisa preservar isolamento entre lojas.

1. **Escopo de tenant obrigatório:** toda leitura/escrita de dados operacionais deve derivar o `store_id` do contexto autenticado/resolvido no servidor. Nunca confiar em `store_id` enviado livremente pelo frontend.
2. **Banco e constraints:** avaliar `store_id` em tabelas, índices compostos, chaves únicas e FKs. Impedir que relações cruzem lojas, inclusive IDs válidos de outro tenant.
3. **Autorização:** validar papel e vínculo do usuário com a loja em cada rota; separar plataforma SaaS, administrador da loja, caixa, cozinha/bar, garçom e cliente.
4. **Sessões e tokens:** sessão de cliente, QR de mesa, garçom e staff devem estar vinculados ao tenant e ao recurso correto. Prever revogação/rotação segura.
5. **Realtime/SSE:** canais, tópicos, tickets e reconexão devem filtrar por loja e autorização. Não basta filtrar a tela.
6. **Cache:** toda chave/cache precisa incluir tenant; invalidar somente dados da loja correta. Cache global em memória não pode misturar cardápios.
7. **Jobs/filas:** payloads devem carregar tenant validado; workers devem restaurar o contexto e evitar processar IDs de outra loja.
8. **Offline:** IndexedDB deve separar loja/usuário/dispositivo, expirar sessões e rejeitar sincronização em tenant errado. Reenvio idempotente precisa respeitar o escopo da loja.
9. **Relatórios:** todas as consultas, agregações, exports e PDFs devem aplicar tenant e timezone da loja.
10. **Auditoria:** eventos precisam registrar tenant, ator, ação, alvo, data e request/correlation ID.
11. **Migrations e rollout:** schema compartilhado deve ser compatível com instalações existentes; migrations reversíveis quando possível e testadas com múltiplos tenants.
12. **Testes negativos:** para cada recurso, provar que usuário/loja A não lê, altera, entrega, cobra, exporta ou recebe eventos da loja B.

## 5. Critérios de maturidade para reaproveitamento

Cada funcionalidade do inventário deve receber uma avaliação antes de ser priorizada:

- **M0 — somente ideia/documentação:** não há implementação verificável.
- **M1 — implementada parcialmente:** fluxo incompleto, mocks ou lacunas relevantes.
- **M2 — implementada:** código e fluxo principal presentes.
- **M3 — coberta por testes:** testes de unidade/integração/regressão cobrem regras importantes.
- **M4 — validada operacionalmente:** smoke/E2E e validação real do cenário, inclusive falhas e concorrência quando aplicável.
- **M5 — pronta para SaaS multi-tenant:** além de M4, isolamento entre lojas demonstrado com testes positivos e negativos.

Não atribuir M4/M5 apenas porque o README declara a funcionalidade pronta. Anexar evidências: caminhos de código, migrations, testes e resultados de execução.

## 6. Prioridades recomendadas

### P0 — fechar o inventário e garantir segurança
- [ ] Inspecionar todas as rotas, telas, migrations e testes do semi-final para validar/expandir os IDs deste inventário.
- [ ] Inspecionar os módulos equivalentes no Admin-Restaurant e substituir “a confirmar” por evidência.
- [ ] Auditar isolamento multi-tenant antes de portar qualquer fluxo financeiro ou operacional.
- [ ] Criar testes de acesso cruzado entre duas lojas para pedidos, itens, mesas, clientes, staff, pagamentos, SSE, cache, jobs e relatórios.

### P1 — paridade operacional do fluxo principal
- [ ] Cliente: cardápio completo, adicionais/removíveis, carrinho e acompanhamento.
- [ ] Cozinha/bar: filas independentes e estados por item.
- [ ] Garçom: retirada/entrega individual e em lote, responsabilidade e transferência.
- [ ] Caixa: pagamentos parciais/divididos, desconto/taxa, reautenticação, comprovante e fechamento.
- [ ] Dashboard e relatórios operacionais/financeiros.

### P2 — administração e produtividade
- [ ] Estoque, mínimo, alertas e movimentações.
- [ ] Importação CSV, prévia e reversão segura.
- [ ] Personalização de dashboard.
- [ ] Gestão completa de contas/garçons/tokens e OAuth.
- [ ] Auditoria pesquisável e ferramentas de privacidade.

### P3 — confiabilidade e evolução
- [ ] PWA offline com sincronização idempotente e recuperação de conflitos.
- [ ] SSE/realtime multi-instância com infraestrutura compartilhada.
- [ ] PIX dinâmico e confirmação por provedor, sem tratar webhook não validado como pagamento.
- [ ] Testes de carga, E2E, restore e validação em dispositivos reais.
- [ ] Evoluções fiscais e integrações externas somente com escopo e requisitos definidos.

## 7. Checklist de aceite por funcionalidade

Uma funcionalidade só deve ser considerada portada quando todos os itens aplicáveis forem atendidos:

- [ ] Comportamento do semi-final descrito com critérios de aceite claros.
- [ ] Estado atual no Admin-Restaurant confirmado por código, não por suposição.
- [ ] Diferenças funcionais e de UX registradas.
- [ ] Modelo de dados e migrations compatíveis com tenant.
- [ ] Rotas e permissões verificadas no servidor.
- [ ] Cache, SSE, jobs e offline avaliados quando aplicáveis.
- [ ] Testes unitários e de integração adicionados/atualizados.
- [ ] Testes de isolamento entre pelo menos dois tenants.
- [ ] Testes de regressão do fluxo existente.
- [ ] Evidência de execução de testes e validação operacional registrada.
- [ ] Documentação do Admin-Restaurant atualizada.

## 8. Instruções para o próximo agente

O agente que continuar este trabalho deve:

1. Ler este documento e a documentação central do Admin-Restaurant (`AGENTS.md`/instruções vigentes, `ARCHITECTURE.md`, `GOLDEN_RULES.md`, `SECURITY.md`, contextos de entrada e sessões de cliente).
2. Atualizar as duas branches `main` e registrar os SHAs analisados.
3. Percorrer o inventário inteiro, sem selecionar apenas as funcionalidades mais fáceis.
4. Conferir cada item do semi-final contra código, rotas, telas, migrations e testes do Admin-Restaurant.
5. Atualizar a matriz com status, evidência (caminhos/linhas), maturidade M0–M5, lacunas e recomendação.
6. Marcar explicitamente funcionalidades que existem no Admin, mas com implementação mais simples ou regras diferentes.
7. Não converter o Admin-Restaurant para single-tenant.
8. Não copiar código/schema/fluxos sem adaptar e testar o isolamento multi-tenant.
9. Não alterar o repositório `lanchonete-qr-semi-final`.
10. Não implementar funcionalidades durante a etapa de auditoria, salvo autorização separada. Primeiro entregar o inventário completo e o plano de paridade.
11. Não declarar uma funcionalidade pronta com base apenas em README ou interface; exigir evidência de código e testes.
12. Preservar funcionalidades já existentes no Admin-Restaurant e evitar duplicação.

## 9. Resultado esperado da auditoria aprofundada

A próxima revisão deste documento deve entregar:

- Inventário 100% percorrido de funcionalidades do semi-final, inclusive telas, rotas, scripts operacionais e fluxos menos visíveis.
- Matriz de paridade completa com evidências nos dois repositórios.
- Lista de funcionalidades ausentes, parciais, equivalentes e mais completas no Admin-Restaurant.
- Maturidade M0–M5 sustentada por testes/execuções.
- Riscos de adaptação multi-tenant por funcionalidade.
- Backlog priorizado, com dependências e critérios de aceite.
- Separação explícita entre código implementado, teste automatizado e validação em produção.

---

**Conclusão provisória:** o Admin-Restaurant já possui uma base multi-tenant para lojas, clientes, pedidos, sessões, autorização, caixa e infraestrutura. O semi-final documenta um conjunto operacional mais detalhado em produção por item, PWA offline, administração de cardápio/estoque, caixa e relatórios. A oportunidade é atingir paridade funcional sem sacrificar o isolamento multi-tenant. A matriz acima é um ponto de partida auditável, não uma declaração de que todos os detalhes já foram comparados.
