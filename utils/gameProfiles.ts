export type DetectionType = 'PURPLE_HEADER' | 'RED_BUTTON';

export interface GameProfile {
  id: string;
  label: string;
  type: DetectionType;
  roi: { x: number; y: number; w: number; h: number }; // Normalized 0.0 - 1.0
}

export const GAME_PROFILES: GameProfile[] = [
  {
    id: 'c6a-4-3',
    label: 'C6a Standard (4:3)',
    type: 'PURPLE_HEADER',
    roi: { x: 0.15, y: 0.10, w: 0.7, h: 0.25 } // Top center area
  },
  {
    id: 'c6a-16-9',
    label: 'C6a Widescreen (16:9)',
    type: 'PURPLE_HEADER',
    roi: { x: 0.20, y: 0.10, w: 0.6, h: 0.25 } // Top center area
  },
  {
    id: 'vlt-dual',
    label: 'VLT Dual Screen',
    type: 'RED_BUTTON',
    roi: { x: 0.01, y: 0.82, w: 0.20, h: 0.16 } // Bottom left corner
  }
];