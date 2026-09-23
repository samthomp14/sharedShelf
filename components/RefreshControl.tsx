import { RefreshControl as NativeRefreshControl, type RefreshControlProps } from 'react-native';
import { colors } from '../lib/theme';

// Native: the platform pull-to-refresh, tinted to match the theme.
// Web has its own implementation in RefreshControl.web.tsx, because
// react-native-web's RefreshControl renders nothing and ignores the gesture.
export function RefreshControl(props: RefreshControlProps) {
  return <NativeRefreshControl tintColor={colors.text} colors={[colors.text]} {...props} />;
}
