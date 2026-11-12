import { activeStreams, type Snapshot } from "../types";

const tones = {
  join: [440, 660],
  leave: [494, 330],
  share: [523, 659, 784],
};
type Sound = keyof typeof tones;

export function roomSounds(initial: Snapshot, self: string) {
  let previous = initial;
  let audio: AudioContext | undefined;

  const unlock = () => {
    if (typeof AudioContext === "undefined") return;
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  };

  return {
    unlock,
    update(next: Snapshot) {
      const before = previous;
      previous = next;
      if (!audio || audio.state !== "running") return;
      const context = audio;
      const sounds: Sound[] = [];
      const beforeMembers = new Set(before.members.map(member => member.user_id));
      const nextMembers = new Set(next.members.map(member => member.user_id));
      const beforeSharers = new Set(activeStreams(before).map(stream => stream.broadcaster_id));

      if ([...nextMembers].some(id => id !== self && !beforeMembers.has(id))) sounds.push("join");
      if ([...beforeMembers].some(id => id !== self && !nextMembers.has(id))) sounds.push("leave");
      if (activeStreams(next).some(stream => !beforeSharers.has(stream.broadcaster_id))) sounds.push("share");

      let start = context.currentTime;
      for (const sound of sounds) {
        for (const frequency of tones[sound]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.09, start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.12);
          start += 0.1;
        }
        start += 0.08;
      }
    },
    close() {
      if (audio) void audio.close().catch(() => {});
    },
  };
}
