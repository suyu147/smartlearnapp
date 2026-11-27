import { memo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown, { type RenderRules } from 'react-native-markdown-display';
import { markdown, normalizeMarkdown } from './markdown';
import { color } from './ui';

const styles = StyleSheet.create({
  body: { color: color.ink, fontSize: 15, lineHeight: 24, minWidth: 0 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  heading1: { color: color.ink, fontSize: 22, lineHeight: 30, fontWeight: '800', marginBottom: 6 },
  heading2: { color: color.ink, fontSize: 19, lineHeight: 27, fontWeight: '800', marginBottom: 5 },
  heading3: { color: color.blueDark, fontSize: 16, lineHeight: 24, fontWeight: '700', marginBottom: 4 },
  heading4: { color: color.ink, fontSize: 15, fontWeight: '700' },
  heading5: { color: color.ink, fontSize: 15, fontWeight: '700' },
  heading6: { color: color.ink, fontSize: 15, fontWeight: '700' },
  link: { color: color.blue },
  code_inline: { fontFamily: 'monospace', backgroundColor: color.tint, color: color.blueDark },
  blockquote: { backgroundColor: color.tint, borderColor: color.blue, borderLeftWidth: 3, paddingHorizontal: 10 },
  table: { borderColor: color.line, borderRadius: 8, marginBottom: 8 },
  thead: { backgroundColor: color.tint },
  tr: { borderColor: color.line },
  th: { minWidth: 80, padding: 7 },
  td: { minWidth: 80, padding: 7 },
  list_item: { marginBottom: 3 },
  codePanel: { backgroundColor: '#EEF3FB', borderRadius: 10, marginBottom: 8, padding: 10 },
  codeText: { color: color.ink, fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
});

export function CodeContent({ content }: { content: string }) {
  return <View style={styles.codePanel}>
    <ScrollView horizontal nestedScrollEnabled>
      <Text selectable style={styles.codeText}>{content.trimEnd()}</Text>
    </ScrollView>
  </View>;
}

const renderCode: NonNullable<RenderRules['fence']> = node =>
  <CodeContent key={node.key} content={node.content} />;
const rules: RenderRules = {
  fence: renderCode,
  code_block: renderCode,
  table: (node, children, _parents, ruleStyles) =>
    <ScrollView key={node.key} horizontal nestedScrollEnabled>
      <View style={ruleStyles.table}>{children}</View>
    </ScrollView>,
};

function openLink(url: string) {
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => {});
  return false;
}

const MarkdownContent = memo(function MarkdownContent({ content, unwrap = true }: { content: string; unwrap?: boolean }) {
  return <Markdown markdownit={markdown} rules={rules} style={styles} onLinkPress={openLink}>
    {normalizeMarkdown(content, unwrap)}
  </Markdown>;
});

export default MarkdownContent;
