// Design tokens: "Vellum Ink" — ink black with a hint of blue on a
// matching off-white paper, softened corners, and a serif/sans pairing.
// A deliberate departure from the earlier square/near-black-on-white look.

import type { TextStyle } from 'react-native';

export const colors = {
  text: '#0e1116',
  textMuted: '#5a6068',
  textFaint: '#8a93a0',
  background: '#f5f7fa',
  border: 'rgba(14, 17, 22, 0.14)',
  chipBackground: '#e5e9ee',
  // Slate blue — the "hint" color. Used sparingly: status tags, small
  // accents. Never as a primary surface or button fill.
  accent: '#34506b',
  danger: '#c00000',
  success: '#0a7d2c',
};

export const fonts = {
  // Body copy, buttons, labels, chips.
  regular: 'WorkSans_400Regular',
  medium: 'WorkSans_500Medium',
  semibold: 'WorkSans_600SemiBold',
  bold: 'WorkSans_700Bold',
  // Headings, titles, names — an upright or italic serif for a literary,
  // less mechanical feel than the body face.
  display: 'LibreBaskerville_400Regular',
  displaySemibold: 'LibreBaskerville_600SemiBold',
  displayItalic: 'LibreBaskerville_400Regular_Italic',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// Height of the navigator header's content row, excluding the status-bar
// inset above it. React Navigation's web default is 64, which leaves a
// ~20px gap above the title; 52 keeps it ~14px below the status bar.
export const headerHeight = 52;

// Uniform corner radii for controls (buttons, inputs, filter pills, tags).
export const radius = {
  sm: 8,
  md: 12,
};

// Asymmetric "worn-edge" corners for surfaces that carry an image or stand
// in for one — book covers, avatars. Opposite corners share a radius
// (top-left/bottom-right vs. top-right/bottom-left), like a well-handled
// book rather than a sharp die-cut rectangle.
export const organicCorners = {
  borderTopLeftRadius: 16,
  borderTopRightRadius: 6,
  borderBottomRightRadius: 16,
  borderBottomLeftRadius: 6,
} as const;

export const shadow = {
  shadowColor: colors.text,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.1,
  shadowRadius: 16,
  elevation: 2,
};

export const inputStyle: TextStyle = {
  fontFamily: fonts.regular,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  paddingHorizontal: 14,
  paddingVertical: 12,
  marginBottom: 12,
  // Keep at 16+: iOS Safari zooms the page when focusing a smaller input.
  fontSize: 16,
  color: colors.text,
  backgroundColor: colors.background,
};
