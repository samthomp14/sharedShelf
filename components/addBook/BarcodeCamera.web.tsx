import { useEffect, useRef } from 'react';
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import { log } from '../../lib/log';
import type { BarcodeCameraProps } from './BarcodeCamera';

// Our own web scanner instead of expo-camera's: iOS Safari has no native
// BarcodeDetector, so decoding runs through ZXing (WASM), and expo-camera's
// web path feeds it the camera's default ~640×480 stream, whole-frame, every
// 300ms — too blurry and too slow for the thin bars of a book's EAN-13.
// Here we ask for a 1080p stream and decode only the middle band (where the
// viewfinder is) several times a second.

const FORMATS: ('ean_13' | 'ean_8' | 'upc_a' | 'upc_e')[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const SCAN_INTERVAL_MS = 120;
// Centered crop that's decoded, as a share of the video frame. Generous
// around the on-screen viewfinder so a slightly off-center barcode still reads.
const CROP_WIDTH = 0.9;
const CROP_HEIGHT_OF_WIDTH = 0.6;

export function BarcodeCamera({ onScanned, onError }: BarcodeCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The scan loop outlives renders; read the latest callbacks through refs.
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reportedDetectError = false;

    // Start fetching the ZXing WASM now, in parallel with the camera starting.
    prepareZXingModule({ fireImmediately: true }).catch((error) =>
      log.error('scanner.decoder_load_failed', { error })
    );
    const detector = new BarcodeDetector({ formats: FORMATS });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function stopStream() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    async function scanFrame() {
      if (cancelled) return;
      const video = videoRef.current;
      if (ctx && video && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const sw = Math.round(vw * CROP_WIDTH);
        const sh = Math.min(vh, Math.round(sw * CROP_HEIGHT_OF_WIDTH));
        if (canvas.width !== sw || canvas.height !== sh) {
          canvas.width = sw;
          canvas.height = sh;
        }
        ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, sw, sh);
        try {
          const results = await detector.detect(canvas);
          if (!cancelled) {
            for (const result of results) onScannedRef.current(result.rawValue);
          }
        } catch (error) {
          // A failed frame (e.g. WASM still loading) — just try the next one,
          // but report the first failure of each session so a broken decoder shows up.
          if (!reportedDetectError) {
            reportedDetectError = true;
            log.warn('scanner.detect_failed', { error });
          }
        }
      }
      if (!cancelled) timer = setTimeout(scanFrame, SCAN_INTERVAL_MS);
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch (error) {
        log.error('scanner.camera_failed', { error });
        if (!cancelled) onErrorRef.current();
        return;
      }
      if (cancelled) {
        stopStream();
        return;
      }

      // Continuous autofocus where the browser exposes it (Android Chrome);
      // iOS doesn't, and focuses on its own.
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as { focusMode?: string[] } | undefined;
      if (capabilities?.focusMode?.includes('continuous')) {
        track
          .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
          .catch(() => {});
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      scanFrame();
    }

    start();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopStream();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      }}
    />
  );
}
