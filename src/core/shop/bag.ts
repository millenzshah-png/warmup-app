/**
 * The shopping bag. Pure functions over an array of lines.
 */
import { priceOf, type Configuration } from './catalog';

export interface BagLine {
  id: string;
  config: Configuration;
  quantity: number;
}

export const MAX_LINE_QUANTITY = 9;

function sameConfiguration(a: Configuration, b: Configuration): boolean {
  return a.color === b.color && a.graphic === b.graphic && a.size === b.size && a.power === b.power;
}

/** Add a configuration, merging with an identical line when there is one. */
export function addToBag(bag: readonly BagLine[], config: Configuration): BagLine[] {
  const existing = bag.find((line) => sameConfiguration(line.config, config));
  if (existing) {
    return bag.map((line) =>
      line === existing ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + 1) } : line,
    );
  }
  const ids = new Set(bag.map((line) => line.id));
  let n = bag.length + 1;
  while (ids.has(`line-${n}`)) n += 1;
  return [...bag, { id: `line-${n}`, config: { ...config }, quantity: 1 }];
}

/** Set a line's quantity. Zero or less removes the line. */
export function setQuantity(bag: readonly BagLine[], lineId: string, quantity: number): BagLine[] {
  if (quantity <= 0) return bag.filter((line) => line.id !== lineId);
  const q = Math.min(MAX_LINE_QUANTITY, Math.round(quantity));
  return bag.map((line) => (line.id === lineId ? { ...line, quantity: q } : line));
}

export function removeLine(bag: readonly BagLine[], lineId: string): BagLine[] {
  return bag.filter((line) => line.id !== lineId);
}

export function bagCount(bag: readonly BagLine[]): number {
  return bag.reduce((sum, line) => sum + line.quantity, 0);
}

export function lineTotalUsd(line: BagLine, baseUsd?: number): number {
  return priceOf(line.config, baseUsd).totalUsd * line.quantity;
}

export function bagTotalUsd(bag: readonly BagLine[], baseUsd?: number): number {
  return bag.reduce((sum, line) => sum + lineTotalUsd(line, baseUsd), 0);
}
