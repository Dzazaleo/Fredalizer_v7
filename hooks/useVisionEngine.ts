import { useState, useRef, useCallback, useEffect } from 'react';
import { getProfileConfig, VisionProfile } from '../utils/visionCalibration';
import { scanFrame } from '../utils/visionDetection';

export interface DetectionRange {
  start: number;
  end: number;
  confidence: number;
}

interface VisionState {
  isProcessing: boolean;
  progress: number;
  status: 'idle' | 'initializing' | 'calibrating' | 'processing' | 'completed' | 'error';
  detections: DetectionRange[];
}

// Access global OpenCV instance
declare var cv: any;

function processDetections(timestamps: number[]): DetectionRange[] {
  if (timestamps.length === 0) return [];

  const sorted = [...timestamps].sort((a, b) => a - b);
  const ranges: DetectionRange[] = [];
  
  let start = sorted[0];
  let prev = sorted[0];
  
  // Tolerance for bridging gaps
  const TOLERANCE = 2.0;

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr - prev > TOLERANCE) {
      ranges.push({ start, end: prev, confidence: 1.0 });
      start = curr;
    }
    prev = curr;
  }
  ranges.push({ start, end: prev, confidence: 1.0 });

  return ranges;
}

export const useVisionEngine = () => {
  const [state, setState] = useState<VisionState>({
    isProcessing: false,
    progress: 0,
    status: 'idle',
    detections: []
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawDetectionsRef = useRef<number[]>([]);
  const lastProcessedTimeRef = useRef<number>(-1);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    video.style.position = 'fixed';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0.01';
    video.style.pointerEvents = 'none';
    video.style.zIndex = '-9999';
    
    document.body.appendChild(video);
    videoElementRef.current = video;

    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;

    return () => {
      if (videoElementRef.current && document.body.contains(videoElementRef.current)) {
        document.body.removeChild(videoElementRef.current);
      }
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const processVideo = useCallback(async (videoUrl: string, profileId: string): Promise<DetectionRange[]> => {
    if (typeof cv === 'undefined') {
      console.error("OpenCV is not loaded");
      setState(prev => ({ ...prev, status: 'error' }));
      return [];
    }

    setState({
      isProcessing: true,
      progress: 0,
      status: 'initializing',
      detections: []
    });
    rawDetectionsRef.current = [];
    lastProcessedTimeRef.current = -1;
    rafIdRef.current = null;
    
    let isTrackingSequence = false;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;
    
    let profile: VisionProfile | undefined;

    try {
      // 1. Load Profile
      try {
        profile = getProfileConfig(profileId);
      } catch (e) {
        console.error("Profile Error:", e);
        setState(prev => ({ ...prev, status: 'error' }));
        return [];
      }

      setState(prev => ({ ...prev, status: 'processing' }));
      
      const video = videoElementRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Could not get canvas context");

      video.pause();
      video.removeAttribute('src');
      video.src = videoUrl;
      video.playbackRate = 1.0; 
      video.load();
      
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      // Fixed width for processing
      const processWidth = 640;
      const baseScale = processWidth / video.videoWidth;
      const processHeight = Math.floor(video.videoHeight * baseScale);
      
      canvas.width = processWidth;
      canvas.height = processHeight;

      const performPrecisionScan = async (targetTime: number) => {
        if (targetTime < 0.2 || signal.aborted) return;
        video.pause();
        const startTime = targetTime - 0.2;
        video.currentTime = startTime;
        
        await new Promise(r => { 
           const handler = () => {
              video.removeEventListener('seeked', handler);
              r(null);
           };
           video.addEventListener('seeked', handler);
        });
        
        if (signal.aborted) return;
        await video.play();

        await new Promise<void>((resolve) => {
             const scanLoop = (_now: number, _meta: any) => {
                 if (signal.aborted) { resolve(); return; }
                 const t = video.currentTime;
                 if (t >= targetTime || video.paused) {
                     resolve();
                     return;
                 }
                 ctx.drawImage(video, 0, 0, processWidth, processHeight);
                 try {
                     const imageData = ctx.getImageData(0, 0, processWidth, processHeight);
                     const mat = cv.matFromImageData(imageData);
                     const conf = scanFrame(mat, profile!, false);
                     mat.delete();
                     if (conf > 0.5) rawDetectionsRef.current.push(t);
                 } catch(e) { console.error(e); }
                 (video as any).requestVideoFrameCallback(scanLoop);
             };
             (video as any).requestVideoFrameCallback(scanLoop);
        });
      };

      await new Promise<void>(async (resolve, reject) => {
        video.onended = () => resolve();
        video.onerror = (e) => reject(e);

        const SAMPLE_INTERVAL = 0.1;
        let uiUpdateCounter = 0;
        let frameCount = 0;
        
        const processFrame = async (now: number, metadata: any) => {
          frameCount++;

          if (signal.aborted) {
            video.pause();
            return;
          }

          if (frameCount % 2 !== 0) {
            if (!video.paused && !video.ended) {
              rafIdRef.current = (video as any).requestVideoFrameCallback(processFrame);
            }
            return;
          }

          try {
            const currentTime = metadata.mediaTime;
            
            if (currentTime - lastProcessedTimeRef.current >= SAMPLE_INTERVAL) {
              lastProcessedTimeRef.current = currentTime;

              ctx.drawImage(video, 0, 0, processWidth, processHeight);
              
              let mat: any = null;
              try {
                const imageData = ctx.getImageData(0, 0, processWidth, processHeight);
                mat = cv.matFromImageData(imageData);
                
                // Scan Frame using Profile
                const confidence = scanFrame(mat, profile!, false); 

                // Hysteresis
                let nextTrackingState = isTrackingSequence;
                if (isTrackingSequence) {
                    if (confidence <= 0.5) nextTrackingState = false;
                } else {
                    if (confidence >= 0.9) nextTrackingState = true;
                }

                // Edge Detection
                const isRising = !isTrackingSequence && nextTrackingState;
                const isFalling = isTrackingSequence && !nextTrackingState;

                if (isRising || isFalling) {
                   await performPrecisionScan(currentTime);
                }

                isTrackingSequence = nextTrackingState;
                if (isTrackingSequence) {
                  rawDetectionsRef.current.push(currentTime);
                }

              } finally {
                if (mat) mat.delete();
              }
              
              await new Promise(r => setTimeout(r, 0));
            }

            uiUpdateCounter++;
            if (uiUpdateCounter % 30 === 0) {
              const progress = Math.min(100, Math.round((metadata.mediaTime / video.duration) * 100));
              setState(prev => ({ ...prev, progress }));
            }

            if (!video.paused && !video.ended) {
              rafIdRef.current = (video as any).requestVideoFrameCallback(processFrame);
            }
          } catch (e) {
            console.error("Frame processing error:", e);
          }
        };

        rafIdRef.current = (video as any).requestVideoFrameCallback(processFrame);
        await video.play();
      });

      if (!signal.aborted) {
        const ranges = processDetections(rawDetectionsRef.current);
        setState(prev => ({ 
          ...prev, 
          status: 'completed', 
          progress: 100, 
          isProcessing: false,
          detections: ranges
        }));
        return ranges;
      }

    } catch (error) {
      if (!signal.aborted) {
        console.error("[VisionEngine] Processing Error:", error);
        setState(prev => ({ ...prev, status: 'error', isProcessing: false }));
      }
    } finally {
      if (videoElementRef.current) {
         const vid = videoElementRef.current;
         vid.pause();
         if (rafIdRef.current !== null) {
           (vid as any).cancelVideoFrameCallback(rafIdRef.current);
           rafIdRef.current = null;
         }
         vid.removeAttribute('src');
         vid.load(); 
      }
    }
    return [];
  }, []);

  return {
    ...state,
    processVideo
  };
};
