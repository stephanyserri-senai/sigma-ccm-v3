# SIGMA-CCM — Requisitos para revisão dos perfis e do fluxo de manutenção

## Objetivo

Auditar a implementação atual do SIGMA-CCM, sistema de gerenciamento, controle, planejamento e execução da manutenção industrial.

**Não criar tudo do zero sem antes avaliar o projeto existente.** Inspecionar a estrutura, as telas, os componentes, os modelos de dados, as permissões, os fluxos e as integrações já implementados. Em seguida, comparar o que existe com os requisitos deste documento e realizar as alterações necessárias: adicionar funcionalidades ausentes, corrigir funcionalidades incompletas ou incorretas e remover ou consolidar recursos redundantes, obsoletos ou conflitantes.

Preservar a identidade visual e os padrões arquiteturais existentes sempre que forem adequados. Evitar quebrar funcionalidades que já funcionam. Não substituir dados reais por dados fictícios nem implementar ações apenas visuais, sem persistência ou lógica correspondente.

---

## 1. Perfis de usuário

O sistema deve possuir três perfis funcionais principais:

1. **Controle - admin**
2. **Planejamento - pcm**
3. **Execução - campo**

As permissões devem ser aplicadas no frontend e, sempre que a arquitetura permitir, também no backend/API. Ocultar um botão na interface não é suficiente para garantir autorização.

### 1.1. Controle

**Responsabilidade:** administrar as solicitações, acompanhar as ordens de serviço (OS), monitorar prazos e indicadores, garantir rastreabilidade e coordenar o fluxo de trabalho.

Funcionalidades esperadas:

- Dashboard geral da manutenção.
- Visualização de solicitações e ordens de serviço de todos os setores autorizados.
- Cadastro e análise de solicitações.
- Classificação inicial da demanda e definição ou confirmação da prioridade conforme as regras do processo.
- Encaminhamento das solicitações para o Planejamento.
- Acompanhamento do status das OS.
- Identificação de OS atrasadas, bloqueadas, pendentes, em andamento e concluídas.
- Consulta ao cadastro e histórico dos ativos.
- Consulta aos planos preventivos e ao histórico de falhas/intervenções.
- Acompanhamento de equipamentos críticos e falhas recorrentes.
- Validação administrativa dos registros de conclusão e encerramento formal da OS, conforme alçada.
- Devolução de OS incompletas para correção, com justificativa obrigatória.
- Relatórios e indicadores de manutenção.
- Consulta ao histórico de alterações e aos responsáveis por cada etapa.

Indicadores desejáveis:

- Backlog de manutenção.
- Quantidade de solicitações por status, setor, ativo e tipo.
- Cumprimento da programação.
- OS atrasadas e tempo de atraso.
- MTTR (tempo médio para reparo).
- MTBF (tempo médio entre falhas).
- Horas de manutenção.
- Custos, quando houver dados confiáveis disponíveis.
- Reincidência de falhas.
- Distribuição entre manutenção corretiva, preventiva, preditiva e melhoria.

### 1.2. Planejamento

**Responsabilidade:** transformar a demanda em um serviço preparado, com escopo, recursos, materiais, procedimentos, duração e programação definidos.

Funcionalidades esperadas:

- Visualizar solicitações encaminhadas ao Planejamento e OS relevantes para sua atuação.
- Analisar tecnicamente a demanda.
- Definir ou complementar o tipo de manutenção: corretiva, preventiva, preditiva ou melhoria.
- Definir escopo, etapas e tarefas do serviço.
- Solicitar inspeção ou diagnóstico complementar quando necessário.
- Estimar duração e mão de obra.
- Definir especialidades e equipe necessárias.
- Listar materiais, peças sobressalentes, ferramentas, instrumentos e equipamentos especiais.
- Consultar disponibilidade de materiais em estoque, caso exista módulo de estoque integrado.
- Registrar materiais indisponíveis e necessidades de compra ou contratação.
- Anexar desenhos, diagramas elétricos, manuais, procedimentos e documentos técnicos.
- Identificar requisitos de segurança, incluindo bloqueio e etiquetagem (LOTO), APR, permissão de trabalho e demais liberações aplicáveis.
- Definir critérios técnicos de aceitação e checklists, quando necessários.
- Programar datas previstas de início e término.
- Distribuir atividades por equipe e turno, conforme os recursos disponíveis.
- Considerar janelas de parada e restrições operacionais.
- Reprogramar serviços, registrando motivo e histórico da alteração.
- Indicar se a OS está pronta para execução ou se possui pendências.
- Liberar a OS para execução somente quando os requisitos definidos pelo processo estiverem atendidos.

O Planejamento deve poder consultar a disponibilidade de recursos e o estado da OS, mas não deve registrar a execução no lugar dos técnicos.

### 1.3. Execução

**Responsabilidade:** realizar a manutenção com segurança e registrar o trabalho efetivamente executado.

A interface deve ser objetiva e prática para uso em computador, tablet ou celular, quando o projeto oferecer suporte responsivo.

Funcionalidades esperadas:

- Visualizar as OS atribuídas ao profissional ou à equipe, além das OS para as quais tenha autorização explícita.
- Consultar prioridade, TAG, equipamento, localização, prazo e descrição do serviço.
- Consultar tarefas, procedimento, desenhos, diagramas, materiais previstos e requisitos de segurança.
- Registrar início, pausas e término do serviço.
- Registrar tarefas executadas e seu resultado.
- Registrar horas efetivamente trabalhadas e profissionais envolvidos.
- Registrar materiais e peças efetivamente utilizados, sem confundir quantidades planejadas com quantidades reais.
- Registrar medições, testes, valores obtidos e critérios de aprovação, conforme o tipo de serviço.
- Preencher checklists de inspeção e conclusão.
- Anexar fotos antes e depois, relatórios, documentos e evidências.
- Informar falha encontrada, causa identificada ou provável e solução aplicada.
- Registrar anomalias adicionais encontradas.
- Informar falta de material, indisponibilidade de recurso, risco ou outro impedimento.
- Solicitar alteração de programação ou apoio quando necessário.
- Informar se o equipamento foi testado e se está apto para retorno à operação, conforme a autorização aplicável.
- Registrar pendências e recomendar nova intervenção ou melhoria.
- Encaminhar a OS para validação/encerramento; a conclusão técnica não deve significar automaticamente encerramento administrativo se o fluxo exigir validação.

O perfil Execução não deve alterar unilateralmente o planejamento aprovado, a prioridade global ou as permissões de usuários. Deve poder registrar impedimentos e solicitar mudanças, mantendo rastreabilidade.

---

## 2. Menus e navegação sugeridos por perfil

Verificar os menus atuais e adequá-los aos módulos já existentes. Não criar duplicatas de funcionalidades com nomes diferentes.

### Controle

- Dashboard
- Solicitações
- Ordens de serviço
- Ativos / equipamentos
- Planos de manutenção
- Indicadores
- Relatórios
- Histórico / auditoria

### Planejamento

- Backlog de manutenção
- Solicitações para análise
- Planejamento de OS
- Programação semanal / calendário
- Equipes e recursos
- Materiais e peças
- Planos preventivos
- Documentos e procedimentos técnicos

### Execução

- Minhas ordens de serviço
- Agenda de serviços
- Detalhes da OS
- Checklists
- Apontamento de horas
- Materiais utilizados
- Medições e testes
- Fotos e evidências
- Impedimentos e pendências
- Conclusão técnica

Os menus devem respeitar as permissões reais do usuário. Se houver outros papéis técnicos ou administrativos já implementados, avaliar compatibilidade antes de removê-los ou consolidá-los.

---

## 3. Fluxo do serviço

Implementar ou revisar o fluxo de ponta a ponta, preservando o histórico das transições.

1. **Solicitação registrada:** a demanda é criada com descrição, solicitante, ativo/localização e data.
2. **Análise pelo Controle:** a demanda é conferida, classificada e encaminhada.
3. **Planejamento:** são definidos escopo, tarefas, recursos, materiais, procedimentos, riscos e datas previstas.
4. **Verificação de prontidão:** são conferidas as condições necessárias para execução.
5. **Programação e liberação:** a OS é programada e disponibilizada para a equipe executora.
6. **Execução:** os técnicos registram etapas, horas, materiais reais, medições, testes e evidências.
7. **Conclusão técnica:** a equipe informa o que foi realizado, a condição do equipamento e eventuais pendências.
8. **Validação:** o responsável autorizado verifica os registros e aprova ou devolve a OS com justificativa.
9. **Encerramento:** a OS é encerrada quando os requisitos definidos forem atendidos.
10. **Histórico e melhoria:** os dados alimentam o histórico do ativo, os indicadores e o planejamento futuro.

### Regras de fluxo

- Cada OS deve possuir status explícito e transições válidas.
- Impedir saltos de etapas que violem o processo configurado.
- Não permitir execução de OS ainda não liberada, salvo exceção formal e rastreável prevista no sistema.
- Uma OS devolvida deve registrar o motivo e o responsável pela devolução.
- Impedimentos devem poder ser registrados sem apagar o trabalho já realizado.
- Reprogramações devem manter datas anteriores, novas datas, motivo e responsável.
- Registrar usuário, data/hora e alteração nas transições relevantes.
- Evitar encerramento com campos obrigatórios ausentes.
- Não considerar automaticamente o equipamento operacional apenas porque a OS foi marcada como concluída.
- Permitir retorno ao Planejamento quando o serviço precisar de novos recursos, escopo ou programação.

Os nomes exatos dos status podem seguir os padrões já usados no projeto, desde que o significado e as regras estejam claros. Uma sequência possível é: `Solicitada`, `Em análise`, `Aguardando planejamento`, `Em planejamento`, `Aguardando material/recurso`, `Programada`, `Liberada para execução`, `Em execução`, `Bloqueada/Impedida`, `Aguardando validação`, `Devolvida para ajuste` e `Encerrada`.

---

## 4. Matriz inicial de permissões

Use esta matriz como referência e adapte-a às regras já existentes no sistema.

| Ação | Controle | Planejamento | Execução |
|---|---|---|---|
| Consultar todas as OS do escopo autorizado | Sim | Conforme necessidade/permissão | Não; apenas atribuídas/autorizadas |
| Cadastrar solicitação | Sim | Se autorizado | Se autorizado |
| Analisar e classificar demanda | Sim | Análise técnica | Informar anomalia/criticidade percebida |
| Definir prioridade inicial | Sim, conforme regra | Recomendar ajuste técnico | Solicitar revisão |
| Definir escopo e tarefas | Consultar | Sim | Consultar |
| Planejar recursos e materiais | Consultar | Sim | Consultar |
| Programar e reprogramar | Acompanhar/autorizar conforme alçada | Sim, com registro | Solicitar alteração |
| Liberar OS para execução | Conforme regra de alçada | Sim, se designado no processo | Não |
| Iniciar e registrar execução | Consultar | Consultar | Sim, em OS autorizadas |
| Registrar horas e materiais reais | Consultar | Consultar | Sim |
| Anexar evidências e resultados | Consultar | Consultar | Sim |
| Concluir tecnicamente | Validar conforme alçada | Validar tecnicamente se designado | Solicitar conclusão |
| Devolver OS para correção | Sim, conforme alçada | Se designado | Não; pode registrar necessidade de correção |
| Encerrar administrativamente | Sim, conforme alçada | Não, salvo regra explícita | Não |
| Consultar indicadores globais | Sim | Indicadores de planejamento | Dados de execução autorizados |
| Gerenciar usuários/perfis | Somente se também possuir permissão administrativa | Não por padrão | Não por padrão |

**Importante:** o perfil funcional Controle não deve receber automaticamente privilégios de administrador do sistema. Administração de usuários, configurações globais e permissões deve ser uma autorização separada, caso essa funcionalidade exista.

---

## 5. Dados essenciais da ordem de serviço

Verificar se o modelo de dados e os formulários cobrem os campos abaixo. Reutilizar os campos existentes quando forem equivalentes; evitar duplicações.

### Identificação e solicitação

- Número/identificador único da OS.
- Tipo de manutenção.
- Prioridade e justificativa, quando aplicável.
- Status atual.
- Solicitante e data da solicitação.
- Descrição do problema ou serviço solicitado.
- Ativo, TAG, setor e localização.
- Impacto operacional, quando informado.

### Planejamento

- Escopo e descrição técnica do serviço.
- Etapas/tarefas.
- Duração estimada.
- Datas previstas de início e término.
- Equipe, profissionais e especialidades necessárias.
- Materiais e quantidades planejadas.
- Ferramentas, instrumentos e equipamentos especiais.
- Documentos, desenhos, diagramas e procedimentos.
- Requisitos de segurança e liberações necessárias.
- Critérios de aceitação e checklists.
- Pendências que impedem a execução.

### Execução

- Profissionais envolvidos.
- Data/hora real de início e término.
- Pausas e impedimentos, quando aplicável.
- Horas trabalhadas.
- Tarefas executadas e resultados.
- Materiais/peças efetivamente utilizados e quantidades reais.
- Medições, testes, valores e resultados.
- Fotos, anexos e evidências.
- Falha encontrada, causa identificada/provável e solução aplicada.
- Anomalias adicionais.
- Condição final do equipamento.
- Pendências e recomendações.

### Validação, encerramento e auditoria

- Responsável pela validação.
- Data/hora da validação e do encerramento.
- Resultado da validação: aprovado ou devolvido.
- Justificativa de devolução.
- Confirmação de atendimento dos requisitos técnicos aplicáveis.
- Histórico de status e alterações.
- Usuário responsável por cada alteração e data/hora.
- Motivo de cancelamento, se houver.

Campos específicos podem ser obrigatórios apenas para determinados tipos de serviço. Não exigir dados que não se aplicam a todas as OS.

---

## 6. Indicadores e cálculos

Verificar se os indicadores já existentes usam definições coerentes, filtros claros e dados suficientes. Não exibir métricas como confiáveis se faltarem dados ou se o cálculo não estiver implementado.

- **Backlog:** volume de serviços pendentes, preferencialmente expresso também em horas estimadas quando esses dados estiverem disponíveis.
- **Cumprimento da programação:** proporção de serviços programados concluídos no período conforme a regra de medição adotada.
- **MTTR:** tempo médio de reparo, com regra documentada para definir início, término e quais eventos entram no cálculo.
- **MTBF:** tempo médio entre falhas, calculado apenas quando houver histórico de falhas e tempo de operação adequados.
- **Atrasos:** OS com prazo vencido e ainda não encerradas, considerando pausas ou suspensões conforme regra definida.
- **Horas de manutenção:** horas registradas, com distinção entre estimadas e reais.
- **Custos:** somente quando existirem dados válidos de materiais, mão de obra e/ou serviços.
- **Reincidência:** repetição de falhas no mesmo ativo, considerando critérios configuráveis de período e classificação.

Os dashboards devem permitir filtros pertinentes, como período, setor, ativo, tipo de manutenção, prioridade, status e equipe, conforme os dados existentes.

---

## 7. Requisitos de interface e experiência do usuário

- Manter a identidade visual existente do SIGMA-CCM.
- Garantir que cada perfil veja primeiro as ações mais relevantes para seu trabalho.
- Usar linguagem consistente para menus, botões, status e campos.
- Mostrar status, prioridades, prazos e pendências de forma clara.
- Disponibilizar busca e filtros úteis nas listas de OS.
- Oferecer detalhes da OS sem obrigar o usuário a navegar por várias telas desnecessárias.
- Validar formulários e mostrar mensagens de erro claras.
- Solicitar justificativa para ações críticas, como devolução, cancelamento ou reprogramação.
- Confirmar ações destrutivas e evitar perda acidental de dados.
- Preservar responsividade, acessibilidade básica e padrões visuais do projeto.
- Se houver suporte móvel, facilitar o registro rápido de horas, checklists e fotos.
- Evitar botões decorativos ou funcionalidades sem ação real.
- Garantir persistência dos dados e atualização correta após criar ou editar registros.
- Exibir estados de carregamento, erro, vazio e sucesso conforme os padrões do projeto.

---

## 8. Segurança, integridade e rastreabilidade

- Aplicar autorização por perfil e por escopo de acesso.
- Não confiar apenas em validações do frontend.
- Validar no backend as operações protegidas, se houver backend.
- Não permitir que usuários alterem registros fora de sua autorização.
- Registrar transições de status e mudanças críticas.
- Preservar histórico de alterações, inclusive em reprogramações e devoluções.
- Evitar exclusão definitiva de OS com histórico operacional; preferir cancelamento ou arquivamento rastreável, conforme arquitetura.
- Proteger anexos e documentos de acordo com as permissões do usuário.
- Não expor informações sensíveis em logs ou mensagens de erro.
- Seguir os mecanismos de autenticação e autorização já utilizados pelo projeto.

---

## 9. Orientações para realizar a auditoria no código

Execute o trabalho nesta ordem:

### Etapa A — Inspeção

1. Examine a estrutura do repositório, documentação, rotas, páginas, componentes, serviços, modelos de dados e mecanismos de autenticação/autorização.
2. Identifique a tecnologia e a arquitetura realmente utilizadas, sem presumir frameworks ou bibliotecas.
3. Localize todas as funcionalidades existentes relacionadas a Controle, Planejamento, Execução, solicitações, OS, ativos, materiais, programação, indicadores e usuários.
4. Identifique telas duplicadas, componentes reutilizáveis, campos existentes, regras de status e integrações.
5. Verifique o que tem persistência real e o que é apenas mock, dado estático ou interface sem comportamento.

### Etapa B — Comparação e diagnóstico

Compare a implementação com os requisitos deste documento. Monte uma lista de auditoria interna com:

- **Atendido:** funciona e atende ao requisito.
- **Parcial:** existe, mas precisa de ajuste.
- **Ausente:** precisa ser implementado.
- **Conflitante/Redundante:** precisa ser corrigido, consolidado ou removido.
- **Não aplicável:** justifique brevemente.

Priorize falhas de segurança, permissões, integridade de dados e transições inválidas antes de melhorias cosméticas.

### Etapa C — Implementação

1. Faça as alterações necessárias no código existente.
2. Reutilize componentes, padrões e serviços quando fizer sentido.
3. Implemente as regras de negócio também na camada responsável pela persistência/autorização, quando aplicável.
4. Atualize formulários, navegação, validações, estados e mensagens.
5. Ajuste os modelos e migrações de dados somente quando necessário.
6. Remova ou consolide recursos redundantes apenas após verificar dependências e impactos.
7. Não apague dados ou funcionalidades úteis sem justificativa.
8. Não invente integrações externas nem afirme que uma integração funciona sem verificá-la.
9. Se um requisito depender de um módulo inexistente (por exemplo, estoque), implemente apenas se isso estiver dentro do escopo e da arquitetura atual; caso contrário, sinalize a dependência e apresente uma integração clara, sem simular disponibilidade real.

### Etapa D — Testes

- Execute os testes automatizados existentes.
- Execute lint, checagem de tipos e build, se houver comandos configurados.
- Teste o acesso de cada perfil e as restrições entre perfis.
- Teste o ciclo completo de uma OS, desde a solicitação até o encerramento.
- Teste devolução para ajuste, impedimentos, reprogramação e campos obrigatórios.
- Verifique que alterações persistem após recarregar a página.
- Verifique erros de console, falhas de API e regressões nas telas existentes.
- Não declare testes aprovados se não tiver executado os comandos correspondentes.

### Etapa E — Relatório final

Ao terminar, apresente um resumo com:

1. O que foi encontrado na implementação original.
2. O que foi alterado, adicionado, removido ou consolidado.
3. Arquivos principais modificados.
4. Regras de negócio e permissões implementadas.
5. Testes executados e respectivos resultados.
6. Pendências, limitações e dependências que não puderam ser concluídas.
7. Requisitos deste documento que continuam ausentes ou parciais.

---

## 10. Critérios de aceite

A revisão será considerada concluída quando:

- [ ] Os três perfis tiverem responsabilidades e menus coerentes.
- [ ] As permissões forem aplicadas de forma consistente, sem depender apenas de ocultar elementos visuais.
- [ ] O fluxo da OS permitir avançar pelas etapas válidas e impedir transições indevidas.
- [ ] O Planejamento registrar escopo, recursos, materiais, datas e requisitos aplicáveis.
- [ ] A Execução registrar dados reais, horas, materiais, testes e evidências.
- [ ] A conclusão técnica e o encerramento administrativo estiverem claramente diferenciados quando necessário.
- [ ] Devoluções, impedimentos e reprogramações mantiverem justificativa e histórico.
- [ ] Os dados alimentarem corretamente o histórico dos ativos e os indicadores que estiverem implementados.
- [ ] Não houver telas ou botões críticos que aparentem funcionar sem executar a ação correspondente.
- [ ] A implementação existente continuar funcionando, sem regressões conhecidas.
- [ ] Os testes possíveis tiverem sido executados e seus resultados forem informados com transparência.
- [ ] O relatório final identificar claramente o que ainda depender de decisão, integração ou desenvolvimento adicional.

## Instrução final

**Comece inspecionando o projeto atual e produza um diagnóstico antes de modificar arquivos. Depois, implemente as mudanças necessárias com base neste documento.** Não reescreva o sistema inteiro por padrão. Preserve o que já está correto, corrija o que está inadequado, acrescente o que falta e remova somente o que for realmente redundante ou conflitante. Ao final, informe exatamente o que foi feito e o que permanece pendente.
