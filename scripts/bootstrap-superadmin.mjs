import { createClient } from "@supabase/supabase-js";

const email = "ropolatto77@gmail.com";
const username = "Rod";
const url = process.env.SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SUPERADMIN_BOOTSTRAP_PASSWORD;

class BootstrapError extends Error {}

function requireConfig() {
  const endpoint = URL.parse(url ?? "");
  if (endpoint?.protocol !== "https:" || endpoint.username || endpoint.password ||
      !publicKey?.startsWith("sb_publishable_") || !adminKey || adminKey === publicKey ||
      !password || password.length < 12 || Buffer.byteLength(password) > 72) {
    throw new BootstrapError("Confira a URL HTTPS, as chaves do projeto e a senha de inicialização.");
  }
}

function step(result, message) {
  if (result.error) throw new BootstrapError(message);
  return result.data;
}

async function findAccount(admin) {
  const perPage = 100;
  for (let page = 1; ; page++) {
    const data = step(await admin.listUsers({ page, perPage }), "Falha ao consultar o Supabase Auth.");
    const existing = data.users.find((user) => user.email?.toLowerCase() === email);
    if (existing) return existing;
    if (!data.nextPage || data.users.length < perPage) return null;
  }
}

async function bootstrap() {
  requireConfig();
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const trusted = createClient(url, adminKey, options);
  const browser = createClient(url, publicKey, options);
  const admin = trusted.auth.admin;
  let account = await findAccount(admin);
  if (!account) {
    const result = await admin.createUser({
      email, password, email_confirm: true, user_metadata: { username },
    });
    // A retry or a concurrent execution may have created the same account.
    account = result.data?.user ?? await findAccount(admin);
    if (!account) throw new BootstrapError("Falha ao criar a conta definitiva.");
  }
  if (!account.email_confirmed_at || account.is_anonymous)
    throw new BootstrapError("Confirme o e-mail da conta existente antes da inicialização.");

  try {
    const signedIn = step(await browser.auth.signInWithPassword({
      email, password,
      options: { captchaToken: process.env.SUPERADMIN_BOOTSTRAP_CAPTCHA_TOKEN || undefined },
    }), "O login de Rod falhou. Confira a senha e a configuração de CAPTCHA.");
    if (!signedIn.session || signedIn.user?.id !== account.id)
      throw new BootstrapError("A sessão não corresponde à conta definitiva.");
    step(await trusted.rpc("bootstrap_streamlite_superadmin", { p_id: account.id }),
      "Falha ao vincular e promover a conta. Verifique a migration e a disponibilidade do nome Rod.");
    const users = step(await browser.rpc("staff_users", { p_search: email }),
      "A sessão de Rod não conseguiu acessar a lista do painel.");
    const verified = users.find((user) => user.id === account.id);
    if (verified?.username !== username || verified?.role !== "superadmin" ||
        verified?.status !== "active" || verified?.can_create_rooms !== true) {
      throw new BootstrapError("O perfil definitivo não passou na validação.");
    }
    step(await browser.rpc("staff_audit"), "A sessão de Rod não conseguiu consultar o histórico.");
    step(await browser.rpc("staff_rooms"), "A sessão de Rod não conseguiu listar as salas.");
    console.log("Login de Rod e acesso às operações do painel confirmados.");
  } finally {
    await browser.auth.signOut({ scope: "local" });
  }
}

bootstrap().catch((error) => {
  console.error(error instanceof BootstrapError ? error.message : "Falha inesperada na inicialização.");
  process.exitCode = 1;
});
