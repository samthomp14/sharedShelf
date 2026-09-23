import { StyleSheet } from 'react-native';
import { CameraView, type BarcodeType } from 'expo-camera';

// Full-screen camera that reports scanned barcode values. Native uses
// expo-camera's scanner; web has its own implementation in
// BarcodeCamera.web.tsx.

export interface BarcodeCameraProps {
  onScanned: (data: string) => void;
  // The camera couldn't start (e.g. access blocked).
  onError: () => void;
}

// Module-level so the array's identity is stable across renders.
const BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e'];

export function BarcodeCamera({ onScanned, onError }: BarcodeCameraProps) {
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
      onBarcodeScanned={({ data }) => onScanned(data)}
      onMountError={onError}
    />
  );
}
