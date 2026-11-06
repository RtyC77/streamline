# Resultados locais — 6 de novembro de 2026

## Verificações executadas

| Verificação                                   | Resultado                                                |
| --------------------------------------------- | -------------------------------------------------------- |
| TypeScript estrito + build Vite               | Passou                                                   |
| Vitest                                        | 27 testes em 6 arquivos passaram                         |
| Migrations PostgreSQL + RLS no PGlite         | 44 verificações passaram                                 |
| npm audit                                     | Zero vulnerabilidades reportadas                         |
| HTTP local do Vite                            | Resposta 200                                             |
| Página inicial no navegador                   | Inspecionada em layout amplo e estreito                  |
| Transbordamento horizontal no layout estreito | Não observado: largura do documento igual à área visível |

O build gera arquivos estáticos em `dist`, incluindo `_headers` e `_redirects`. O JavaScript do último build está na ordem de 141 kB com gzip, e o CSS na ordem de 4,4 kB com gzip; esses tamanhos não representam RAM, CPU ou GPU em execução.

## Cobertura automatizada

- Convites, validação de mensagens, limites de SDP/ICE e configuração.
- Offers/answers com peers simulados, ICE antes de SDP e rejeição de sessões/conexões antigas.
- Remetente/client incorreto, watch duplicado, espectador tardio e quatro espectadores com uma captura reutilizada.
- Liberação de tracks/peers e perda de concessão de transmissão.
- Captura sem áudio, sem vídeo, recusa de constraints e de permissão, sem solicitação automática de microfone.
- Serialização entre heartbeat e início, saída durante claim pendente e parada pelo evento `ended` do navegador.
- Emissão temporária TURN somente após JWT e associação autorizados, sem expor o segredo compartilhado.
- Rejeição de chaves secretas e de URLs inseguras na validação de configuração do build.
- RLS com papéis PostgreSQL distintos, intruso, sala cheia, uma transmissão exclusiva, expiração, saída, mudança de geração de tópicos e limitação de tentativas inválidas.

## Verificações que continuam pendentes

- Integração com um projeto Supabase real (nenhuma URL/chave foi fornecida). O script `npm run test:integration` está pronto para um projeto de testes.
- Autorização/Presence/Broadcast no serviço Realtime gerenciado. A suíte SQL valida políticas, mas não o cache ou o transporte do serviço.
- Captura e recepção nativas entre dois computadores, áudio audível, quatro espectadores reais e NAT/TURN.
- Interface interna da sala conectada ao backend real e comportamento com uma transmissão efetiva.
- Deploy Cloudflare Pages, HTTPS e headers de produção. O repositório local e a integração CI estão preparados, sem publicação remota realizada.
- Medições de CPU/GPU/RAM, FPS do jogo, latência ponta a ponta e duração prolongada.

Use [VALIDACAO.md](VALIDACAO.md) para registrar as evidências. A entrega está implementada e verificada localmente; não deve ser descrita como validada entre PCs ou em produção até esses testes serem realizados.
