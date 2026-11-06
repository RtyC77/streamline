# Áudio restrito à fonte

## Correção do vazamento de áudio do PC

O comportamento anterior aceitava uma trilha de áudio se o vídeo informasse `displaySurface: 'window'`. Isso era insuficiente: vídeo de uma janela pode vir acompanhado de áudio do sistema inteiro. O relato de jogo mais YouTube ao fundo confirma que esse filtro não oferecia a proteção esperada.

Agora o pedido usa `windowAudio: 'exclude'` e `systemAudio: 'exclude'`. Depois da resposta do navegador, todas as trilhas de áudio de **janela**, **monitor** ou superfície **não identificada** são encerradas e removidas do MediaStream antes de retornar a captura para o WebRTC. A remoção acontece mesmo se o navegador ignorar as preferências e devolver áudio misturado.

Áudio é mantido somente para `displaySurface: 'browser'`, isto é, uma aba compartilhada, quando o navegador disponibiliza uma trilha. Não existe fallback para microfone ou áudio global. O diálogo de compartilhamento e as configurações explicam essa limitação; janelas de jogos de PC compartilham somente vídeo nesta versão.

Essa correção bloqueia o som de outros aplicativos em capturas de janela/tela, mas **não implementa áudio exclusivo de jogos nativos**: nesse modo, o som do próprio jogo também é removido. Não afirmamos que a aplicação separa uma mistura já capturada.

## Por que não basta windowAudio: window

A [documentação do Chrome 141](https://developer.chrome.com/release-notes/141#windowaudio_for_getdisplaymedia) descreve a opção como uma preferência e recomenda `exclude` para limitar áudio do sistema em compartilhamento de janela. A [especificação Screen Capture](https://w3c.github.io/mediacapture-screen-share/#dom-displaymediastreamoptions-windowaudio) permite que o navegador ignore esse pedido.

Não há neste contrato um valor confiável que prove qual aplicativo está incluído na trilha de áudio de uma janela. Nome da trilha, versão do navegador, presença de áudio ou tipo da trilha de vídeo não servem como prova. `restrictOwnAudio` diz respeito ao áudio do documento capturador e não remove genericamente YouTube ou outros aplicativos. Não usamos heurísticas nem um checkbox para fingir essa garantia.

## Aplicar e conferir

1. Pare compartilhamentos que já estavam em andamento.
2. Atualize o site com Ctrl + F5 e compartilhe novamente. Não é necessário executar SQL, publicar Edge Functions ou mudar variáveis de ambiente.
3. Compartilhe uma janela de jogo com YouTube tocando ao fundo. O espectador deve receber vídeo **sem áudio**, tanto do jogo quanto do YouTube.
4. Se for um jogo executado em uma aba do navegador, escolha a aba no seletor e habilite o áudio dessa aba. Confira que o áudio de outra aba/aplicativo não é ouvido.
5. Compartilhe tela inteira: também deve continuar sem áudio. Se o navegador não identificar o tipo da fonte, o áudio é removido por precaução.

Os testes automatizados simulam explicitamente o retorno de áudio para janela/tela mesmo com as preferências de exclusão, verificando `stop()`, remoção das trilhas, preservação do vídeo e ausência de pedido de microfone. O teste audível entre computadores continua pendente; não foi declarado como realizado nesta correção. A mudança não cria consultas, conexões Supabase, filtros de áudio nem processamento contínuo adicional.
