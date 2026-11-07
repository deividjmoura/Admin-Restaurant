# Decisão de arquitetura: desenvolvimento local e portabilidade de hospedagem

- **Data:** 07/11/2026
- **Status:** decisão adotada para orientar o desenvolvimento
- **Projeto:** Admin-Restaurant
- **Repositório de referência funcional:** lanchonete-qr-semi-final

## 1. Decisão

O desenvolvimento do **Admin-Restaurant deve continuar prioritariamente em ambiente local**, sem assumir a Railway, AWS ou qualquer outro provedor como requisito ou destino obrigatório.

A aplicação deve ser construída para ser **portável entre ambientes e provedores de hospedagem**. A escolha da infraestrutura de produção será feita posteriormente, com base nas necessidades reais do produto, nos custos, na operação e nos requisitos de escala.

Em termos práticos:

- Não vamos interromper o desenvolvimento por ainda não possuir um domínio próprio.
- Não vamos migrar para AWS neste momento apenas pela quantidade de serviços disponíveis.
- Não vamos acoplar regras de negócio ou componentes centrais a recursos exclusivos da Railway.
- A Railway pode continuar sendo usada como ambiente provisório de hospedagem/testes quando necessário, mas não será tratada como dependência arquitetural.
- AWS é uma opção futura, não uma decisão de migração já aprovada.
- A mesma regra vale para qualquer outro provedor: a aplicação não deve depender de um fornecedor específico para funcionar.

## 2. Ambientes de trabalho

### 2.1 Desenvolvimento local como ambiente principal

O fluxo normal de desenvolvimento deve funcionar em máquina local, com instruções reproduzíveis para instalar dependências, configurar variáveis, iniciar os serviços necessários, executar migrations e rodar testes.

Sempre que possível, documentar e automatizar a preparação do ambiente para que outro desenvolvedor consiga reproduzi-lo sem depender de uma conta Railway ou AWS.

O ambiente local deve permitir testar, no mínimo:

- aplicação/API e frontend;
- PostgreSQL e migrations;
- autenticação, autorização e sessões;
- resolução de tenant;
- isolamento de dados entre lojas;
- pedidos, cardápio, mesas, cozinha/bar, caixa e demais módulos;
- filas, cache e comunicação em tempo real, usando implementações locais ou substitutos compatíveis quando necessário;
- testes automatizados, incluindo testes negativos de isolamento entre tenants.

### 2.2 Domínios locais e resolução de tenants

A ausência de domínio público próprio não deve bloquear a implementação nem os testes da resolução de tenants.

Podem ser usados hostnames locais, como:

- `admin.localhost`;
- `loja1.localhost`;
- `loja2.localhost`.

A implementação deve permitir que o contexto da loja seja resolvido por hostname/domínio de forma configurável. Os testes também devem cobrir os mecanismos de resolução usados em ambiente local e nos ambientes hospedados.

Não presumir que todos os provedores tratam subdomínios, DNS, TLS ou cabeçalhos de proxy da mesma forma. Essas particularidades devem ficar na configuração e na camada de entrada da aplicação, sem contaminar as regras de negócio.

### 2.3 Hospedagem provisória

O endereço de subdomínio fornecido pela Railway pode ser usado para validar uma implantação hospedada, quando isso for útil. Seu uso não transforma a Railway em requisito do produto.

A validação hospedada deve verificar, entre outros pontos:

- encaminhamento de host e headers de proxy;
- resolução correta do tenant;
- cookies, domínio e atributos de segurança das sessões;
- CORS e URLs públicas;
- conexões e persistência do PostgreSQL;
- SSE/realtime e reconexão;
- uploads e acesso a arquivos;
- execução de migrations e tarefas em segundo plano.

Não afirmar que a aplicação está pronta para qualquer provedor apenas porque funciona localmente ou em uma única implantação Railway. A portabilidade precisa ser verificada em um segundo ambiente antes de ser considerada comprovada.

## 3. Princípios obrigatórios de portabilidade

### 3.1 Configuração por ambiente

- Configurações variáveis devem vir de variáveis de ambiente ou de mecanismos equivalentes de configuração.
- Não inserir URLs, domínios, credenciais, caminhos de arquivos, portas ou identificadores de infraestrutura diretamente nas regras de negócio.
- Manter exemplos de configuração sem segredos, como `.env.example`.
- Validar as configurações obrigatórias na inicialização e falhar com mensagens claras quando estiverem ausentes ou inválidas.
- Separar configuração de desenvolvimento, teste, homologação e produção.

### 3.2 Banco de dados

- PostgreSQL continua sendo o banco de referência, sem dependência de um serviço gerenciado específico.
- A aplicação deve conectar-se por configuração, usando a URL/credenciais fornecidas pelo ambiente.
- Migrations devem ser versionadas e executáveis fora de um fluxo exclusivo de fornecedor.
- Não depender de recursos proprietários de um serviço de banco sem justificativa documentada e alternativa avaliada.
- Rotinas de backup, restauração e migração devem ser documentadas e testáveis.

### 3.3 Cache, filas e tarefas em segundo plano

- Definir contratos/interfaces para cache, filas e execução de tarefas quando esses recursos forem necessários.
- Evitar que módulos de negócio dependam diretamente de APIs específicas de Redis gerenciado, SQS ou outro produto de nuvem.
- Fornecer implementação local adequada para desenvolvimento e testes.
- Se uma implementação em memória for usada como fallback, documentar suas limitações: ela não oferece compartilhamento entre processos/instâncias nem durabilidade.
- Não considerar um fallback local equivalente a uma solução distribuída de produção.
- Garantir idempotência, retry, backoff e tratamento de falhas independentemente do provedor.

### 3.4 Arquivos e objetos

- Não assumir que arquivos enviados pelos usuários devem permanecer no disco efêmero da máquina ou do container.
- Definir uma abstração de armazenamento de objetos/arquivos quando o módulo exigir persistência compartilhada.
- Permitir um adaptador local para desenvolvimento e adaptadores de provedores (por exemplo, S3 ou serviço compatível) sem espalhar chamadas do provedor pelo domínio.
- Preservar autorização, isolamento por tenant, validação de tipo/tamanho e nomes seguros em qualquer implementação.

### 3.5 Realtime e escalabilidade horizontal

- Não presumir que conexões em memória, eventos locais ou sessões de processo único funcionam entre várias instâncias.
- Identificar explicitamente os componentes que precisam de coordenação compartilhada quando houver múltiplas instâncias.
- Manter o contrato de eventos/realtime separado do mecanismo de transporte ou pub/sub escolhido.
- Testar reconexão, duplicidade, perda temporária de conexão e isolamento entre tenants.

### 3.6 Domínios, HTTPS e proxy

- Domínio público, certificados TLS e DNS são responsabilidades de configuração/infraestrutura, não regras de negócio.
- Não codificar o domínio da Railway, um domínio futuro ou um padrão de subdomínio específico.
- Considerar headers de proxy somente quando confiáveis e configurados corretamente.
- Validar cookies seguros, SameSite, CORS, URLs de callback OAuth e URLs públicas por ambiente.
- A estratégia final de domínio (domínio principal, subdomínios por loja ou domínio próprio da loja) será definida na etapa de implantação, sem bloquear o desenvolvimento local.

## 4. Organização recomendada

Manter separadas as seguintes responsabilidades:

1. **Domínio e aplicação:** regras de negócio, casos de uso, autorização e isolamento multi-tenant.
2. **Adaptadores de infraestrutura:** PostgreSQL, cache, filas, armazenamento de arquivos, e-mail e realtime.
3. **Configuração e inicialização:** leitura/validação de variáveis e composição dos adaptadores.
4. **Implantação:** containers/processos, rede, proxy, TLS, DNS, observabilidade e backups.

A separação deve ser proporcional à necessidade real. Não criar abstrações genéricas ou camadas extras sem caso de uso concreto; o objetivo é evitar acoplamento, não construir uma plataforma de abstrações por esporte.

## 5. Estratégia de evolução

### Fase A — Desenvolvimento local confiável

- [ ] Garantir instruções reproduzíveis para subir o projeto localmente.
- [ ] Garantir PostgreSQL local e migrations reproduzíveis.
- [ ] Documentar variáveis de ambiente e exemplos sem segredos.
- [ ] Executar testes automatizados localmente.
- [ ] Testar múltiplos tenants com hostnames locais ou mecanismo de teste equivalente.
- [ ] Corrigir dependências de infraestrutura que hoje só funcionem em um ambiente específico.
- [ ] Documentar limitações de serviços locais em memória.

### Fase B — Preparação para implantação portável

- [ ] Inventariar dependências atuais de Railway e de outros provedores.
- [ ] Remover URLs/domínios e pressupostos de infraestrutura fixos do código.
- [ ] Definir adaptadores somente para capacidades efetivamente usadas.
- [ ] Documentar build, start, health checks, migrations e tarefas operacionais.
- [ ] Documentar persistência de arquivos, logs, secrets, backups e restauração.
- [ ] Criar um procedimento de implantação reproduzível, independente do painel de um fornecedor.

### Fase C — Validação em hospedagem provisória

- [ ] Usar Railway ou outro ambiente disponível como destino de teste, sem tratá-lo como arquitetura obrigatória.
- [ ] Validar tenant por hostname, sessões, cookies, OAuth, CORS e realtime.
- [ ] Validar persistência, migrations, backups e restauração.
- [ ] Registrar limitações e diferenças entre ambiente local e hospedado.

### Fase D — Escolha do provedor de produção

A decisão entre Railway, AWS ou outro provedor deve ocorrer quando houver dados suficientes sobre:

- custo total (compute, banco, armazenamento, tráfego, logs e serviços auxiliares);
- carga esperada e necessidade de escala horizontal;
- disponibilidade, recuperação e backups;
- segurança, controle operacional e requisitos de conformidade;
- complexidade de operação e capacidade de manutenção da equipe;
- serviços gerenciados realmente necessários.

A migração só deve ser aprovada com plano, estimativa de custo, estratégia de rollback e testes de aceitação. Não migrar apenas por preferência ou por disponibilidade de mais serviços.

## 6. Critérios para considerar o projeto portável

A portabilidade não será considerada concluída até que:

- [ ] o projeto possa ser instalado, configurado, iniciado e testado localmente seguindo documentação;
- [ ] nenhuma regra de negócio dependa de domínio ou URL específica de provedor;
- [ ] configurações e segredos sejam externos ao código;
- [ ] banco, migrations e persistência tenham procedimento documentado;
- [ ] dependências de cache, filas, arquivos e realtime estejam identificadas e desacopladas na medida necessária;
- [ ] limitações de implementações locais estejam documentadas;
- [ ] seja possível implantar em pelo menos dois ambientes/provedores distintos sem alterar regras de negócio;
- [ ] testes de isolamento multi-tenant passem nos ambientes relevantes;
- [ ] exista procedimento validado de backup e restauração.

## 7. Limites desta decisão

Esta decisão **não** determina:

- migração imediata para AWS;
- contratação imediata de domínio;
- abandono da Railway como ferramenta provisória;
- adoção obrigatória de Kubernetes, Terraform, Docker ou qualquer serviço específico;
- implementação antecipada de serviços de nuvem que o produto ainda não necessita.

Ferramentas como Docker Compose, infraestrutura como código e serviços gerenciados podem ser avaliadas quando reduzirem esforço ou risco concretos. Não devem ser introduzidas apenas por moda ou para antecipar uma escala que ainda não existe.

## 8. Regra de proteção do repositório de referência

O repositório `deividjmoura/lanchonete-qr-semi-final` permanece **somente como referência funcional** para comparação e levantamento de requisitos.

Esta decisão não autoriza alterações nele. Todo desenvolvimento, correção, refatoração e evolução decorrente desta iniciativa deve ocorrer exclusivamente no `deividjmoura/Admin-Restaurant`, salvo autorização explícita e separada do responsável pelo projeto.

## 9. Instrução para agentes e colaboradores

Antes de implementar mudanças relacionadas a infraestrutura:

1. Leia este documento e a documentação atual do projeto.
2. Inspecione a `main` atual e identifique dependências reais de provedor; não presuma que a situação descrita aqui continua igual.
3. Diferencie dependência arquitetural de configuração de implantação.
4. Prefira a menor alteração que remova acoplamento comprovado.
5. Preserve compatibilidade com o desenvolvimento local.
6. Não introduza serviços pagos ou recursos de nuvem sem necessidade demonstrada e avaliação de custo.
7. Não altere o repositório `lanchonete-qr-semi-final`.
8. Atualize esta decisão e a documentação técnica se uma escolha arquitetural mudar.

**Resumo da decisão:** desenvolver localmente primeiro; manter a aplicação independente de Railway, AWS ou qualquer provedor; usar hospedagem provisória apenas para validações necessárias; escolher a infraestrutura definitiva depois, com evidências de custo, escala, segurança e operação.
