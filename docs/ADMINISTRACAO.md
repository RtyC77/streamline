# Contas, permissões e administração

O Supabase Auth gerencia e-mail, senha, confirmação, recuperação e sessão. O UUID de `auth.users` identifica o perfil, o criador da sala e seus participantes. As senhas de conta ficam no Supabase Auth. Os nomes de usuário têm de 2 a 24 caracteres e são únicos sem distinção de maiúsculas. Contas novas começam ativas, com cargo `user` e sem permissão de criação.

| Operação | Usuário ativo e verificado | Admin | SuperAdmin |
| --- | --- | --- | --- |
| Entrar em salas conforme o modo de acesso | Sim | Sim | Sim |
| Criar salas com permissão concedida | Sim | Sim | Sim |
| Consultar usuários, último login e histórico administrativo | | Sim | Sim |
| Conceder ou revogar criação de salas | | Usuários e outros Admins | Outras contas |
| Bloquear ou desbloquear | | Usuários comuns | Outras contas |
| Promover usuário a Admin ou rebaixar Admin a usuário | | | Sim |
| Listar e finalizar salas como administrador | | | Sim |

## Banco e controle de acesso

- `202611120011_accounts.sql` adiciona perfis, histórico e funções. Contas de e-mail preexistentes recebem um nome técnico único e as permissões padrão. O titular pode alterar esse nome no perfil. Identidades anônimas antigas ficam sem acesso e suas participações são removidas na migração. A identidade do criador de salas antigas e os nomes já registrados são preservados.
- `profiles.own_profile` permite ler o próprio perfil, inclusive para mostrar o estado de bloqueio. `update_own_username` valida conta ativa e verificada, unicidade e nome reservado. A tabela não aceita alterações diretas pelos clientes.
- `admin_audit_logs` tem RLS habilitada e nenhuma política direta para clientes. As operações administrativas usam RPCs com validação de cargo. A listagem devolve apenas os campos administrativos, e o último login vem de `auth.users.last_sign_in_at`. O histórico registra o autor, o alvo, a ação e os estados relevantes.
- `rooms_read`, `members_read`, `streams_read`, `streamlite_receive` e `streamlite_send` passam a exigir conta ativa e verificada pelo helper de associação. As RPCs de criação, ingresso, presença, encerramento e TURN validam o estado no banco. Convites e hashes de senha das salas continuam privados.
- O bloqueio remove as participações e concessões de transmissão da conta e troca os tópicos afetados. A interface consulta o próprio perfil a cada cinco segundos em primeiro plano e ao recuperar o foco. A criação e as demais operações protegidas usam os dados atuais do banco mesmo se a tela estiver desatualizada.
- Alterações administrativas usam bloqueio transacional e versão do perfil. Um gatilho preserva o último SuperAdmin ativo quando um perfil é removido, bloqueado ou rebaixado. Nenhuma RPC do painel concede o cargo de SuperAdmin.

## Implantação

Em **Administração → Usuários**, Admins e SuperAdmins podem usar **Liberar acesso sem e-mail** em contas comuns ativas com confirmação pendente. Verifique por outro meio que o endereço pertence à pessoa. Depois da liberação, ela pode entrar com o mesmo e-mail e senha usados no cadastro. A ação fica no histórico e é independente da permissão para criar salas.

Para manter o cadastro disponível quando o envio de e-mail falha:

1. Mantenha **Confirm Email** ativo no Supabase. Configure Turnstile para o endereço público e adicione `VITE_TURNSTILE_SITE_KEY` ao build do frontend.
2. Configure os segredos da Edge Function `REGISTRATION_TURNSTILE_SECRET` (segredo do widget Turnstile) e `REGISTRATION_ORIGINS` (origens exatas separadas por vírgulas, como `https://streamline-cfw.pages.dev`). A função usa as variáveis de servidor `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente Supabase.
3. Publique a função com `supabase functions deploy register-account`. Depois defina `VITE_REGISTRATION_FUNCTION=true` no Cloudflare Pages e publique o frontend.
4. Em um projeto de testes, faça um cadastro com o envio disponível e outro com o envio indisponível. Confira se os dois aparecem no painel. No segundo caso, libere a conta pelo painel e teste o login com a senha cadastrada.

Se o SMTP falhar, a função preserva a conta pendente. Cadastros que falharam antes da criação da conta precisam ser refeitos com o e-mail que a pessoa pretende usar.

1. Confira as migrations já aplicadas e faça a validação inicial em um projeto de testes. A migração de contas restringe o acesso no momento em que é aplicada. Coordene a publicação do frontend e o corte para evitar que clientes antigos tentem ingressar com sessões anônimas.
2. No Supabase hospedado, habilite cadastro por e-mail e **Confirm Email**, configure senha mínima de oito caracteres e desabilite novos logins anônimos. Em **Authentication → URL Configuration**, configure **Site URL** com a URL HTTPS do frontend e autorize as URLs exatas da raiz (`/`) e da recuperação (`/recuperar`) em **Redirect URLs**. Mantenha os templates de confirmação e recuperação com o link padrão `{{ .ConfirmationURL }}`. Configure SMTP e valide a entrega antes de liberar novos cadastros. Se um link abrir `localhost:3000`, confira essas configurações e teste com um e-mail novo, pois links antigos podem carregar o destino anterior. [Redirecionamentos no Supabase Auth](https://supabase.com/docs/guides/auth/redirect-urls)
3. Em **Realtime Settings**, desabilite **Allow public access**. Se usar Turnstile, configure o segredo no Supabase Auth e a chave pública no build do frontend. Mantenha a Edge Function de TURN se o projeto usa TURN. [Autorização de Realtime](https://supabase.com/docs/guides/realtime/authorization)
4. Aplique as migrations pendentes em ordem, até `202611120012_staff_confirm_email.sql`. Use `supabase db push` em um projeto vinculado cuja tabela de histórico reflita as migrations aplicadas. Se a instalação foi feita pelo SQL Editor sem registro de histórico, confira primeiro o banco e aplique apenas os arquivos pendentes. Mantenha os agendamentos de `supabase/maintenance.sql`.
5. Inicialize Rod com o procedimento abaixo. Publique a raiz atual no repositório e na branch associados ao Cloudflare Pages. Use Node 24, `npm run build` e diretório de saída `dist`. A regra de fallback em `public/_redirects` precisa servir `/admin` e `/recuperar` diretamente.
6. Valide o login de Rod e as operações do painel pela URL publicada. Depois execute `supabase/retire-temporary-admin.sql` como `postgres` no SQL Editor. O script exige o perfil definitivo ativo com último login registrado e remove o gate antigo e os privilégios das RPCs legadas. Exclua a Edge Function hospedada `admin-panel` e remova seus segredos `ADMIN_LOGIN`, `ADMIN_PASSWORD_HASH` e `ADMIN_SESSION_SECRET`. Preserve `ALLOWED_ORIGINS` se o TURN o utiliza. Se existir um arquivo local de segredos do painel antigo, remova-o do armazenamento operacional após a transição.

### Variáveis

| Ambiente | Variáveis |
| --- | --- |
| Build do frontend | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Build com destino público fixo para e-mails | `VITE_AUTH_SITE_URL` (origem HTTPS também autorizada no Supabase) |
| Build com CAPTCHA | `VITE_TURNSTILE_SITE_KEY` |
| Build com TURN | `VITE_TURN_FUNCTION`, `VITE_ICE_SERVERS`, `VITE_ICE_TRANSPORT_POLICY`, conforme a configuração existente |
| Processo confiável de inicialização | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPERADMIN_BOOTSTRAP_PASSWORD` |
| Processo confiável com CAPTCHA ativo | `SUPERADMIN_BOOTSTRAP_CAPTCHA_TOKEN`, token válido para uma tentativa de login |

### Inicializar o SuperAdmin

Injete os segredos no ambiente do processo por um gerenciador de segredos ou mecanismo equivalente da sua infraestrutura. Execute da raiz, em uma estação administrativa ou executor confiável.

```powershell
npm run bootstrap:superadmin
```

O script procura `ropolatto77@gmail.com` no Auth. Se não existir, cria a conta `Rod` com e-mail confirmado no ambiente administrativo. Antes desse passo, o operador deve confirmar que controla o endereço indicado. Se a conta existir, o script exige e-mail confirmado e uma senha válida para a conta existente. A senha fornecida deve ter pelo menos 12 caracteres e até 72 bytes. O script valida o login pelo endpoint público antes de elevar o UUID e, com a mesma sessão, verifica a lista de usuários, o histórico e a lista de salas. Uma nova execução com as mesmas condições mantém o perfil e evita duplicar o registro de inicialização.

Em projetos com CAPTCHA ativo, a validação de senha exige um token válido. Para uma instalação nova, inicialize antes de habilitar CAPTCHA e antes de abrir o cadastro público. Para uma instalação existente, forneça um token obtido pelo fluxo autorizado do projeto. Ao terminar, remova os segredos de inicialização do ambiente do processo. Nenhuma variável privilegiada usa o prefixo `VITE_`.

## Validação

```powershell
npm test
npm run test:db
npm run build
```

O teste SQL cobre migrations, RLS, privilégios de RPC, perfil no cadastro, verificação, criação com e sem permissão, alteração sem novo login, bloqueio com sessão aberta, auditoria, acesso de Rod e retirada do caminho legado. O Auth e o Realtime gerenciados requerem o ambiente de testes.

Em um projeto Supabase de testes com migrations aplicadas e CAPTCHA desativado, configure `STREAMLITE_TEST_SUPABASE_URL`, `STREAMLITE_TEST_PUBLISHABLE_KEY` e os pares `STREAMLITE_TEST_<CONTA>_EMAIL` e `STREAMLITE_TEST_<CONTA>_PASSWORD`, com `<CONTA>` igual a `HOST`, `GUEST` e `OUTSIDER`. Use três contas confirmadas e ativas. Conceda criação apenas à conta `HOST`. Execute `npm run test:integration` para validar login, RPCs, presença e sinalização privada com o Supabase real.

No frontend publicado, valide cadastro por e-mail, confirmação, recuperação em outro navegador, login persistente e por aba, logout, entrada por link, criação após concessão, revogação e bloqueio durante uma sessão. Em dois dispositivos, teste captura de tela com áudio e confirme que a sessão de um participante bloqueado é encerrada. Faça a mesma validação com TURN se estiver configurado.

## Limites operacionais

- O histórico de acessos exibe o último login disponível no Auth. O histórico completo deste painel cobre alterações administrativas.
- WebRTC transmite mídia diretamente entre os navegadores. O banco revoga operações novas no momento da alteração. A desconexão de um fluxo já negociado depende da revalidação dos clientes e do fechamento dos peers. O Supabase Realtime mantém em cache a autorização de canais já abertos, e credenciais TURN emitidas continuam válidas até expirar. [Cache de autorização do Realtime](https://supabase.com/docs/guides/realtime/authorization#updating-rls-policies)
- A sessão da aplicação estática é acessível ao JavaScript da origem. A política CSP existente continua a restringir a execução de scripts. Use HTTPS e mantenha dependências e configuração de Auth atualizadas. [Checklist de produção do Supabase](https://supabase.com/docs/guides/security/production-checklist)
