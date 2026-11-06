# Salas de 2 a 8 pessoas

## Ativar

No SQL Editor do Supabase, execute `supabase/migrations/202611060007_room_capacity.sql` uma vez, depois das migrations anteriores, inclusive a `006`. Não é necessário mudar variáveis do Cloudflare nem publicar uma Edge Function para esta alteração.

Atualize o site e mova o slider **Limite de pessoas** antes de clicar em **Criar sala**. O padrão é 2; o número inclui o criador. O limite fica salvo no banco e é conferido em cada entrada, com bloqueio da linha da sala para serializar admissões concorrentes. Quem entra por convite usa o limite definido pelo criador. Salas existentes e clientes antigos continuam com 5 vagas. O limite fica fixo durante a vida da sala.

## Indicador de recursos

O indicador é qualitativo: baixo (2–3 pessoas), moderado (4–5), alto (6–8). Não é medição de CPU, memória ou percentual de uso dos serviços.

Com uma transmissão de vídeo a 3 Mbps e a sala cheia, o upload de vídeo do transmissor pode chegar aproximadamente a `(pessoas - 1) × 3 Mbps`: 3 Mbps para duas pessoas e 21 Mbps para oito. Áudio, protocolos e retransmissões somam tráfego. A adaptação nativa e o bitrate configurado podem diminuir esse valor. Não há garantia de qualidade com sete espectadores sem medir a máquina e sua conexão. TURN, quando usado, transporta a mídia pelo relay e pode ter custo próprio.

Pulses de associação usam 20 segundos para o transmissor e 30 para espectadores: aproximadamente `180 + 120 × (pessoas - 1)` RPCs por hora com a sala cheia e um transmissor, em conexão estável. Não inclui criação, entrada, troca de transmissor, avisos, ações administrativas, autenticação ou reconexões. Não representa a contagem de mensagens Realtime nem uma previsão de cobrança. Vagas não preenchidas não criam recursos por conta própria.

Supabase continua transportando somente autorização, presença e sinalização; arquivos e mídia não são gravados. Cada mensagem Broadcast é contabilizada por envio e destinatários inscritos, conforme a [documentação de uso Realtime](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages). A implementação conserva tópicos por remetente para garantir a identidade com RLS: membros podem receber mensagens destinadas a outros participantes. O cliente agora descarta esses eventos antes da validação detalhada; isso reduz processamento local, não o número de entregas cobradas.

Cloudflare Pages continua servindo um build estático, sem Workers ou Pages Functions. As requisições estáticas têm tratamento diferente das Functions, conforme a [documentação do Cloudflare](https://developers.cloudflare.com/pages/functions/pricing/). Assets com hash recebem cache de um ano com `immutable`; HTML mantém a política padrão para descobrir novas versões. Esse cache reduz downloads repetidos, sem prometer economia medida de fatura.

## Ajustes desta versão

- A entrada já devolve um snapshot autorizado. A sessão o reutiliza em vez de executar imediatamente outro pulse. Se a preparação de ICE/TURN demorar dez segundos ou mais, revalida antes de prosseguir.
- Callbacks de presença são emitidos somente quando o estado online muda.
- Eventos de sinalização para outros destinatários são descartados antes de validar SDP/ICE.
- Mantidos: um único ciclo de manutenção local, reconciliação espaçada, retries com espera, canais reutilizados, SDK e painel administrativo sob demanda, getStats desativado nos espectadores sem diagnóstico, nenhuma prévia ou processamento de frames no transmissor, saída em dez minutos para espectadores em segundo plano e limpeza ao sair.

## Validação

Testes SQL cobrem capacidades 2 e 8, recusa de capacidade inválida e de participantes excedentes, RLS e compatibilidade com RPCs antigas. Testes simulados de WebRTC cobrem sete peers usando a mesma track de captura e fechando conexões. Isso não substitui testar oito computadores reais.

Teste manual: crie uma sala de duas vagas e tente uma terceira entrada; depois crie uma de oito, conecte oito identidades em navegadores/perfis separados e tente uma nona. Teste entradas simultâneas na última vaga, saída, reentrada e troca de transmissor. Faça também a validação em redes diferentes, com diagnóstico de RTT/bitrate e uso medido no Gerenciador de Tarefas. Confira Usage/Realtime no Supabase antes e depois, com a mesma ocupação e duração.
