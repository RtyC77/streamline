import type { CSSProperties } from "react";
const paths = {
  play: "m9 5 11 7-11 7V5Z",
  screen: "M4 4h16v12H4z M8 21h8 M12 16v5",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  link: "m10 13 4-4 M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0 M16 9l2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0",
  copy: "M9 9h12v12H9z M15 5V3H3v12h2",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.8",
  lock: "M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z",
  exit: "M9 3H3v18h6 M10 12h12 M17 7l5 5-5 5",
  full: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5",
  sound: "M11 4 5 9H2v6h3l6 5V4Z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14",
  stop: "M5 5h14v14H5z",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20V7",
  check: "m5 12 4 4L20 5",
  close: "m5 5 14 14 M19 5 5 19",
  removeUser:
    "M15 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 9h6",
} as const;
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="play" size={19} />
      </span>
      Stream<span className="brand-lite">Lite</span>
    </span>
  );
}
