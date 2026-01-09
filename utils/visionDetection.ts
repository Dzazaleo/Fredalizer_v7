import { VisionProfile } from './visionCalibration';

declare var cv: any;

/**
 * Scans a frame using Deterministic ROI Profiles.
 * 
 * Logic:
 * 1. Strict Crop: Crops the frame to the exact ROI defined in the profile.
 * 2. Color Mask: Applies HSV masking based on the profile type (Purple vs Red).
 * 3. Density Check: Returns 1.0 confidence if the target color density exceeds 30%.
 */
export function scanFrame(srcFrame: any, profile: VisionProfile, debugMode: boolean = false): number {
  if (typeof cv === 'undefined' || !profile) return 0;

  let confidence = 0;
  
  // Mats
  let roiMat: any = null;
  let hsvMat: any = null;
  let bgMask: any = null;
  let bgMask2: any = null;
  
  // Bounds
  let bgLower: any = null;
  let bgUpper: any = null;
  let bgLower2: any = null;
  let bgUpper2: any = null;

  try {
    const cols = srcFrame.cols;
    const rows = srcFrame.rows;

    // 1. Strict ROI Crop
    const roiX = Math.floor(cols * profile.roi.x);
    const roiY = Math.floor(rows * profile.roi.y);
    const roiW = Math.floor(cols * profile.roi.w);
    const roiH = Math.floor(rows * profile.roi.h);

    // Safety check for bounds
    if (roiX < 0 || roiY < 0 || (roiX + roiW) > cols || (roiY + roiH) > rows) {
        if (debugMode) console.warn("[Vision] ROI out of bounds");
        return 0;
    }

    const rect = new cv.Rect(roiX, roiY, roiW, roiH);
    roiMat = srcFrame.roi(rect);

    // 2. Convert Crop to HSV
    hsvMat = new cv.Mat();
    cv.cvtColor(roiMat, hsvMat, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsvMat, hsvMat, cv.COLOR_RGB2HSV);

    // 3. Create Color Mask
    bgMask = new cv.Mat();
    bgLower = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), profile.bounds.lower);
    bgUpper = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), profile.bounds.upper);
    
    cv.inRange(hsvMat, bgLower, bgUpper, bgMask);

    // Handle Split Range (for Red)
    if (profile.bounds.lower2 && profile.bounds.upper2) {
        bgMask2 = new cv.Mat();
        bgLower2 = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), profile.bounds.lower2);
        bgUpper2 = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), profile.bounds.upper2);
        
        cv.inRange(hsvMat, bgLower2, bgUpper2, bgMask2);
        cv.bitwise_or(bgMask, bgMask2, bgMask);
    }

    // 4. Density Calculation
    const totalPixels = roiW * roiH;
    const matchPixels = cv.countNonZero(bgMask);
    const density = matchPixels / totalPixels;

    // Threshold: 30% coverage of the specific ROI
    if (density > 0.30) {
        confidence = 1.0;
        if (debugMode) console.log(`[Vision] Match ${profile.type}: ${density.toFixed(2)}`);
    } else {
        confidence = 0.0;
    }

  } catch (err) {
    console.error("scanFrame Error", err);
  } finally {
    // Strict Cleanup
    if (roiMat) roiMat.delete();
    if (hsvMat) hsvMat.delete();
    if (bgMask) bgMask.delete();
    if (bgMask2) bgMask2.delete();
    if (bgLower) bgLower.delete();
    if (bgUpper) bgUpper.delete();
    if (bgLower2) bgLower2.delete();
    if (bgUpper2) bgUpper2.delete();
  }

  return confidence;
}
