import { useState } from "react";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import type { Entry } from "./types";
export function App() {
  const [room, setRoom] = useState<{
    entry: Entry;
    self: string;
    invite: string;
  } | null>(null);
  return room ? (
    <RoomPage
      initial={room.entry}
      self={room.self}
      invite={room.invite}
      onLeave={() => {
        setRoom(null);
        history.replaceState(null, "", "/");
      }}
    />
  ) : (
    <HomePage
      onEnter={(entry, self, invite) => setRoom({ entry, self, invite })}
    />
  );
}
