# StreamLite

Compartilhamento privado de jogos entre amigos, no navegador. React + TypeScript estrito + Vite, Supabase Auth/PostgreSQL/Realtime e WebRTC P2P nativo. Interface em português brasileiro, sem voz, webcam, chat, gravação ou processamento de frames.

**Estado da entrega:** implementação local compilável, com testes automatizados. Para uso real é necessário configurar seu projeto Supabase e publicar em HTTPS. A transmissão e o áudio entre computadores diferentes ainda precisam da validação descrita em [docs/VALIDACAO.md](docs/VALIDACAO.md). Não há transmissão demonstrativa ou backend simulado na aplicação.

## 1. Rodar pela primeira vez

Somente quem desenvolve/publica precisa de Node.js 24 LTS, npm e, opcionalmente, Git. Seus amigos só precisam de Chrome ou Edge atualizado no Windows e do link do site.

No PowerShell, dentro deste diretório:

```powershell
npm ci
Copy-Item .env.example .env
```

Preencha `.env` com a URL e a chave **publishable** do seu Supabase. Depois de configurar o banco conforme a próxima seção:

```powershell
npm run dev
```

Abra o endereço informado pelo Vite (normalmente `http://127.0.0.1:5173`). Sem configuração, a interface explica o que falta e os botões de acesso ficam desabilitados. Nunca há uma sala fictícia para substituir o backend.

## 2. Configurar o Supabase

1. Crie um projeto Supabase dedicado ao StreamLite.
2. Em **Connect / API Keys**, copie a Project URL e a chave pública publishable. Coloque-as em `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Não use secret key nem `service_role` no frontend.
3. Em **Authentication → Sign In / Providers**, habilite entradas anônimas (**Allow anonymous sign-ins**). A aplicação cria uma identidade autenticada, mesmo sem email/senha.
4. No **SQL Editor**, execute, nesta ordem, o conteúdo completo de:
   - `supabase/migrations/202611050001_rooms.sql`
   - `supabase/migrations/202611050002_turn.sql`
5. Em **Realtime Settings**, **desative Allow public access**. Todos os canais da aplicação usam `private: true`. Não desative RLS. As migrations criam políticas em `realtime.messages`, onde o Supabase já mantém RLS habilitada.
6. Em Auth, configure a Site URL de produção. Se usar CAPTCHA, habilite **Cloudflare Turnstile** na proteção contra abuso do Supabase, configure o segredo apenas no painel Auth, e a site key pública em `VITE_TURNSTILE_SITE_KEY`.
7. No Turnstile, autorize o domínio de produção e o hostname local que você efetivamente usar. Não tente resolver desafios automaticamente.
8. Configure limites de Auth e monitore abuso. A proteção por conta do banco não substitui a limitação por IP e o CAPTCHA da criação de identidades anônimas. Use um projeto separado para testes automatizados que exigirem CAPTCHA desativado.
9. Agende a limpeza de salas e identidades antigas conforme `supabase/maintenance.sql`.

Se preferir a CLI, com Supabase CLI instalada no computador de desenvolvimento:

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

O `supabase/config.toml` também prepara um ambiente local (`supabase start`, que exige Docker apenas para desenvolvimento). A aplicação publicada não depende de Docker, CLI ou programas instalados nas máquinas dos participantes.

As RPCs `SECURITY DEFINER` têm `search_path` vazio, usam `auth.uid()`, validam entradas, restringem execução ao papel autenticado e não permitem escritas diretas em salas/associações. Operações privilegiadas de sala são transações no PostgreSQL; não precisam de um servidor Node nem de uma Edge Function intermediária.

## 3. Criar e usar uma sala

1. Digite um apelido de 2 a 24 caracteres e clique em **Criar sala**.
2. Copie o convite na barra lateral e envie-o aos amigos por um canal de sua confiança.
3. Cada amigo abre o link, escolhe um apelido e clica em **Entrar na sala**.
4. Um participante clica em **Compartilhar jogo** e escolhe a janela no diálogo nativo. Marque o áudio se o navegador oferecer essa opção.
5. O espectador recebe a mídia automaticamente. Se o navegador bloquear autoplay, clique em **Reproduzir transmissão**.
6. Use volume e tela cheia no espectador. No transmissor, volte para o jogo: não há prévia local consumindo renderização de vídeo.
7. Use **Parar transmissão**, o controle nativo do navegador ou **Sair da sala** para encerrar os recursos.

O convite tem 64 caracteres hexadecimais e cerca de 244 bits aleatórios, gerados criptograficamente no servidor. Somente o hash SHA-256 fica no banco. O segredo é carregado no fragmento `#convite=...`, que não é enviado ao servidor estático em uma requisição HTTP. Trate o convite como segredo: quem o recebe pode solicitar associação até a expiração. O UUID da sala sozinho não concede acesso.

Salas e convites expiram em 8 horas. Associações sem heartbeat por 60 segundos liberam vaga na próxima reconciliação. Uma conta não pode abrir a mesma sala em duas abas independentes ao mesmo tempo; prefira outro perfil de navegador para testar dois usuários no mesmo computador. Uma aba duplicada pode copiar `sessionStorage`, portanto esse bloqueio é uma conveniência e não uma fronteira entre identidades de segurança.

## 4. Áudio, vídeo e desempenho

- Alvo: 1280 × 720, até 30 FPS. Constraints de captura são aplicadas quando suportadas e a escala de saída também é limitada no encoder. O navegador pode retornar outros valores; o diagnóstico informa os valores reais disponíveis.
- Vídeo: preferência por H.264 usando codecs anunciados pelo navegador, preservando fallbacks; áudio: preferência por Opus. Não há alteração manual de SDP.
- Bitrate inicial de vídeo de 3 Mbps **por espectador**, com teto adaptado entre 2,5 e 4 Mbps via `RTCRtpSender.setParameters()`. O controle nativo de congestionamento pode transmitir abaixo desse teto. RTT alto ou limitação de banda reduz o teto; condições estáveis o elevam gradualmente.
- Uma captura é reutilizada por até quatro peers. Com quatro espectadores, planeje aproximadamente 12 Mbps de vídeo de upload no perfil inicial, além de áudio e overhead. A carga de codificação depende do navegador, driver e equipamento; não há garantia de compartilhamento de encoder nem de aceleração por hardware.
- Sem espectadores, as trilhas são desativadas. Isso evita envio de mídia, mas não garante que todo custo da captura nativa desapareça. Parar a transmissão encerra as trilhas de fato.
- Estatísticas são coletadas a cada 5 segundos somente se existem peers, também para o ajuste de bitrate. O painel é oculto por padrão. Não são estimados CPU, GPU ou RAM.
- `windowAudio: 'window'` prioriza áudio da janela; `systemAudio: 'include'` permite que o navegador ofereça áudio do sistema para as fontes em que isso for aplicável. O usuário escolhe o que será capturado no diálogo. Não há uma API padronizada que confirme o suporte aos membros opcionais desse dicionário antes da captura; opções desconhecidas são ignoradas e as trilhas retornadas determinam o resultado.
- A presença de uma trilha de áudio não prova que ela contém som audível. A interface informa trilha presente/ausente; confirme o som com o teste manual. Microfone nunca é solicitado.
- Se o áudio de janela não aparecer, experimente uma aba com a opção de áudio ou outra fonte oferecida pelo navegador. Vídeo continua sem áudio. Jogos em fullscreen exclusivo ou conteúdo protegido podem exigir modo janela/sem bordas ou não ser capturáveis.

## 5. STUN e TURN

`VITE_ICE_SERVERS` é um array JSON de servidores ICE. O padrão é STUN da Cloudflare. STUN ajuda a encontrar rotas diretas, mas não atravessa todos os NATs/firewalls. Não é necessário port forwarding nas máquinas dos amigos. Para redes restritas, configure TURN.

**Nunca coloque segredos TURN permanentes em variáveis `VITE_`.** Todas essas variáveis são públicas no build. O suporte opcional abaixo gera credenciais temporárias em uma Edge Function:

1. Use um serviço TURN que aceite credenciais REST HMAC compatíveis com coturn (`use-auth-secret` e `static-auth-secret`). Essa infraestrutura é opcional e só necessária para relay; não é um servidor permanente da aplicação.
2. Configure os segredos da função a partir de `supabase/functions/turn-credentials/.env.example` no painel de Edge Functions. Use `PUBLIC_SUPABASE_KEY` com a chave publishable, `TURN_SHARED_SECRET` com o segredo do serviço, `TURN_URLS` e `ALLOWED_ORIGINS` com as origens exatas, separadas por vírgula.
3. Publique com `supabase functions deploy turn-credentials`. A configuração `verify_jwt = false` desliga somente a checagem legada do gateway; o handler **sempre valida o JWT no Supabase Auth** e autoriza a associação atual via RPC/RLS antes de emitir credenciais. A chave pública sozinha não autoriza.
4. No frontend, defina `VITE_TURN_FUNCTION=turn-credentials` e refaça o build.
5. O cliente solicita credenciais válidas por uma hora e renova a configuração ICE a cada 20 minutos. Não as persiste nem as registra em logs.
6. Configure quotas de alocação, banda, bloqueio de destinos privados e proteção contra abuso no serviço TURN. A função tem limite de emissão por conta via banco, mas quotas de mídia são responsabilidade do operador TURN.

Se a função opcional estiver configurada e falhar, a aplicação mostra um erro em vez de ocultar a indisponibilidade de TURN. Corrija a configuração ou remova `VITE_TURN_FUNCTION` para operar explicitamente só com os servidores ICE públicos configurados.

## 6. Publicar no Cloudflare Pages com GitHub

1. Crie um repositório GitHub vazio e envie este projeto, incluindo `package-lock.json`. Não envie `.env` nem os segredos da Edge Function. Com Git instalado e sua autenticação GitHub configurada:

   ```powershell
   git init -b main
   git add .
   git commit -m "Implementa MVP StreamLite"
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
   git push -u origin main
   ```

   Se o diretório já estiver em Git, pule `git init`. Se `origin` já existir, confira-o com `git remote -v` e use o destino correto.

2. No Cloudflare, abra **Workers & Pages → Create → Pages → Connect to Git** e selecione o repositório.
3. Selecione a branch de produção, normalmente `main`.
4. Use **React (Vite)**, comando **`npm run build`** e diretório de saída **`dist`**. A raiz é a raiz deste projeto. Configure `NODE_VERSION=24` se a imagem não usar uma versão compatível.
5. Em Settings → Variables and Secrets, cadastre as variáveis públicas `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e as opções necessárias de `.env.example`. Configure Production e Preview separadamente. Se usar Supabase com domínio personalizado, atualize os hosts em `public/_headers`.
6. Publique. O endereço `https://...pages.dev` oferece o contexto seguro necessário para captura e WebRTC. Configure domínio próprio se desejar.
7. Atualize a Site URL do Auth, os hostnames do Turnstile e as origens da função TURN, se utilizada.
8. Execute o checklist manual usando a URL HTTPS publicada. Cada push na branch configurada gera um novo deploy. Variáveis Vite entram **no build**: alterá-las exige novo deploy.

`public/_headers` prepara CSP, proteção contra framing, `Referrer-Policy` e bloqueio de microfone/webcam. `public/_redirects` prepara fallback estático para a aplicação. Valide os headers na URL publicada; o Vite de desenvolvimento não aplica esses arquivos do Cloudflare. TURN é transporte WebRTC, não um endpoint HTTP que deva ser adicionado à CSP.

O workflow `.github/workflows/ci.yml` executa os testes e o build em pushes/PRs. A hospedagem automática ocorre pela integração Git do Pages, sem token Cloudflare no frontend. Não foi criado repositório remoto nem realizado deploy nesta entrega: não foram fornecidos projeto Supabase, credenciais ou destino GitHub/Cloudflare.

## 7. Verificar o projeto

```powershell
npm run typecheck
npm test
npm run test:db
npm run build
npm audit
npm run preview
```

Os testes Vitest usam peers e streams simulados para verificar protocolo, concorrência lógica, ICE precoce, sessões antigas, até quatro espectadores, liberação de recursos e emissão autenticada de TURN. Os testes SQL executam as migrations em PostgreSQL WASM (PGlite), com papéis `authenticated`/`anon`, RLS real e stubs **apenas** do contrato `auth.uid()`/tópico do Realtime. Não substituem Supabase Realtime gerenciado, rede real, captura ou encoder.

Para validar Auth/RLS/Broadcast no Supabase real, use um projeto **de testes** com as migrations aplicadas, Auth anônimo e sem CAPTCHA:

```powershell
$env:STREAMLITE_TEST_SUPABASE_URL = 'https://SEU-PROJETO-DE-TESTES.supabase.co'
$env:STREAMLITE_TEST_PUBLISHABLE_KEY = 'sb_publishable_SUBSTITUA'
npm run test:integration
```

Esse teste cria três identidades anônimas de teste, verifica Broadcast privado e acesso de intruso, e remove as associações ao terminar. A sala expira em oito horas; as identidades anônimas permanecem até a limpeza configurada. Ele não testa vídeo/áudio e não deve ser executado contra produção com CAPTCHA desativado.

## 8. Estrutura e arquivos principais

```text
src/
  App.tsx                  Alternância entre entrada e sala
  pages/                   Páginas inicial e de sala
  components/              Player, configurações, ícones, Turnstile, diagnóstico
  services/
    supabase.ts            Cliente público, Auth e configuração ICE
    rooms.ts               RPCs e convites
    signaling.ts           Canais privados por remetente e validação de mensagens
    session.ts             Ciclo da sala, heartbeat, presença e limpeza
    errors.ts              Erros compreensíveis
  media/
    capture.ts             getDisplayMedia, constraints e preferências de codec
    peers.ts               Um peer por espectador, SDP/ICE, reconexão
    stats.ts               getStats e contadores reais
  config.ts, types.ts, styles.css
supabase/
  migrations/              Banco, RLS, convites, concessões e limite de sala
  functions/turn-credentials/  TURN temporário opcional
  maintenance.sql          Agendamento de limpeza
tests/                     Testes de protocolo, peers e TURN
scripts/                   Validação SQL e integração Supabase
docs/                      Arquitetura, checklist manual e resultados locais
public/                    Headers e redirects do Cloudflare
.github/workflows/ci.yml    Verificações contínuas
```

## 9. Limitações e próximas medições

A sinalização é endereçada ao destinatário no protocolo, mas Broadcast distribui o evento aos membros autorizados inscritos no tópico do remetente. SDP e candidatos ICE podem revelar informações de conectividade aos participantes da mesma sala; o usuário sem associação não tem acesso. WebRTC criptografa a mídia em trânsito. Não há moderação/expulsão nem proteção contra um amigo autorizado que use um cliente modificado para perturbar a própria sala.

As mudanças de associação e de transmissão são reconciliadas por heartbeat a cada 10 segundos. Presence antecipa saídas, e o banco define a autoridade. Canais mudam de geração quando a associação muda para não perpetuar autorizações Realtime em cache. Uma saída/revogação não é instantânea em todos os clientes: considere até o próximo heartbeat; perda abrupta de processo usa os prazos de 35 segundos (concessão de transmissão) e 60 segundos (associação). Abas suspensas pelo navegador podem perder suas concessões e precisar entrar novamente. Consulte [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

Antes de promover o MVP a validado: execute [docs/VALIDACAO.md](docs/VALIDACAO.md) em dois PCs e depois em cinco; teste rede móvel/CGNAT e TURN; meça o impacto no FPS do jogo, CPU/GPU pelo gerenciador do sistema e upload. Compare H.264 com o codec efetivamente negociado, sem presumir que uma preferência é mais eficiente naquele equipamento. Depois, avalie intervalos de heartbeat e políticas de bitrate baseados nessas medições. Não é necessário adicionar SFU ou uma infraestrutura permanente para esse grupo inicial.

## Referências técnicas

- [Supabase: autorização Realtime e cache de políticas](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase: identidades anônimas e proteção contra abuso](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Chrome 141: windowAudio](https://developer.chrome.com/release-notes/141)
- [Chrome: controles do compartilhamento](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
- [MDN: setCodecPreferences](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpTransceiver/setCodecPreferences)
- [MDN: setParameters](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
- [Supabase: autenticação em Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Cloudflare Pages: configuração de build](https://developers.cloudflare.com/pages/configuration/build-configuration/)

