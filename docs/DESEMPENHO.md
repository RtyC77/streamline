# Revisão de consumo — 6 de novembro de 2026

Esta revisão reduz trabalho mensurável no código. Não foi medido o uso real de CPU/GPU/RAM no PC do usuário nem a fatura de produção. O orçamento é manter captura nativa 720p30, áudio da fonte selecionada, autorização privada e reconexão.

## Resultados reproduzíveis

| Trabalho                                        | Antes                           | Depois                                                  |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| Pulse por espectador estável                    | 360/h                           | 120/h                                                   |
| Pulse por transmissor estável                   | 360/h                           | 180/h                                                   |
| Sala estável, transmissor + quatro espectadores | 1.800/h                         | 660/h (63,3% menos)                                     |
| Cinco usuários em espera                        | 1.800/h                         | 600/h (66,7% menos)                                     |
| getStats no espectador, diagnóstico fechado     | A cada 5 s/peer                 | Nenhum                                                  |
| getStats no transmissor, diagnóstico fechado    | A cada 5 s/peer                 | A cada 10 s/peer conectado/em negociação                |
| getStats com diagnóstico aberto                 | A cada 5 s                      | A cada 5 s, sob demanda                                 |
| Renderizações por snapshot idêntico             | Uma atualização de estado/pulse | Nenhuma atualização de estado                           |
| Vídeo saudável, teto por espectador             | Subia de 3 até 4 Mbps           | Permanece em 3 Mbps; reduz até 2,5 sob congestionamento |
| JS inicial de produção, gzip                    | Cerca de 142 kB                 | Cerca de 74,3 kB (48% menos)                            |

Chamadas extraordinárias de entrada/saída, start/stop, reconexão, mudança de sala e renovação TURN não estão nessas contas horárias. São limites calculados por cadência e verificados com relógio simulado. Não representam percentuais comprovados de redução de fatura ou CPU.

O SDK Supabase (~59,6 kB gzip) só é carregado ao iniciar uma entrada/criação; a sala (~10,4 kB gzip) só é carregada depois da autorização. Quem entra na sala acaba baixando os chunks necessários: houve redução do carregamento inicial, não eliminação do SDK.

## Mudanças de funcionamento

- Um único ciclo leve de manutenção local de 5 s coordena tentativas, recuperação e diagnóstico. Essa manutenção local não chama o banco em cada ciclo.
- Pulses a cada 20 s no transmissor e 30 s no espectador respeitam a concessão atual de transmissão de 35 s e associação de 60 s. Não é seguro retirar toda reconciliação enquanto esses contratos existem.
- Falhas usam retries de 5, 10, 20 e até 30 s, com uma chamada por vez. Pulses de inicialização duplicados são suprimidos.
- Snapshots são comparados por conteúdo, incluindo apelidos, membros, geração e sessão; ordem diferente dos membros não obriga rerender. Estados de mídia idênticos também não são reemitidos.
- Sem peers, não há getStats. Espectadores só o executam ao abrir diagnóstico. O transmissor mantém amostragem mais lenta para congestionamento e o controle nativo WebRTC continua ativo.
- Sair remove canais, contadores, timers, peers e tracks; se não restar canal de outra sessão, o WebSocket Realtime é desconectado explicitamente.
- A saída de espectadores após dez minutos em segundo plano e a exceção do transmissor foram preservadas.

A redução de polling pode atrasar a reconciliação quando um evento se perde: até 30 s em condições normais, mais o tempo da requisição. Presence e avisos antecipam mudanças. Após 30 s sem pulse do transmissor ou 55 s do espectador, a mídia é liberada e a conexão é marcada como interrompida; a renovação no servidor continua sendo a autoridade.

## Migration adicional no Supabase

Execute **somente** `supabase/migrations/202611060003_reduce_room_churn.sql` no SQL Editor para um projeto que já tem as duas migrations anteriores. O frontend funciona sem ela, com menor velocidade para descobrir entradas e mais reassinaturas de canal.

A migration preserva a geração dos tópicos ao adicionar um participante. A remoção/expiração de associação continua rotacionando os tópicos para limitar o cache de autorização. Também corrige o caso em que a limpeza ocorria durante uma entrada recusada: a geração agora é rotacionada antes desse retorno.

Uma entrada bem-sucedida envia apenas um aviso privado vazio a um tópico já conhecido. Os clientes recebem o aviso, agrupam a atualização e relêem o estado autorizado no banco. Não se transmite a lista de membros nem se confia em snapshots fornecidos por clientes.

Não foi aplicada esta migration ao projeto Supabase real nesta revisão: requer execução pelo proprietário no SQL Editor. Os testes SQL executam a função real em PGlite e substituem apenas o transporte `realtime.send`; o comportamento do Realtime gerenciado ainda requer verificação.

## Manutenção e validação real

Ative a integração Cron no Supabase e execute `supabase/maintenance.sql` uma vez para remover salas expiradas e usuários anônimos antigos elegíveis. Criar essa consulta no repositório não agenda a tarefa automaticamente.

Compare o painel Usage/Realtime antes e depois com o mesmo número de usuários e a mesma duração. Em dois PCs e depois em cinco, confira entrada tardia, saída abrupta, reconexão, troca de transmissor, áudio da fonte, refresh de token e TURN. Use o Gerenciador de Tarefas do Windows para medir CPU/GPU/RAM e FPS do jogo; a aplicação não inventa essas métricas.

## Documentação consultada

- [Supabase Presence: evitar atualizações frequentes](https://supabase.com/docs/guides/realtime/presence)
- [Autorização dos canais e cache de políticas](https://supabase.com/docs/guides/realtime/authorization)
- [Broadcast do banco para avisos de mudança](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Contabilização de mensagens e fan-out](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
- [Parâmetros do encoder WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
