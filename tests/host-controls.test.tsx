import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomPage } from "../src/pages/RoomPage";
import type { Snapshot } from "../src/types";
const room: Snapshot = {
  room: {
    id: "sala",
    name: "Sala",
    created_by: "host",
    channel_epoch: "epoch",
    expires_at: "2099-01-01",
    broadcaster_id: null,
    stream_session: null,
  },
  members: [
    { user_id: "host", client_id: "a", nickname: "Criador" },
    { user_id: "viewer", client_id: "b", nickname: "Visitante" },
  ],
};
afterEach(() => vi.unstubAllGlobals());
describe("Controles do host", () => {
  it("mostra ícone apenas ao host e apenas ao lado dos outros participantes", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("location", { origin: "https://example.com" });
    const html = renderToStaticMarkup(
      <RoomPage initial={room} self="host" invite="abc" onLeave={() => {}} />,
    );
    expect(html).toContain("Expulsar Visitante da sala");
    expect(html).not.toContain("Expulsar Criador da sala");
  });
  it("não mostra controle de expulsão ao espectador", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("location", { origin: "https://example.com" });
    expect(
      renderToStaticMarkup(
        <RoomPage
          initial={room}
          self="viewer"
          invite="abc"
          onLeave={() => {}}
        />,
      ),
    ).not.toContain("Expulsar ");
  });
});
