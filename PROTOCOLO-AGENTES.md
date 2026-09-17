# Protocolo de Coordenação — Agentes de Desenvolvimento

Este documento define como múltiplos agentes de IA devem trabalhar juntos neste repositório sem conflitar entre si, e como novos agentes devem se integrar a qualquer momento.

**Todo agente deve ler este arquivo inteiro antes de tocar em qualquer código.**

---

## 1. Papéis

### Agente Líder

Já está configurado com as decisões e prioridades do dono do projeto.

Responsabilidades:
- Manter o backlog atualizado e priorizado
- Dividir o trabalho em domínios independentes
- Resolver conflitos de decisão e arquitetura
- Revisar e aprovar merges finais na main
- Ser a autoridade final em caso de divergência

Pode trabalhar em código, mas sua prioridade é coordenação e decisões.

### Agentes Trabalhadores

- Executam tarefas específicas dentro de um domínio que reivindicaram.
- Não tomam decisões de arquitetura, prioridade ou design sozinhos.
- Escalam qualquer dúvida ou conflito ao Líder via `COORDENACAO.md`.
- Podem entrar ou sair a qualquer momento (desde que atualizem o status corretamente).

---

## 2. Arquivo central de status: `COORDENACAO.md`

**Localização:** raiz do repositório.

É a única fonte de verdade sobre quem está fazendo o quê.

Todo agente deve:
- Ler o arquivo completo antes de começar
- Atualizar o arquivo antes e depois de cada ação relevante

### Formato obrigatório de cada entrada

```markdown
## [ID-do-agente] — [YYYY-MM-DD HH:MM]

**Papel:** Líder | Trabalhador  
**Domínio reivindicado:** <módulo ou funcionalidade>  
**Arquivos/pastas principais:** <lista>  
**Status:** iniciando | em andamento | bloqueado | aguardando revisão | concluído  
**Branch/worktree:** <nome>  
**Dependências:** <nenhuma | agente-X | módulo-Y>  
**Observações:** <bloqueios, dúvidas para o Líder, handoff, etc.>
```

### Regras de uso do `COORDENACAO.md`

- **Nunca apagar entradas de outros agentes.** Apenas adicione novas ou atualize a sua.
- Antes de reivindicar um domínio, verifique se já não está reivindicado por outro agente com status ≠ concluído.
- Se dois agentes quiserem o mesmo domínio:
  - O mais recente cede e escolhe outra tarefa
  - Ou escala ao Líder
- Atualize o status sempre que mudar de fase (iniciando → em andamento → aguardando revisão → concluído).
- Em caso de bloqueio, marque `bloqueado` e explique claramente na observação.

---

## 3. Isolamento de trabalho

Cada agente deve trabalhar em sua própria branch + worktree. **Nunca diretamente na main.**

```bash
git worktree add ../<projeto>-<agente-id> feature/<dominio>
```

### Regras de isolamento

- Divisão de trabalho deve ser por domínio/módulo/funcionalidade, nunca por arquivo isolado.
- Exemplos bons de domínio: `categorias`, `mesas`, `tema`, `autenticação`, `pedidos`.
- Um agente não pode modificar arquivos de outro domínio sem:
  - Comunicar no `COORDENACAO.md`
  - Ter autorização explícita do dono do domínio ou do Líder
- Evite commits grandes. Prefira commits pequenos e frequentes com mensagens claras.

---

## 4. Protocolo de entrada de um novo agente

Quando um novo agente entra no projeto, deve seguir **rigorosamente** esta ordem:

1. Ler `PROTOCOLO-AGENTES.md` (este arquivo) por completo.
2. Ler `COORDENACAO.md` por completo.
3. Anunciar-se no `COORDENACAO.md` com status `iniciando` antes de reivindicar qualquer domínio.
4. Verificar se existe item claro e livre no backlog.
   - Se não houver tarefa clara:
     - Marcar nas observações: `aguardando atribuição do Líder`
     - **Não começar a codar.**
5. Só então reivindicar um domínio e criar a worktree/branch.

> Dica: Use um ID curto e legível (ex: `agente-a`, `agente-ui`, `agente-backend-1`).

---

## 5. Resolução de conflitos

| Tipo de conflito | Quem resolve | Como proceder |
|---|---|---|
| Conflito de código (merge) | Quem for fazer o merge | Priorizar a branch mais avançada/testada. Em dúvida → escalar ao Líder |
| Conflito de decisão/arquitetura | **Sempre o Líder** | Trabalhador não decide sozinho |
| Sobreposição de domínio | Líder | Agente mais recente cede ou escala |
| Trabalho de outro agente | **Proibido sobrescrever** | Só com comunicação explícita + justificativa no `COORDENACAO.md` |

---

## 6. Commits, Pull Requests e Merge

### Commits

- Pequenos e frequentes
- Mensagens claras no formato: `tipo(domínio): o que foi feito`
- Exemplos: `feat(categorias): adiciona listagem`, `fix(mesas): corrige cálculo de total`

### Antes de pedir merge

- Atualizar status para `aguardando revisão` no `COORDENACAO.md`
- Garantir que o código está testado (pelo menos manualmente)
- Descrever resumidamente o que foi feito nas observações

### Merge

- **Apenas o Líder** aprova e faz merge na `main`
- Após o merge:
  - Marcar a entrada como `concluído`
  - Remover a worktree
  - Deixar um resumo curto do que foi entregue

---

## 7. Handoff e Encerramento

Quando um agente termina uma tarefa (ou precisa sair no meio):

- Atualizar status para `concluído` (ou `bloqueado` se estiver incompleto)
- Escrever um resumo breve do que foi feito e do que ficou pendente
- Listar arquivos principais alterados
- Remover a worktree se a tarefa estiver concluída

Isso permite que qualquer agente futuro (incluindo um substituto) continue o trabalho sem precisar reconstruir o contexto do zero.

---

## 8. Boas práticas adicionais

- Prefira domínios pequenos e bem definidos em vez de reivindicar áreas grandes demais.
- Se descobrir uma dependência de outro domínio, comunique imediatamente no `COORDENACAO.md`.
- Não deixe trabalho "meio pronto" sem documentar o estado atual.
- Em caso de dúvida sobre qualquer regra deste protocolo → **escale ao Líder**.

---

*Última atualização deste protocolo: manter sempre sincronizado com a realidade do projeto.*
