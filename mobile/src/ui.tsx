import type { PropsWithChildren } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

export const color = {
  background: '#F4F8FF', white: '#FFFFFF', ink: '#0F172A', muted: '#56667C', line: '#E1EAF7',
  blue: '#2559DA', blueDark: '#1D47B4', tint: '#EAF1FF', green: '#087653', lightGreen: '#E5FAF0',
  red: '#A92836', lightRed: '#FCE8EE', violet: '#6933CA', lightViolet: '#F1EAFF',
  cyan: '#08738A', lightCyan: '#E4F7FC', amber: '#9B5309', lightAmber: '#FFF1DB',
};

export const gradient = {
  brand: 'linear-gradient(125deg, #2563EB 0%, #4446CF 57%, #6D32CB 100%)',
  blue: 'linear-gradient(135deg, #3678EF, #2354CF)',
  warm: 'linear-gradient(135deg, #B8540C, #D45A19)',
  soft: 'linear-gradient(125deg, #E8F1FF, #F0EDFF)',
};
export const surfaceShadow: ViewStyle = {
  shadowColor: '#244A89', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.09, shadowRadius: 8, elevation: 1,
};

export function Gradient({ children, style, image = gradient.brand }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; image?: string }>) {
  return <View style={[styles.gradient, style, { experimental_backgroundImage: image }]}>{children}</View>;
}

export function IconButton({ icon, label, action, disabled }: {
  icon: React.ComponentProps<typeof Feather>['name']; label: string; action: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={action} style={({ pressed }) => [styles.iconButton, (disabled || pressed) && styles.dim]}>
    <Feather name={icon} size={20} color={color.blueDark} />
  </Pressable>;
}

export function Page({ children }: PropsWithChildren) {
  return <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>{children}</ScrollView>;
}

export function Heading({ title, detail, eyebrow, action }: { title: string; detail?: string; eyebrow?: string; action?: React.ReactNode }) {
  return <View style={styles.heading}>
    <View style={styles.headingCopy}>
      {eyebrow ? <Text style={styles.detail}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
    {action}
  </View>;
}

export function Section({ children }: PropsWithChildren) {
  return <Text accessibilityRole="header" style={styles.section}>{children}</Text>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ label, action, secondary = false, disabled = false }: {
  label: string; action: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={action}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && styles.dim]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

export function Row({ title, detail, icon, onPress, tone = [color.blue, color.tint] }: {
  title: string; detail?: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void; tone?: readonly [string, string];
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.dim]}>
    <View style={[styles.iconBox, { backgroundColor: tone[1] }]}><Feather name={icon} size={19} color={tone[0]} /></View>
    <View style={styles.rowText}>
      <Text style={styles.rowTitle}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
    <Feather name="chevron-right" size={17} color={color.muted} />
  </Pressable>;
}

export function Field(props: TextInputProps) {
  return <TextInput {...props} placeholderTextColor={color.muted}
    style={[styles.input, props.multiline && styles.multiline, props.style]} />;
}

export function Notice({ text, error = false, busy = false }: { text: string; error?: boolean; busy?: boolean }) {
  return <View accessibilityLiveRegion="polite" style={[styles.notice, error && styles.errorNotice]}>
    {busy ? <ActivityIndicator color={color.blue} /> : null}
    <Text style={[styles.noticeText, error && styles.errorText]}>{text}</Text>
  </View>;
}

export const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 3, marginBottom: 3 },
  headingCopy: { flex: 1, gap: 3 },
  title: { color: color.ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.55, lineHeight: 34 },
  section: { color: color.ink, fontSize: 16, fontWeight: '800', lineHeight: 24 },
  detail: { color: color.muted, fontSize: 13, lineHeight: 21 },
  body: { color: color.ink, fontSize: 15, lineHeight: 25 },
  card: { ...surfaceShadow, backgroundColor: color.white, borderRadius: 22, borderWidth: 1, borderColor: color.line, padding: 15, gap: 11 },
  gradient: { backgroundColor: '#344AC9', overflow: 'hidden' },
  iconButton: { ...surfaceShadow, width: 44, height: 44, borderRadius: 22, backgroundColor: color.white, borderWidth: 1,
    borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  button: { backgroundColor: color.blue, minHeight: 48, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: color.white, borderWidth: 1, borderColor: '#D9E5FD' },
  buttonText: { color: color.white, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondaryText: { color: color.blueDark },
  dim: { opacity: 0.55 },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 5 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: color.ink, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  iconBox: { width: 41, height: 41, borderRadius: 13, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 13, minHeight: 48, padding: 12, color: color.ink, fontSize: 15 },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  notice: { backgroundColor: color.tint, padding: 12, borderRadius: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  noticeText: { color: color.blueDark, flex: 1, fontSize: 13, lineHeight: 20 },
  errorNotice: { backgroundColor: color.lightRed },
  errorText: { color: color.red },
});
