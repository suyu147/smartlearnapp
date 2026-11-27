import { memo, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import Markdown, { type RenderRules } from 'react-native-markdown-display';
import { markdown, mathMarkdown, normalizeMarkdown } from './markdown';
import { containsMath } from './markdown-math';
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
  const normalized = useMemo(() => normalizeMarkdown(content, unwrap), [content, unwrap]);
  const html = useMemo(() => {
    if (!normalized.includes('$') && !/\\[([]/.test(normalized)) return null;
    const tokens = mathMarkdown.parse(normalized, {});
    if (!containsMath(tokens)) return null;
    return mathMarkdown.renderer.render(tokens, mathMarkdown.options, {});
  }, [normalized]);
  if (html) return <MathContent html={html} fallback={normalized} />;
  return <Markdown markdownit={markdown} rules={rules} style={styles} onLinkPress={openLink}>
    {normalized}
  </Markdown>;
});

function MathContent({ html, fallback }: { html: string; fallback: string }) {
  const [height, setHeight] = useState(45);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => ({ html: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-measure'">
    <style>
      body { margin:0; color:#142445; font:15px/1.6 sans-serif; overflow-wrap:anywhere }
      #content { display:flow-root } p { margin:0 0 8px } h1,h2,h3,h4,h5,h6 { line-height:1.35; margin:.35em 0 }
      h1 {font-size:22px} h2 {font-size:19px} h3 {font-size:16px;color:#153ba8}
      ul,ol {margin:0 0 8px;padding-left:23px} blockquote {margin:0;background:#eaf1ff;padding:5px 10px;border-left:3px solid #194fdb}
      a {color:#194fdb} code {font-family:monospace;background:#eef3fb} pre {padding:10px;background:#eef3fb;border-radius:8px}
      pre,.formula,.table {overflow-x:auto} math {font-size:1.13em} table {border-collapse:collapse;margin-bottom:8px}
      td,th {border:1px solid #dee7f5;padding:6px;min-width:80px} th {background:#eaf1ff}
    </style></head><body><div id="content">${html.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, '</table></div>')}</div>
    <script nonce="measure">
      const content = document.getElementById('content');
      const send = () => window.ReactNativeWebView?.postMessage(String(Math.ceil(content.getBoundingClientRect().height)));
      new ResizeObserver(send).observe(content);
      window.addEventListener('load', send);
    </script></body></html>` }), [html]);
  if (failed) return <Markdown markdownit={markdown} rules={rules} style={styles} onLinkPress={openLink}>{fallback}</Markdown>;
  return <WebView source={source} style={{ height, flex: 0, backgroundColor: 'transparent' }}
    scrollEnabled={false} nestedScrollEnabled originWhitelist={['*']} allowFileAccess={false} mixedContentMode="never"
    onShouldStartLoadWithRequest={({ url }) => url === 'about:blank' || (openLink(url), false)}
    onError={() => setFailed(true)} onRenderProcessGone={() => setFailed(true)} onMessage={event => {
      const size = Number(event.nativeEvent.data);
      if (Number.isFinite(size) && size > 0) setHeight(Math.ceil(size));
    }} />;
}

export default MarkdownContent;
