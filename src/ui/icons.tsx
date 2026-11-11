import type { ReactNode } from 'react';
import type { ModeIconName } from '../core/modes';

/** Stroke icons on a 24 unit grid. One path each, drawn in the current colour. */
const PATHS = {
  sun: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  heart: 'M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z',
  bus: 'M5 17h14M6 17V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9M8 17v2M16 17v2M8 11h8',
  mountain: 'M3 20l6-12 4 7 2-3 6 8H3z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  spark: 'M12 3l2.2 6.3L20.5 12l-6.3 2.2L12 20.5l-2.2-6.3L3.5 12l6.3-2.7L12 3z',
  shield: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z',
  list: 'M4 6h16M4 12h16M4 18h10',
  cells: 'M6 15V7a6 6 0 0 1 12 0v8M6 15h4V7H6zM14 15h4V7h-4zM6 15v3h4v-3M14 15v3h4v-3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12M18 6L6 18',
  bluetooth: 'M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  people: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  warning: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  gear: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  bag: 'M6 8h12l1 13H5L6 8zM9 8V6a3 3 0 0 1 6 0v2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

/** A decorative icon. Buttons that contain only an icon carry their own label. */
export function Icon({ name, size = 22, strokeWidth = 2 }: IconProps): ReactNode {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export const MODE_ICONS: Record<ModeIconName, IconName> = {
  sun: 'sun',
  heart: 'heart',
  bus: 'bus',
  mountain: 'mountain',
  moon: 'moon',
  spark: 'spark',
};

/** Image paths, relative so the build works from any folder. */
export const IMAGES = {
  logo: './img/logo.webp',
  hemLogo: './img/hem-logo.webp',
  hoodieFront: './img/hoodie-front.webp',
  hoodieBack: './img/hoodie-back.webp',
  hoodieThumb: './img/hoodie-thumb.webp',
  shopBlackFront: './img/shop-black-front.jpg',
  shopBoneBack: './img/shop-bone-back.jpg',
} as const;
