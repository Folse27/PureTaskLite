/** Apple system colors, used as the preset palette for statuses and priorities. */
export const PALETTE = [
  { name: "Red", value: "#FF3B30" },
  { name: "Orange", value: "#FF9500" },
  { name: "Yellow", value: "#FFCC00" },
  { name: "Green", value: "#34C759" },
  { name: "Mint", value: "#00C7BE" },
  { name: "Teal", value: "#30B0C7" },
  { name: "Cyan", value: "#32ADE6" },
  { name: "Blue", value: "#007AFF" },
  { name: "Indigo", value: "#5856D6" },
  { name: "Purple", value: "#AF52DE" },
  { name: "Pink", value: "#FF2D55" },
  { name: "Brown", value: "#A2845E" },
  { name: "Gray", value: "#8E8E93" },
] as const;

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_STATUSES = [
  { name: "To do", color: "#8E8E93" },
  { name: "In progress", color: "#007AFF" },
  { name: "Done", color: "#34C759" },
];

export const DEFAULT_PRIORITIES = [
  { name: "Urgent", color: "#FF3B30" },
  { name: "High", color: "#FF9500" },
  { name: "Normal", color: "#32ADE6" },
  { name: "Low", color: "#8E8E93" },
];
