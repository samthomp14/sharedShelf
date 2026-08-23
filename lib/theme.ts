// Design tokens modeled after nyc-map-murex.vercel.app: near-black on white,
// sharp square corners, thin hairline borders with a soft shadow instead of
// fills, and Funnel Sans throughout.

export const colors = {
  text: '#0a0a0a',
  textMuted: '#666666',
  textFaint: '#999999',
  background: '#ffffff',
  border: '#e5e5e5',
  chipBackground: '#f2f2f2',
  danger: '#c00000',
  success: '#0a7d2c',
};

export const fonts = {
  regular: 'FunnelSans_400Regular',
  medium: 'FunnelSans_500Medium',
  semibold: 'FunnelSans_600SemiBold',
  bold: 'FunnelSans_700Bold',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// Every surface uses square corners — this is a deliberate 0 everywhere,
// not an oversight.
export const radius = 0;

export const shadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.08,
  shadowRadius: 3,
  elevation: 1,
};
