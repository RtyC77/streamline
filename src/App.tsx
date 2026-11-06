import { useState, useCallback, lazy, Suspense } from "react";
import { HomePage } from "./pages/HomePage";
const RoomPage = lazy(() =>
  import("./pages/RoomPage").then((module) => ({ default: module.RoomPage })),
);
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
    <Suspense fallback={<p role="status">Abrindo sala…</p>}>
      <RoomPage
        initial={room.entry}
        self={room.self}
        invite={room.invite}
        onLeave={leave}
      />
    </Suspense>
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
