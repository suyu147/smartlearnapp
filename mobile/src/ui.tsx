import type { PropsWithChildren } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const color = {
  background: '#F4F7FC', white: '#FFFFFF', ink: '#142445', muted: '#526686', line: '#DEE7F5',
  blue: '#194FDB', blueDark: '#153BA8', tint: '#EAF1FF', green: '#147653', lightGreen: '#E8F7F0',
  red: '#A92836', lightRed: '#FCEEF0',
};

export function Page({ children }: PropsWithChildren) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>{children}</ScrollView>;
}

export function Heading({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.heading}>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    {detail ? <Text style={styles.detail}>{detail}</Text> : null}
  </View>;
}

export function Section({ children }: PropsWithChildren) {
  return <Text accessibilityRole="header" style={styles.section}>{children}</Text>;
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({ label, action, secondary = false, disabled = false }: {
  label: string; action: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={action}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && styles.dim]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

export function Row({ title, detail, icon, onPress }: {
  title: string; detail?: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.dim]}>
    <View style={styles.iconBox}><Feather name={icon} size={20} color={color.blue} /></View>
    <View style={styles.rowText}>
      <Text style={styles.rowTitle}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
    <Feather name="chevron-right" size={20} color={color.muted} />
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
  page: { padding: 20, paddingBottom: 32, gap: 14 },
  heading: { marginTop: 5, marginBottom: 6, gap: 5 },
  title: { color: color.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.6, lineHeight: 41 },
  section: { color: color.ink, fontSize: 19, fontWeight: '800', marginTop: 6 },
  detail: { color: color.muted, fontSize: 13, lineHeight: 21 },
  body: { color: color.ink, fontSize: 15, lineHeight: 25 },
  card: { backgroundColor: color.white, borderRadius: 20, borderWidth: 1, borderColor: color.line, padding: 15, gap: 11 },
  button: { backgroundColor: color.blue, minHeight: 48, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: color.tint },
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
