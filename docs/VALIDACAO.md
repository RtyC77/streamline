# Validação manual em computadores reais

**Estado: pendente.** Esta lista é um roteiro para produzir evidência. Nenhum item manual está marcado como realizado na entrega local. Registre data, versão do navegador/Windows, GPU, rede, número de espectadores e resultado real de cada passo. Não cole SDP, candidatos ICE, convites, JWTs ou credenciais TURN em registros públicos.

O checklist específico de três telas, perfis 480p/720p e prévias está em [MULTITELAS.md](MULTITELAS.md). Os testes nativos locais estão registrados em [RESULTADOS-MULTITELAS.json](RESULTADOS-MULTITELAS.json); não validam redes distintas nem áudio.

## Preparação

- [ ] Migrations aplicadas em um projeto Supabase dedicado, Auth anônimo habilitado, RLS ativa e canais públicos desativados.
- [ ] URL HTTPS do Cloudflare Pages abre em Chrome/Edge atualizado em ambos os PCs.
- [ ] CAPTCHA de produção funciona e site key/hostnames correspondem ao domínio.
- [ ] Dois PCs em redes distintas (por exemplo banda larga e rede móvel), sem port forwarding.
- [ ] TURN configurado se a rota direta falhar; quotas e custos conferidos pelo operador.

## Caminho principal com dois PCs

1. No PC A, entre no site, escolha um apelido e crie uma sala.
2. Copie o convite e abra-o no PC B. Escolha outro apelido e entre. Verifique ambos na lista.
3. No PC A, clique em **Compartilhar jogo**. Escolha resolução e FPS, clique em Escolher janela e compartilhar e escolha uma janela real de jogo no seletor do navegador. Autorize áudio se oferecido.
4. No PC B, confirme que a imagem corresponde ao jogo e se move em tempo real. Se houver botão de reprodução, clique nele.
5. Reproduza um som identificável no jogo. Confirme audibilidade no PC B e compare com a indicação de trilha capturada. A presença de uma trilha sozinha não conta como teste de som.
6. Abra Configurações → Diagnóstico. Registre resolução, FPS, bitrate, codec, RTT, perdas, ICE e rota reais quando disponíveis. Verifique o alvo 720p30 onde suportado; não reprove negociação válida apenas por usar um fallback de codec.
7. Altere o volume, teste volume zero e restaure. Teste tela cheia e Escape.
8. No PC A, use **Parar transmissão**. Verifique que PC B volta à espera e o indicador nativo de captura encerra.
9. Inicie novamente e encerre pelo controle nativo do navegador. Confirme o mesmo resultado.
10. No PC B, inicie a transmissão após a parada de A. Confirme a inversão dos papéis.

- [ ] Imagem real recebida entre PCs diferentes.
- [ ] Áudio audível quando disponibilizado pelo navegador, com evidência da fonte escolhida.
- [ ] Sem áudio: ao compartilhar fonte sem trilha, vídeo continua e aviso fica claro no transmissor.
- [ ] Negar/cancelar permissão não deixa concessão ou captura ativa.
- [ ] Não há pedido de microfone/webcam.

## Isolamento do áudio

- [ ] Compartilhe a janela do jogo com áudio de janela, quando oferecido pelo navegador. Toque também um som em outro aplicativo e confirme no espectador que somente o jogo é audível.
- [ ] Compartilhe uma aba com áudio: o som de outra aba/aplicativo deve ficar de fora.
- [ ] Compartilhe uma tela inteira: a aplicação deve manter vídeo e remover qualquer trilha de áudio global, com aviso.
- [ ] Se o navegador oferecer apenas áudio do sistema para a janela, deixe-o desmarcado; confirme que a transmissão continua sem áudio. Registre a versão e o sistema operacional nesse resultado.

## Grupo e concorrência

- [ ] Escolha 2 vagas e confira a recusa da terceira pessoa; depois escolha 8, entre com oito identidades em computadores/perfis independentes e verifique sete espectadores simultâneos. Tente uma nona entrada e entradas simultâneas na última vaga.
- [ ] Entre depois de a transmissão começar; confirme recepção sem reiniciar a captura do transmissor.
- [ ] Uma sexta identidade recebe mensagem de sala cheia.
- [ ] Clique em compartilhar simultaneamente em dois PCs. Apenas um recebe concessão; o outro encerra as trilhas da tentativa recusada.
- [ ] Saia de um espectador; vaga é liberada, peers restantes continuam.
- [ ] Saia do transmissor; espectadores retornam à espera e outro participante pode transmitir.
- [ ] Reentre com o convite após saída, recarregamento e suspensão prolongada.
- [ ] Desconecte e reconecte a rede. Observe ICE restart/reconstrução, fim de captura sem backend e ausência de players duplicados.
- [ ] Feche abruptamente a aba do transmissor. Verifique Presence e expiração da concessão. Se Presence demorar, a autoridade deve expirar em 35 s mais reconciliação.

## Segurança no Supabase real

- [ ] `npm run test:integration` passa no projeto de testes. Esse teste valida Auth/RLS/Broadcast real, sem mídia.
- [ ] Cliente sem associação e somente UUID da sala não lê salas/participantes nem assina canal privado.
- [ ] Convite inexistente ou expirado é recusado; falhas repetidas ativam o limitador.
- [ ] Membro não publica em tópico de outro usuário.
- [ ] Após saída/limpeza, geração de tópico muda e clientes ativos passam a usá-la no próximo heartbeat.
- [ ] Nenhuma `service_role`, secret key ou `TURN_SHARED_SECRET` no bundle/publicação.
- [ ] Headers de CSP, framing, referrer e permissões são servidos pelo Cloudflare na URL de produção.

## NAT/TURN e desempenho

- [ ] Teste P2P direto entre redes diferentes; registre rota e RTT quando disponíveis.
- [ ] Para comprovar TURN, em uma publicação de teste configure `VITE_ICE_TRANSPORT_POLICY=relay` com TURN válido e gere novo build. Confirme mídia e `Relay (TURN)` no diagnóstico. Restaure `all` depois.
- [ ] TURN indisponível retorna erro compreensível; não alegar suporte a todos os NATs apenas com STUN.
- [ ] Teste sessão de mais de uma hora para conferir renovação das credenciais TURN.
- [ ] Compare FPS do jogo, CPU/GPU/RAM pelo gerenciador do sistema e upload com zero, um e sete espectadores.
- [ ] Faça teste de pelo menos 30 minutos e ciclos repetidos de compartilhar/parar. Observe se tracks, peers e consumo se acumulam.
- [ ] Compare minimizar a aba com mantê-la visível. Registre efeitos de throttling/suspensão do navegador.
- [ ] Teste congestionamento real e confirme que o encoder reduz o envio, sem exigir que mantenha 2,5 Mbps em uma rede incapaz.

## Saída automática de espectadores

- [ ] Deixe a aba de um espectador em segundo plano por dez minutos: deve voltar à entrada com aviso e encerrar a mídia e os heartbeats.
- [ ] Retorne antes de dez minutos: deve continuar na sala, com uma contagem nova na próxima saída da aba.
- [ ] Deixe a aba do transmissor em segundo plano por mais de dez minutos: a transmissão deve continuar.
- [ ] Após a saída automática, clique em Entrar na sala para revalidar a associação pelo convite preservado.
- [ ] Retome uma aba suspensa por mais de dez minutos: deve sair antes de renovar a participação.

## Registro de aceitação

| Critério                                     | Evidência                           | Resultado |
| -------------------------------------------- | ----------------------------------- | --------- |
| Dois usuários na sala privada                | PC/rede/navegador                   | Pendente  |
| Janela real recebida ao vivo                 | Fonte e movimento observado         | Pendente  |
| Áudio oferecido/ausente tratado corretamente | Teste audível e aviso               | Pendente  |
| 720p30 quando suportado                      | getStats real                       | Pendente  |
| Saída/reconexão sem estado corrompido        | Cenários acima                      | Pendente  |
| Um transmissor e sete espectadores         | Oito identidades reais             | Pendente  |
| Auth/RLS/Realtime no serviço                 | Integração e verificações negativas | Pendente  |
| HTTPS e headers no Cloudflare                | URL e headers                       | Pendente  |

Não marque o MVP como validado em produção até concluir os critérios aplicáveis e resolver falhas críticas observadas.
