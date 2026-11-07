# Troca de telas

Um clique inicia a troca e bloqueia todas as miniaturas até o primeiro quadro da transmissão escolhida. A tela já selecionada não inicia outra negociação. O bloqueio existe na interface e no gerenciamento das conexões, incluindo cliques que chegam antes da próxima renderização do React.

A troca fecha o receptor anterior e inicia imediatamente o próximo, sem aguardar a manutenção de cinco segundos. Operações antigas de sinalização ficam em filas por conexão e verificam se ainda pertencem à tentativa ativa antes de continuar. Não há aumento da frequência de polling ou novas consultas ao banco por troca.

Durante a conexão, o player mostra o quadro congelado da tela escolhida e “Conectando à tela…”. Quando ainda não existe prévia, mostra o mesmo estado sobre um fundo neutro. O vídeo é revelado após o primeiro quadro apresentado, por um único `requestVideoFrameCallback`, com fallback de eventos e dimensões para navegadores sem essa API. Não há análise de frames ou callback contínuo.

Se o transmissor sair, a conexão falhar ou não apresentar quadro em 25 segundos, os controles são liberados com uma mensagem. A mesma tela pode ser escolhida novamente. A espera excedida não dispara reconstruções ilimitadas da conexão. Em navegador suspenso, a execução de timers pode atrasar. Uma reconexão de transporte após interrupção ainda depende de ICE/rede; o bloqueio de troca não promete eliminar esse tempo.

O diagnóstico opcional mostra tempos locais desde o pedido até a resposta, a conexão e o primeiro quadro. Não transmite medições ao Supabase, não grava SDP/IP e não adiciona timer de estatísticas. Continua existindo somente um receptor de mídia ao vivo por espectador; prévias de outras telas usam os canais temporários já existentes.

## Validação em 6/11/2026

- Testes automatizados cobrem bloqueio de cliques, troca com manutenção pendente, isolamento da negociação antiga, timeout, nova tentativa, saída do transmissor e liberação de callbacks/timers.
- `tests/browser/multi-webrtc.html`: seis trocas entre três fontes sintéticas, usando conexões WebRTC reais no mesmo navegador e sinalização em memória. Primeiro quadro em 134–147 ms nessas seis medições; nenhum aviso. Esses números não representam redes entre PCs, Supabase real, áudio ou jogos reais.
- O teste também confirmou que cliques repetidos não enviam pedidos adicionais, um único receptor ao vivo permanece ativo e as conexões são encerradas na saída.

Para validar em uso real, atualize os dois clientes, transmita três telas e faça pelo menos dez trocas, observando o diagnóstico. Tente cliques repetidos durante a espera; desligue uma fonte e teste a seleção após falha. Confirme áudio somente da tela escolhida e ausência de áudio anterior. Repita em redes diferentes com TURN quando necessário. Esses testes entre computadores ainda não foram realizados nesta etapa.
