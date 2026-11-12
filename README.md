# StreamLite

Compartilhamento privado de jogos entre amigos, no navegador. React + TypeScript estrito + Vite, Supabase Auth/PostgreSQL/Realtime e WebRTC P2P nativo. Interface em português brasileiro, sem voz, webcam, chat, gravação ou processamento contínuo de frames.

**Estado da entrega:** implementação local compilável, com testes automatizados. Para uso real é necessário configurar seu projeto Supabase e publicar em HTTPS. A transmissão e o áudio entre computadores diferentes ainda precisam da validação descrita em [docs/VALIDACAO.md](docs/VALIDACAO.md). Não há transmissão demonstrativa ou backend simulado na aplicação.

Até três pessoas podem compartilhar telas, com uma tela recebida ao vivo por espectador e miniaturas congeladas. Captura em 480p/720p e 24/30 FPS. Aplique a migration `202611060008_multi_stream.sql` depois das anteriores e atualize todos os clientes: [ativação e testes](docs/MULTITELAS.md).

A revisão de consumo, os resultados reproduzíveis e a migration adicional estão em [docs/DESEMPENHO.md](docs/DESEMPENHO.md).

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

Abra o endereço informado pelo Vite (normalmente `http://127.0.0.1:5173`). A interface apresenta o login quando o Supabase está configurado.

## 2. Configurar o Supabase

1. Crie um projeto Supabase dedicado ao StreamLite.
2. Em **Connect / API Keys**, copie a Project URL e a chave pública publishable. Coloque-as em `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Não use secret key nem `service_role` no frontend.
3. Em **Authentication → Sign In / Providers**, habilite cadastro por e-mail e **Confirm Email**. Desabilite **Allow anonymous sign-ins**.
4. Aplique as migrations pendentes em ordem, até `202611120011_accounts.sql`. Consulte [o procedimento de implantação e inicialização](docs/ADMINISTRACAO.md).
5. Em **Realtime Settings**, **desative Allow public access**. Todos os canais da aplicação usam `private: true`. Não desative RLS. As migrations criam políticas em `realtime.messages`, onde o Supabase já mantém RLS habilitada.
6. Em Auth, configure a Site URL de produção, o redirecionamento para `/recuperar` e o SMTP. Se usar CAPTCHA, habilite **Cloudflare Turnstile** na proteção contra abuso do Supabase, configure o segredo apenas no painel Auth, e a site key pública em `VITE_TURNSTILE_SITE_KEY`.
7. No Turnstile, autorize o domínio de produção e o hostname local que você efetivamente usar. Não tente resolver desafios automaticamente.
8. Configure limites de Auth e monitore abuso de cadastro e recuperação. Use um projeto separado para testes automatizados que exigirem CAPTCHA desativado.
9. Habilite o Supabase Cron e execute `supabase/maintenance.sql` após aplicar as migrations. Uma sala vazia aceita entradas por dez segundos e depois desaparece do catálogo. Quando a saída não chega ao servidor, os dez segundos começam após a presença expirar por falta de heartbeat. O Cron remove os registros vencidos.

Se preferir a CLI, com Supabase CLI instalada no computador de desenvolvimento:

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

O `supabase/config.toml` também prepara um ambiente local (`supabase start`, que exige Docker apenas para desenvolvimento). A aplicação publicada não depende de Docker, CLI ou programas instalados nas máquinas dos participantes.

As RPCs `SECURITY DEFINER` têm `search_path` vazio, usam `auth.uid()`, validam entradas, restringem execução ao papel autenticado e não permitem escritas diretas em salas/associações. Operações privilegiadas de sala são transações no PostgreSQL; não precisam de um servidor Node nem de uma Edge Function intermediária.

## 3. Criar e usar uma sala

A página inicial lista as salas ativas, os apelidos dos participantes e quem está compartilhando a tela. Salas públicas aceitam entrada sem senha. Para criar uma sala privada, escolha **Privada** e defina uma senha. O link da sala abre o formulário de entrada e o servidor valida a senha. Salas criadas antes do catálogo continuam aceitando seus convites originais.

Para publicar o catálogo, aplique a migration `202611120009_room_directory.sql` no Supabase antes de publicar o frontend. Ela usa `pgcrypto` no schema `extensions` para armazenar hashes de senha.

1. Entre com uma conta ativa e verificada. Se sua conta estiver autorizada, clique em **Criar sala**.
2. Copie o convite na barra lateral e envie-o aos amigos por um canal de sua confiança.
3. Cada amigo abre o link, entra com sua conta verificada e clica em **Entrar na sala**.
4. Um participante clica em **Compartilhar jogo** e escolhe a janela no diálogo nativo. Marque o áudio se o navegador oferecer essa opção.
5. O espectador recebe a mídia automaticamente. Se o navegador bloquear autoplay, clique em **Reproduzir transmissão**.
6. Use volume e tela cheia no espectador. No transmissor, volte para o jogo: não há prévia local consumindo renderização de vídeo.
7. Use **Parar transmissão**, o controle nativo do navegador ou **Sair da sala** para encerrar os recursos.
8. Na lista de participantes, use **Ativar câmera** para compartilhar vídeo sem áudio com a sala. **Desativar câmera** encerra a captura e restaura o avatar.

O convite tem 64 caracteres hexadecimais e cerca de 244 bits aleatórios, gerados criptograficamente no servidor. Somente o hash SHA-256 fica no banco. O segredo é carregado no fragmento `#convite=...`, que não é enviado ao servidor estático em uma requisição HTTP. Trate o convite como segredo: quem o recebe pode solicitar associação até a expiração. O UUID da sala sozinho não concede acesso.

Salas e convites expiram em 8 horas. Associações sem heartbeat por 60 segundos liberam vaga na próxima reconciliação. Uma conta não pode abrir a mesma sala em duas abas independentes ao mesmo tempo; prefira outro perfil de navegador para testar dois usuários no mesmo computador. Uma aba duplicada pode copiar `sessionStorage`, portanto esse bloqueio é uma conveniência e não uma fronteira entre identidades de segurança.

## 4. Áudio, vídeo e desempenho

- Alvo: 1280 × 720, até 30 FPS. Constraints de captura são aplicadas quando suportadas e a escala de saída também é limitada no encoder. O navegador pode retornar outros valores; o diagnóstico informa os valores reais disponíveis.
- Vídeo: preferência por H.264 usando codecs anunciados pelo navegador, preservando fallbacks; áudio: preferência por Opus. Não há alteração manual de SDP.
- Bitrate inicial de vídeo de 3 Mbps **por espectador**, com teto adaptado entre 2,5 e 3 Mbps via `RTCRtpSender.setParameters()`. O controle nativo de congestionamento pode transmitir abaixo desse teto. RTT alto ou limitação de banda reduz o teto; condições estáveis o elevam gradualmente.
- Uma captura é reutilizada por até sete peers. Com sete espectadores, planeje aproximadamente 21 Mbps de vídeo de upload no perfil inicial, além de áudio e overhead. A carga de codificação depende do navegador, driver e equipamento; não há garantia de compartilhamento de encoder nem de aceleração por hardware.
- Sem espectadores, as trilhas são desativadas. Isso evita envio de mídia, mas não garante que todo custo da captura nativa desapareça. Parar a transmissão encerra as trilhas de fato.
- Estatísticas são coletadas a cada 10 segundos no transmissor com peers, ou a cada 5 segundos com diagnóstico aberto. Espectadores não coletam estatísticas enquanto o diagnóstico está fechado. O painel é oculto por padrão. Não são estimados CPU, GPU ou RAM.
- A opção **Compartilhar áudio do sistema** permite som do PC junto com janelas ou tela inteira. Ela começa desmarcada, com aviso de que jogo, YouTube e outros aplicativos podem ser ouvidos. Marcada: solicita `windowAudio: 'system'` e `systemAudio: 'include'`, mantendo o áudio disponibilizado pelo navegador. Desmarcada: solicita exclusão do áudio do sistema e remove áudio de fontes que não sejam abas. Microfone nunca é solicitado automaticamente. Veja [docs/AUDIO.md](docs/AUDIO.md).
- O tipo de vídeo `window` não prova que o áudio corresponde apenas ao jogo. A API não permite confirmar essa separação; por isso o aplicativo só permite esse áudio quando o usuário marca explicitamente a opção de áudio do sistema. Ele não tenta separar uma mistura já fornecida pelo navegador.
- A presença de uma trilha de áudio não prova que ela contém som audível. A interface informa trilha presente/ausente; confirme o som com o teste manual. Microfone nunca é solicitado.
- Para jogos executados no navegador, compartilhe a aba e habilite o áudio dessa aba quando oferecido. Janelas e tela inteira ficam sem áudio por padrão; marque Compartilhar áudio do sistema para permitir o som do PC. Jogos em fullscreen exclusivo ou conteúdo protegido podem exigir modo janela/sem bordas ou não ser capturáveis.

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

`public/_headers` prepara CSP, proteção contra framing, `Referrer-Policy` e a política de dispositivos. A câmera é permitida na própria origem e o microfone é bloqueado. `public/_redirects` prepara fallback estático para a aplicação. Valide os headers na URL publicada; o Vite de desenvolvimento não aplica esses arquivos do Cloudflare. TURN é transporte WebRTC, não um endpoint HTTP que deva ser adicionado à CSP.

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

Os testes Vitest usam peers e streams simulados para verificar protocolo, concorrência lógica, ICE precoce, sessões antigas, até sete espectadores, liberação de recursos e emissão autenticada de TURN. Os testes SQL executam as migrations em PostgreSQL WASM (PGlite), com papéis `authenticated`/`anon`, RLS real e stubs **apenas** do contrato `auth.uid()`/tópico do Realtime. Não substituem Supabase Realtime gerenciado, rede real, captura ou encoder.

Para validar Auth, RLS e Broadcast no Supabase real, configure três contas em um projeto de testes e execute `npm run test:integration`. Consulte [as variáveis e o procedimento de validação](docs/ADMINISTRACAO.md#validação).

## 8. Estrutura e arquivos principais

```text
src/
  App.tsx                  Sessão, acesso por perfil e rotas
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

## 9. Saída automática de espectadores

Espectadores saem automaticamente depois de 10 minutos contínuos com a aba em segundo plano ou a janela minimizada. Voltar antes do prazo zera a contagem. O transmissor permanece conectado enquanto compartilha o jogo; ao parar de transmitir, passa a seguir a regra dos espectadores.

A saída fecha a mídia, os canais Realtime e os timers de heartbeat, solicita a remoção da associação e mostra um aviso na tela de entrada. O convite continua preenchido, mas é necessário clicar em **Entrar na sala** para voltar. Sem rede, a associação será liberada pela expiração já existente no servidor.

Navegadores podem suspender timers em segundo plano. Por isso, o prazo também é conferido antes dos heartbeats e ao retomar a aba: não há garantia de executar exatamente no décimo minuto se o navegador suspender o JavaScript. O controle usa a visibilidade real da página, não apenas a perda de foco do teclado.

## 10. Limitações e próximas medições

A sinalização é endereçada ao destinatário no protocolo, mas Broadcast distribui o evento aos membros autorizados inscritos no tópico do remetente. SDP e candidatos ICE podem revelar informações de conectividade aos participantes da mesma sala; o usuário sem associação não tem acesso. WebRTC criptografa a mídia em trânsito. O criador pode expulsar participantes pelo ícone ao lado dos nomes; a permissão é validada no servidor. A expulsão não é banimento permanente: o convite válido permite reentrada. Consulte [docs/MODERACAO.md](docs/MODERACAO.md).

A reconciliação de segurança usa heartbeat a cada 20 segundos no transmissor e 30 segundos nos espectadores, com avisos Realtime antecipando alterações. Presence antecipa saídas, e o banco define a autoridade. Canais mudam de geração quando a associação muda para não perpetuar autorizações Realtime em cache. Uma saída/revogação não é instantânea em todos os clientes: considere até o próximo heartbeat; perda abrupta de processo usa os prazos de 35 segundos (concessão de transmissão) e 60 segundos (associação). Abas suspensas pelo navegador podem perder suas concessões e precisar entrar novamente. Consulte [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

Antes de promover o MVP a validado: execute [docs/VALIDACAO.md](docs/VALIDACAO.md) em dois PCs e depois em oito; teste rede móvel/CGNAT e TURN; meça o impacto no FPS do jogo, CPU/GPU pelo gerenciador do sistema e upload. Compare H.264 com o codec efetivamente negociado, sem presumir que uma preferência é mais eficiente naquele equipamento. Depois, avalie intervalos de heartbeat e políticas de bitrate baseados nessas medições. Não é necessário adicionar SFU ou uma infraestrutura permanente para esse grupo inicial.

## 11. Administração de salas

Na criação, um slider permite escolher de **2 a 8 pessoas**, incluindo o criador, com padrão de duas e estimativas de impacto/upload. Aplique a migration `202611060007_room_capacity.sql` depois das anteriores. Salas existentes mantêm cinco vagas. Consulte [docs/CAPACIDADE.md](docs/CAPACIDADE.md) para configuração, estimativas e testes com oito participantes.

Novas salas recebem automaticamente o nome `Sala de <nome de usuário do criador>`. O banco lê o nome do perfil e o salva na criação.

O painel `/admin` usa a sessão Supabase Auth. Admins e SuperAdmins gerenciam contas e consultam o histórico conforme o cargo. SuperAdmins também podem listar e finalizar salas. Finalizar uma sala invalida seu convite e libera sua vaga na cota de três salas recentes ativas por usuário. [Procedimento de administração](docs/ADMINISTRACAO.md)

## Referências técnicas

- [Supabase: autorização Realtime e cache de políticas](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase: configuração de Auth](https://supabase.com/docs/guides/auth/general-configuration)
- [Chrome 141: windowAudio](https://developer.chrome.com/release-notes/141)
- [Chrome: controles do compartilhamento](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
- [MDN: setCodecPreferences](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpTransceiver/setCodecPreferences)
- [MDN: setParameters](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
- [Supabase: autenticação em Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Cloudflare Pages: configuração de build](https://developers.cloudflare.com/pages/configuration/build-configuration/)
