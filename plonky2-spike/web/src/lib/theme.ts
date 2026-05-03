export const COLOR_SCHEMES = [
  { id: "paper", label: "Paper" },
  { id: "graphite", label: "Graphite" },
  { id: "coast", label: "Coast" },
  { id: "field", label: "Field" },
] as const;

export type ColorScheme = (typeof COLOR_SCHEMES)[number]["id"];

