# Administração de salas

O botão **Administração** aparece no topo da página inicial e da sala. O servidor valida usuário e senha; as permissões administrativas não dependem de esconder esse botão. Participantes anônimos não podem executar as RPCs administrativas.

## Ativar no projeto Supabase

1. Abra o **SQL Editor** do projeto e execute o conteúdo de `supabase/migrations/202611060005_admin.sql` uma vez, depois das migrations anteriores. Isso adiciona as funções administrativas e altera a cota para três salas **ativas** criadas na última hora por usuário. Salas finalizadas liberam essa cota; o limitador de tentativas por minuto continua existindo.
2. O arquivo local `.env.admin.local` já foi preparado nesta máquina com o usuário `Admin`, o hash da senha solicitada, um segredo aleatório para assinar sessões e a origem de produção. Ele está ignorado pelo Git. Não publique esse arquivo nem adicione essas variáveis ao Cloudflare ou com prefixo `VITE_`.
3. No PowerShell, dentro de `E:\StreamLine`, execute os comandos abaixo. É necessário Node.js 24 e npm disponíveis. O primeiro comando abrirá a autenticação da sua conta Supabase; os demais enviam os segredos e publicam a função. Não é necessário informar a senha do banco.

```powershell
cd E:\StreamLine
npx supabase login
npx supabase secrets set --project-ref gfxykbrguweeylzgbvbu --env-file .env.admin.local
npx supabase functions deploy admin-panel --project-ref gfxykbrguweeylzgbvbu
```

Se somente o npm local deste workspace estiver disponível, substitua cada `npx supabase` por `node .tools/package/bin/npm-cli.js exec --yes --package=supabase -- supabase`.

A função usa a chave de servidor injetada pelo ambiente Supabase (`SUPABASE_SECRET_KEYS.default`, com compatibilidade para `SUPABASE_SERVICE_ROLE_KEY`). Nenhuma delas é enviada ao navegador. `verify_jwt = false` em `supabase/config.toml` permite o login administrativo sem sessão Auth; a própria função exige senha ou token administrativo válido para autorizar operações.

Alternativa para os segredos: no Dashboard, **Edge Functions → Secrets**, cadastre as quatro variáveis do arquivo local. Ainda é preciso publicar os dois arquivos da função `admin-panel` com o comando acima. [Documentação oficial de segredos](https://supabase.com/docs/guides/functions/secrets).

## Usar

1. Abra https://streamline-cfw.pages.dev e clique em **Administração**.
2. Entre com o usuário e a senha configurados.
3. A lista mostra todas as salas ainda não expiradas, inclusive salas sem participantes, com contagem de participantes recentes e indicação de transmissão.
4. Clique em **Finalizar sala** e confirme a sala exibida. O convite é invalidado, os participantes são removidos e a transmissão perde sua autorização. A remoção se propaga pelo aviso Realtime e pela próxima reconciliação: normalmente até 20 segundos no transmissor ou 30 segundos nos espectadores. Abas suspensas conferem a autorização ao retomar.

A listagem é consultada somente ao entrar, ao clicar em **Atualizar** ou após finalizar uma sala. O painel é carregado sob demanda e não mantém um canal Realtime ou consultas periódicas adicionais.

## Sessão e troca de senha

O token fica somente na memória do painel e expira após 15 minutos. Fechar o painel ou clicar em **Sair** apaga a sessão local. A senha é armazenada no servidor como PBKDF2-SHA256 com salt aleatório e 600 mil iterações. Há um orçamento global de 20 tentativas de login a cada janela de 15 minutos, persistido no banco.

Quem conhecer as credenciais poderá entrar: este login compartilhado não verifica a identidade pessoal do proprietário. Para trocar a senha e revogar tokens emitidos, execute `node scripts/configure-admin.mjs`, informe a nova senha no prompt oculto e envie novamente o arquivo com `supabase secrets set`. O script também gera um novo segredo de sessão. Não é necessário publicar o frontend novamente.

Se usar outro domínio, atualize `ALLOWED_ORIGINS` no arquivo local e envie os segredos novamente. Use origens completas sem barra final, separadas por vírgula; para teste local, acrescente `http://localhost:5173` explicitamente.

## Validação

Os testes automatizados verificam autenticação, token adulterado/expirado, origem não autorizada, limitação de tentativas, bloqueio das RPCs para participantes, encerramento e liberação de cota. A execução SQL local usa PostgreSQL WASM (PGlite); a Edge Function hospedada e a propagação pelo Realtime gerenciado ainda precisam ser testadas após a configuração real.
