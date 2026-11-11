/**
 * The storefront catalogue and pricing.
 */
import { CELL_CAPACITY_MAH, CELL_MASS_G, RUNTIME_FROM_FULL_H } from '../spec';
import { HOODIE_SIZES, type HoodieSize } from '../types';

export const BASE_PRICE_USD = 199;

export type ColorId = 'black' | 'heather' | 'bone' | 'rust';
export type GraphicId = 'plain' | 'tonal' | 'orbit' | 'custom';
export type PowerId = 'standard' | 'spare';

export interface ColorOption {
  id: ColorId;
  name: string;
  /** Swatch colour. */
  hex: string;
  /** Tint laid over the black product photo to preview the colour. */
  tint: string;
  /** Ink colour that reads on this fabric. */
  ink: string;
}

export interface GraphicOption {
  id: GraphicId;
  name: string;
  detail: string;
  priceUsd: number;
  /** Text laid over the preview, for the upload-your-own option. */
  previewText: string;
  /** This graphic is shown on the back view. */
  showsBack: boolean;
}

export interface PowerOption {
  id: PowerId;
  name: string;
  detail: string;
  priceUsd: number;
}

export const COLORS: readonly ColorOption[] = [
  { id: 'black', name: 'Black', hex: '#1D1D1F', tint: '#000000', ink: '#FFFFFF' },
  { id: 'heather', name: 'Heather', hex: '#8E8E93', tint: '#8E8E93', ink: '#1D1D1F' },
  { id: 'bone', name: 'Bone', hex: '#E8E2D4', tint: '#E8E2D4', ink: '#1D1D1F' },
  { id: 'rust', name: 'Rust', hex: '#B4412A', tint: '#B4412A', ink: '#FFFFFF' },
];

export const GRAPHICS: readonly GraphicOption[] = [
  { id: 'plain', name: 'Plain', detail: 'Hem logo only', priceUsd: 0, previewText: '', showsBack: false },
  { id: 'tonal', name: 'Tonal mark', detail: 'Left chest embroidery', priceUsd: 0, previewText: '', showsBack: false },
  {
    id: 'orbit',
    name: 'Orbit back print',
    detail: 'Drop 01 · line-art on the back',
    priceUsd: 20,
    previewText: '',
    showsBack: true,
  },
  { id: 'custom', name: 'Your design', detail: 'Upload after checkout', priceUsd: 30, previewText: 'YOUR ART', showsBack: false },
];

const maxRuntimeH = RUNTIME_FROM_FULL_H[0];

export const POWER_OPTIONS: readonly PowerOption[] = [
  {
    id: 'standard',
    name: 'Two snap-in cells',
    detail: `Included · ${CELL_CAPACITY_MAH.toLocaleString('en-US')} mAh and ${CELL_MASS_G} g each, up to ${maxRuntimeH} h`,
    priceUsd: 0,
  },
  {
    id: 'spare',
    name: 'Spare cell pair',
    detail: `Add-on · swap in seconds for an all-day ${maxRuntimeH * 2} h`,
    priceUsd: 35,
  },
];

export const SHOP_SIZES: readonly HoodieSize[] = HOODIE_SIZES;

export interface Configuration {
  color: ColorId;
  graphic: GraphicId;
  size: HoodieSize;
  power: PowerId;
}

export function defaultConfiguration(): Configuration {
  return { color: 'black', graphic: 'plain', size: 'M', power: 'standard' };
}

export function findColor(id: ColorId): ColorOption {
  return COLORS.find((c) => c.id === id) ?? (COLORS[0] as ColorOption);
}

export function findGraphic(id: GraphicId): GraphicOption {
  return GRAPHICS.find((g) => g.id === id) ?? (GRAPHICS[0] as GraphicOption);
}

export function findPower(id: PowerId): PowerOption {
  return POWER_OPTIONS.find((p) => p.id === id) ?? (POWER_OPTIONS[0] as PowerOption);
}

export interface PriceBreakdown {
  baseUsd: number;
  graphicUsd: number;
  powerUsd: number;
  totalUsd: number;
}

export function priceOf(config: Configuration, baseUsd: number = BASE_PRICE_USD): PriceBreakdown {
  const graphicUsd = findGraphic(config.graphic).priceUsd;
  const powerUsd = findPower(config.power).priceUsd;
  return { baseUsd, graphicUsd, powerUsd, totalUsd: baseUsd + graphicUsd + powerUsd };
}

/** "Black · Plain · M" */
export function configurationSummary(config: Configuration): string {
  return `${findColor(config.color).name} · ${findGraphic(config.graphic).name} · ${config.size}`;
}

/** "+$20" or "Included". */
export function priceLabel(priceUsd: number): string {
  return priceUsd > 0 ? `+$${priceUsd}` : 'Included';
}
