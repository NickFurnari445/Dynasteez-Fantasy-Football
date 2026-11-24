export function americanOdds(p: number) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  const magnitude = p <= 0.5 ? 100 * (1 - p) / p : 100 * p / (1 - p);
  const step = magnitude <= 200 ? 5 : 10;
  return (p <= 0.5 ? "+" : "−") + Math.round(magnitude / step) * step;
}

export function probabilityLabel(p: number, draws = 20_000, confirmed = false) {
  const bound = (1 - 0.05 ** (1 / draws)) * 100;
  if (!confirmed && p === 0) return `<${bound.toFixed(3)}%`;
  if (!confirmed && p === 1) return `>${(100 - bound).toFixed(3)}%`;
  return `${(p * 100).toFixed(1)}%`;
}

export function pointSpreads(a: number, b: number): [string, string] {
  const half = Math.round(Math.abs(a - b) * 2) / 2;
  if (!half) return ["PK", "PK"];
  const values: [string, string] = [`−${half.toFixed(1)}`, `+${half.toFixed(1)}`];
  return a >= b ? values : [values[1], values[0]];
}

export const normalScore = (mean: number, deviation: number, random: () => number) =>
  mean + deviation * Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
