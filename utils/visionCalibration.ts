import { GAME_PROFILES, DetectionType } from './gameProfiles';

// Access global OpenCV instance
declare var cv: any;

export interface VisionProfile {
  type: DetectionType;
  roi: { x: number; y: number; w: number; h: number };
  bounds: {
    lower: number[];
    upper: number[];
    lower2?: number[]; // For Red wrap
    upper2?: number[];
  };
}

/**
 * Retrieves the deterministic configuration for a selected game profile.
 * Returns the exact ROI and hardcoded HSV color bounds for that game type.
 */
export function getProfileConfig(profileId: string): VisionProfile {
  const profile = GAME_PROFILES.find(p => p.id === profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`);
  }

  // Define hardcoded HSV bounds based on type
  // OpenCV HSV: H(0-180), S(0-255), V(0-255)
  let bounds: VisionProfile['bounds'];

  if (profile.type === 'PURPLE_HEADER') {
    // Purple: Approx H 130-160
    // Broad range to catch different screen brightnesses
    bounds = {
      lower: [125, 40, 40, 0],
      upper: [165, 255, 255, 0]
    };
  } else {
    // Red: Wrap around 0/180
    // Range 1: 0-10
    // Range 2: 170-180
    bounds = {
      lower: [0, 100, 100, 0],
      upper: [10, 255, 255, 0],
      lower2: [170, 100, 100, 0],
      upper2: [180, 255, 255, 0]
    };
  }

  return {
    type: profile.type,
    roi: profile.roi,
    bounds
  };
}

// Deprecated: Dynamic calibration removed in favor of deterministic profiles.
export function calibrateReference(image: any): any {
    throw new Error("Dynamic calibration is deprecated. Use getProfileConfig.");
}
