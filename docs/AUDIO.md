# Áudio da aba ou do sistema

No diálogo **Compartilhar tela**, a opção **Compartilhar áudio do sistema** começa desmarcada. Ao marcar, o usuário permite que a transmissão inclua jogo, YouTube, notificações e outros sons do PC, junto com uma janela ou tela inteira.

## Usar

1. Pare o compartilhamento anterior e atualize o site com Ctrl + F5.
2. Clique em **Compartilhar jogo**, escolha resolução/FPS e marque **Compartilhar áudio do sistema** se quiser o som do PC.
3. Clique em **Escolher janela e compartilhar**, selecione a janela ou tela inteira e habilite também a opção de áudio no seletor do navegador, quando disponível.
4. Confira o aviso após iniciar: a aplicação informa se recebeu uma trilha, sem afirmar que ela contém somente o jogo. Se o navegador não retornar áudio, o vídeo continua normalmente.

Não é necessário executar SQL, publicar Edge Functions ou mudar variáveis. A escolha acompanha o perfil durante a sala atual; não é persistida em outra sessão. Para mudar a escolha, pare e inicie novamente o compartilhamento.

## Comportamento

- **Desmarcada:** solicita `windowAudio: 'exclude'` e `systemAudio: 'exclude'`. Além dos pedidos, remove e encerra todas as trilhas de áudio de janela, monitor ou fonte não identificada antes do WebRTC. Apenas o áudio de uma aba pode permanecer.
- **Marcada:** solicita `windowAudio: 'system'` e `systemAudio: 'include'`, preservando as trilhas de áudio disponibilizadas pelo navegador para a fonte escolhida. Não tenta isolar o jogo de outros aplicativos.
- O diálogo de permissões do navegador continua obrigatório. O aplicativo não força áudio nem pede microfone automaticamente.

A [documentação do Chrome](https://developer.chrome.com/release-notes/141) e a [especificação Screen Capture](https://w3c.github.io/mediacapture-screen-share/#dom-displaymediastreamoptions-windowaudio) tratam essas opções como preferências. A presença de uma trilha e o vídeo ser de uma janela não provam isolamento por aplicativo. `restrictOwnAudio` também não separa genericamente o jogo do YouTube.

O bloqueio anterior de áudio global fica como comportamento padrão, agora com a opção explícita solicitada pelo usuário para permitir o som do PC. Não há filtros, processamento contínuo, novas consultas nem conexões adicionais ao Supabase.

## Testes

Os testes cobrem preservação de áudio autorizado para janela/tela inteira/fonte não identificada, remoção quando a opção está desmarcada, ausência de microfone, opção desmarcada na interface, validação booleana e continuidade do vídeo quando o navegador não retorna áudio. Build e 86 testes passaram. A audibilidade em computadores e redes diferentes ainda precisa ser conferida pelo checklist em VALIDACAO.md.
