import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const url = process.env.STREAMLITE_TEST_SUPABASE_URL,
  key = process.env.STREAMLITE_TEST_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error(
    "Configure STREAMLITE_TEST_SUPABASE_URL e STREAMLITE_TEST_PUBLISHABLE_KEY para um projeto de testes.",
  );
  process.exit(1);
}
const clients = Array.from({ length: 3 }, () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
);
const tabs = clients.map(() => randomUUID());
let room;
const channels = [];
async function rpc(index, name, args) {
  const { data, error } = await clients[index].rpc(name, args);
  if (error) throw new Error(`RPC ${name} falhou (${error.code}).`);
  if (data?.error) throw new Error(data.error);
  return data;
}
async function subscribe(channel, expectDenied = false) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Realtime não respondeu em 15 segundos.")),
      15000,
    );
    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        clearTimeout(timer);
        expectDenied
          ? reject(new Error("Intruso conseguiu assinar canal privado."))
          : resolve();
      }
      if (state === "CHANNEL_ERROR") {
        clearTimeout(timer);
        expectDenied
          ? resolve()
          : reject(
              new Error(
                "Canal privado recusado. Confira migrations e configurações.",
              ),
            );
      }
    });
  });
}
try {
  const ids = [];
  for (const client of clients) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user)
      throw new Error(
        "Auth anônimo falhou. Use um projeto de testes com CAPTCHA desativado.",
      );
    ids.push(data.user.id);
  }
  const created = await rpc(0, "create_room", {
    p_nickname: "Teste A",
    p_client: tabs[0],
  });
  room = created.room.id;
  const joined = await rpc(1, "join_room", {
    p_invite: created.invite,
    p_nickname: "Teste B",
    p_client: tabs[1],
  });
  assert.equal(joined.members.length, 2);
  const { data: privateRooms, error: readError } = await clients[2]
    .from("rooms")
    .select("id")
    .eq("id", room);
  assert.equal(readError, null);
  assert.deepEqual(privateRooms, []);
  const topic = `room:${room}:${joined.room.channel_epoch}:user:${ids[0]}`;
  const sender = clients[0]
    .channel(topic, { config: { private: true, broadcast: { ack: true } } })
    .on("broadcast", { event: "integration" }, () => {});
  const receiver = clients[1].channel(topic, { config: { private: true } });
  const nonce = randomUUID();
  let messageTimer;
  const received = new Promise((resolve, reject) => {
    messageTimer = setTimeout(
      () => reject(new Error("Broadcast privado não chegou em 15 segundos.")),
      15000,
    );
    receiver.on("broadcast", { event: "integration" }, ({ payload }) => {
      if (payload.nonce === nonce) {
        clearTimeout(messageTimer);
        resolve();
      }
    });
  });
  // Attach rejection handler immediately; awaited after subscriptions below.
  void received.catch(() => {});
  channels.push(sender, receiver);
  await Promise.all([subscribe(sender), subscribe(receiver)]);
  assert.equal(
    await sender.send({
      type: "broadcast",
      event: "integration",
      payload: { nonce },
    }),
    "ok",
  );
  await received;
  const outsider = clients[2]
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "integration" }, () => {});
  channels.push(outsider);
  await subscribe(outsider, true);
  console.log(
    "PASSOU: Auth real, associação, RLS e Broadcast privado entre dois clientes; intruso recusado. Vídeo/áudio não fazem parte deste teste.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Falha na integração.",
  );
  process.exitCode = 1;
} finally {
  if (room)
    await Promise.allSettled(
      [0, 1].map((i) =>
        rpc(i, "leave_room", { p_room: room, p_client: tabs[i] }),
      ),
    );
  await Promise.all(clients.map((c) => c.removeAllChannels()));
  for (const client of clients) {
    await client.auth.signOut({ scope: "local" });
    client.realtime.disconnect();
  }
}
