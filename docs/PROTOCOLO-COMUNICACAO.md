# Protocolo de Comunicação entre Agentes

**Projeto:** Admin-Restaurant  
**Versão:** 1.1  
**Vigência:** a partir de 2026-09-18  
**Modo:** Estabilização

---

## 1. Objetivo

Padronizar a forma como agentes reportam status, reivindicam tarefas e fazem handoff, reduzindo ambiguidade e conflito de domínio.

---

## 2. Formato obrigatório de status (AR-STATUS)

Todo agente **deve** emitir este bloco ao:
- reivindicar uma tarefa
- terminar uma tarefa
- ficar bloqueado
- fazer handoff

```
AR-STATUS
sid:18/09
agent:<id-curto>
task:<A|B|C|D|E|META>
claim:<dominio-exato>
state:<CLAIM|WIP|BLOCKED|DONE|HANDOFF|ABORT>
progress:<0-100>
blockers:<none|texto-curto>
next:<none|texto-curto>
iso:<PASS|FAIL|SKIP|UNK>
note:<texto-curto-opcional>
```

### Regras dos campos

| Campo     | Obrigatório | Valores permitidos / regra |
|-----------|-------------|---------------------------|
| sid       | sim         | Data da sessão (ex: 18/09) |
| agent     | sim         | Identificador curto único (ex: cli-01, ops-02) |
| task      | sim         | A, B, C, D, E ou META |
| claim     | sim         | Nome exato do domínio reivindicado |
| state     | sim         | CLAIM, WIP, BLOCKED, DONE, HANDOFF, ABORT |
| progress  | sim         | Inteiro 0–100 |
| blockers  | sim         | `none` ou texto curto |
| next      | sim         | `none` ou texto curto |
| iso       | sim         | PASS, FAIL, SKIP ou UNK |
| note      | não         | Texto curto (máx ~80 caracteres) |

### Códigos de tarefa (task)

| Código | Domínio |
|--------|---------|
| A      | frontend-cliente-estabilizacao |
| B      | frontend-operacao-estabilizacao |
| C      | backend-pedidos-isolamento |
| D      | isolamento-ci |
| E      | polimento-demo |
| META   | visão geral / coordenação |

---

## 3. Regras de ouro

1. **Um domínio = um agente.** Nunca dois agentes no mesmo `claim`.
2. Antes de qualquer código, o agente deve registrar `state:CLAIM` no `COORDENACAO.md`.
3. Ao terminar, emitir `state:DONE` + `iso:PASS` (ou FAIL) no `COORDENACAO.md`.
4. Se estiver bloqueado por decisão de arquitetura → `state:BLOCKED` e texto `aguardando decisão do Líder`.
5. PRs devem ser pequenos e ligados a um único `task`.
6. Isolamento multi-tenant é sagrado. Quebrar teste de isolamento = tarefa inválida.

---

## 4. Onde registrar

- Todo `AR-STATUS` deve ser colado no final da seção **Registro de agentes** do `COORDENACAO.md`.
- O último agente da sessão deve ainda registrar a contagem:

```
## [contagem-sessão] — 2026-09-18
Agentes ativos nesta sessão: X
Meta do dia: fluxo QR completo estável + isolation verde
```

---

## 5. Meta do dia (18/09)

Deixar o fluxo completo de pedido por QR (Cliente → Cozinha → Garçom → Caixa) **estável, funcional e apresentável** + suite `test:isolation` **100% verde**.

Nenhuma feature de growth é permitida nesta sessão.

---

**Fim do protocolo.**
