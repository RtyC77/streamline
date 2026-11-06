# Até três telas, uma recebida ao vivo

## Ativar no Supabase

Execute `supabase/migrations/202611060008_multi_stream.sql` no SQL Editor uma vez, depois de todas as migrations anteriores (001 a 007). A migration adiciona `room_streams`, RLS e concessões independentes. Uma transmissão ativa anterior é migrada se sua associação ainda estiver válida. Após aplicar, todos devem atualizar o site; clientes antigos usam o protocolo de uma única tela e não são compatíveis com a seleção múltipla.

Não há novas variáveis de ambiente, chaves, Edge Functions ou serviços. O frontend continua estático no Cloudflare Pages.

## Usar

- Clique em **Compartilhar jogo**, selecione 480p ou 720p e 24 ou 30 FPS e, depois, clique em **Escolher janela e compartilhar**. A captura é solicitada nesse segundo clique para respeitar o gesto obrigatório do navegador.
- Cada usuário pode compartilhar uma janela; a sala admite até três transmissores. O banco bloqueia a linha da sala ao conceder uma transmissão, impedindo que solicitações concorrentes ultrapassem três.
- Clique na miniatura da pessoa para assistir. Apenas a tela selecionada tem vídeo e áudio recebidos continuamente. Compartilhar sua janela não impede assistir a outra pessoa.
- Ao trocar de tela, o player salva uma imagem do último quadro disponível e fecha o receptor anterior. O transmissor recebe `unwatch` para fechar o envio correspondente. A sessão UUID e o identificador da conexão impedem uma mensagem antiga de fechar um receptor novo.
- As outras miniaturas ficam borradas e estáticas. Quando nunca assistidas, recebem o primeiro quadro disponível capturado pelo transmissor no início daquela sessão. As imagens não são atualizadas periodicamente.

## Prévias e limites

Para cumprir o requisito do primeiro quadro, há uma captura pontual em canvas, em 320 × 180, JPEG com qualidade 0,45 e limite de 60 mil caracteres. Há outra captura pontual ao abrir/sair de uma tela. Não existe loop de extração de frames, canvas intermediário no vídeo, gravação nem upload de imagens ao Supabase.

A imagem inicial vai por um RTCDataChannel negociado e criptografado, em uma conexão P2P temporária sem trilhas de mídia. Cada receptor busca somente uma prévia por vez, confirma a entrega e libera a conexão. O timeout de 15 segundos é conferido pela manutenção local já existente. A imagem é guardada somente na memória e descartada quando a transmissão termina ou o usuário sai. Cada sessão tem um UUID novo para não reutilizar quadros antigos.

Se o navegador não entregar um quadro dentro de três segundos, se a imagem exceder o limite ou se a rota P2P falhar, mostramos **Prévia indisponível**. Selecionar a tela ainda tenta estabelecer o vídeo normal. O app não inventa uma imagem. TURN continua necessário nas redes em que P2P direto falha, inclusive para os DataChannels de prévia. Essa negociação inicial tem custo de sinalização e CPU: imagens congeladas eliminam o recebimento contínuo das telas não escolhidas, mas não são gratuitas para obter pela primeira vez.

## Qualidade e consumo

| Perfil | Resolução desejada | FPS desejados | Teto inicial de vídeo por espectador | Piso do ajuste do teto |
|---|---|---|---|---|
| 480p | 854 × 480 | 24 ou 30 | 1,2 Mbps | 0,4 Mbps |
| 720p | 1280 × 720 | 24 ou 30 | 3 Mbps | 0,8 Mbps |

Resolução, FPS e bitrate são preferências/limites pedidos pela captura e pelo RTCRtpSender. O navegador preserva proporção, negocia codecs e pode entregar valores diferentes; a adaptação nativa pode usar bitrate ainda menor. O controle adicional reduz o teto em congestionamento e o recupera gradualmente. Não há ampliação de uma captura menor.

H.264 e Opus continuam preferidos, sem prometer aceleração de hardware. Por padrão, áudio é permitido somente para uma aba do navegador. Ao marcar **Compartilhar áudio do sistema**, janelas e tela inteira também podem transmitir o áudio fornecido pelo navegador, incluindo outros aplicativos. Sem essa opção, essas trilhas são removidas. Microfone nunca é solicitado automaticamente. Consulte [AUDIO.md](AUDIO.md).

## Uso do Supabase

- Um cliente Supabase e um WebSocket Realtime por participante, reutilizados por todas as transmissões. Nenhum canal ou socket adicional por tela. Os tópicos privados por remetente continuam necessários para autorizar a identidade através de RLS; um WebSocket multiplexa esses tópicos.
- Todas as concessões da sala vêm no mesmo snapshot e heartbeat de associação. Um transmissor renova sua própria concessão a cada 20 segundos; espectadores renovam associação a cada 30 segundos. Não há um polling por transmissão.
- A troca de tela usa sinalização, sem RPC de banco para escolher o player. Ofertas/respostas e candidatos continuam passando pelo Realtime; candidatos ICE são agrupados em lotes de até 16, com janela de 150 ms, reduzindo o número de envios durante negociações.
- Prévia, vídeo, áudio, quadros congelados, volume e diagnóstico não passam pelo Supabase. Estatísticas continuam locais; getStats fica desativado em receptores sem diagnóstico e em conexões de prévia.
- Sem espectadores ao vivo, as trilhas locais ficam desabilitadas; o primeiro quadro já está em memória. Sair, expulsar e finalizar sala removem as concessões por cascade, e os clientes liberam os recursos ao reconciliar.

Três transmissores geram mais estado/sinalização do que um. Não foi medida redução de fatura, CPU ou RAM. A contagem de mensagens Realtime inclui destinatários inscritos: [documentação do Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages). Mantivemos o cache dos assets com hash e o carregamento sob demanda, sem adicionar execução de servidor no Cloudflare.

## Testes reproduzíveis

Execute `npm test`, `npm run test:db` e `npm run build`. A suíte SQL primeiro valida as migrations anteriores e, em seguida, aplica a 008 e verifica upgrade de uma transmissão ativa, três concessões, bloqueio de uma quarta, revogação, expiração, RLS, saída e encerramento administrativo. PGlite substitui somente os contratos de Auth/Realtime para essa verificação SQL; não comprova o transporte Realtime hospedado.

Para exercitar RTCPeerConnection e RTCDataChannel nativos, execute `npm run dev` e abra `http://127.0.0.1:5173/tests/browser/multi-webrtc.html`. O teste cria quatro identidades locais e três fontes de vídeo sintético exclusivamente no harness de teste. Verifica primeiros quadros, transferência das duas prévias, troca entre as três telas, recepção de uma tela por vez, compartilhamento e recepção simultâneos, lotes ICE e fechamento de conexões. Os arquivos em `tests/browser/` não entram no build publicado. O teste UI de opções fica em `/tests/browser/share-options.html`.

Nesta revisão: 79 testes Vitest e 126 verificações SQL passaram; build aprovado. No navegador, 13 verificações com WebRTC/DataChannel nativos passaram, com zero avisos; a seleção de 480p24 também foi conferida visualmente. Isso usa o mesmo navegador/máquina e fontes sintéticas, sem Supabase gerenciado, áudio audível, jogo real ou rede entre PCs. Não declara validados NAT, TURN ou desempenho durante jogos.

## Checklist manual pendente

1. Em sala com pelo menos quatro pessoas, inicie três jogos em três computadores e confirme que a quarta transmissão é recusada. Teste também dois pedidos concorrentes na última vaga.
2. No quarto PC, alterne entre as telas; confirme o som somente da tela selecionada e que as outras miniaturas permanecem congeladas/borradas. Antes de assistir a uma tela, confira sua prévia inicial.
3. Confirme no diagnóstico/devtools que existe um único receptor contínuo por pessoa e que as conexões temporárias de prévia desaparecem. Depois, teste duas pessoas transmitindo e assistindo uma à outra.
4. Teste os quatro perfis e registre resolução/FPS/bitrate reais, imagem em movimento e áudio quando oferecido pelo navegador. Negue permissão e encerre a captura pelo navegador; nenhuma vaga deve ficar ocupada indevidamente.
5. Teste saída, expulsão, finalização pelo administrador, encerramento abrupto e reconexão. Compare Usage/Realtime com a mesma ocupação/duração. Meça CPU/GPU/RAM pelo sistema e upload real; não use estimativas da interface como medições.
6. Repita em redes diferentes, incluindo uma rota que exija TURN. Teste uma conexão fraca com 480p24 e observe adaptação, perdas e RTT.
