import { useState, useCallback } from "react";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import type { Entry } from "./types";
export function App() {
  const [message, setMessage] = useState("");
  const [room, setRoom] = useState<{
    entry: Entry;
    self: string;
    invite: string;
  } | null>(null);
  const leave = useCallback((reason?: string) => {
    setMessage(reason ?? "");
    setRoom(null);
    if (!reason) history.replaceState(null, "", "/");
  }, []);
  return room ? (
    <RoomPage
      initial={room.entry}
      self={room.self}
      invite={room.invite}
      onLeave={leave}
    />
  ) : (
    <HomePage
      message={message}
      onEnter={(entry, self, invite) => {
        setMessage("");
        setRoom({ entry, self, invite });
      }}
    />
  );
}
