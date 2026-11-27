import { useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiUrl } from './api';
import { resourceLabels, type Resource } from './types';
import { Button, Card, Heading, Notice, Section, color, styles } from './ui';
import MarkdownContent, { CodeContent } from './MarkdownContent';
import MindmapView from './MindmapView';

function readDocument(resource: Resource): NonNullable<Resource['metadata']>['structuredDocument'] {
  if (Array.isArray(resource.metadata?.structuredDocument?.sections)) return resource.metadata?.structuredDocument;
  const stored = resource.content.trim();
  const json = /^\x60{3}json\s*\n([\s\S]*?)\n\x60{3}$/i.exec(stored)?.[1] ?? stored;
  if (!json.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (parsed?.format === 'structured_document_v1' && Array.isArray(parsed.sections)) return parsed;
  } catch {
    return undefined;
  }
}

export default function ResourceView({ resource, token, onRead }: { resource: Resource; token: string; onRead?: () => void }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [visibleSections, setVisibleSections] = useState(8);
  const metadata = resource.metadata;
  const doc = resource.type === 'document' ? readDocument(resource) : undefined;
  const reading = metadata?.structuredReading;
  const videos = metadata?.videoData?.videos;
  const openLink = (url: string) => {
    if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => setStatus('无法打开此链接'));
  };

  async function download() {
    setBusy(true);
    setStatus('');
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('此设备无法打开系统分享');
      const folder = new Directory(Paths.cache, 'presentations');
      folder.create({ idempotent: true, intermediates: true });
      const file = new File(folder, resource.id + '.pptx');
      const downloaded = await File.downloadFileAsync(apiUrl('/smartlearn/ppt?id=' + encodeURIComponent(resource.id)), file, {
        headers: { Authorization: 'Bearer ' + token }, idempotent: true,
      });
      await Sharing.shareAsync(downloaded.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        UTI: 'org.openxmlformats.presentationml.presentation',
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'PPTX 下载失败');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Heading title={resource.title} detail={resourceLabels[resource.type]} />
    {status ? <Notice text={status} error /> : null}
    {resource.type === 'ppt' ? <Button label={busy ? '下载中…' : '下载并打开 PPTX'} disabled={busy} action={() => void download()} /> : null}
    {resource.type === 'document' && doc ? <>
      {doc.introduction ? <MarkdownContent content={doc.introduction} /> : null}
      {doc.sections.slice(0, visibleSections).map(section => <Card key={section.id}>
        <Section>{section.title}</Section>
        {section.blocks.map((block, index) => <View key={index}>
          {block.title ? <Text style={styles.rowTitle}>{block.title}</Text> : null}
          {block.type === 'table' ? <ScrollView horizontal nestedScrollEnabled>
            <View style={table.grid}>
              {[block.headers ?? [], ...(block.rows ?? [])].map((row, rowIndex) =>
                <View key={rowIndex} style={[table.row, rowIndex === 0 && table.header]}>
                  {row.map((cell, index) => <View key={index} style={table.cell}><MarkdownContent content={cell} /></View>)}
                </View>)}
            </View>
          </ScrollView> :
            block.content ? (block.type === 'code' && !/^\s*(?:\x60{3}|~{3})/.test(block.content)
              ? <CodeContent content={block.content} />
              : <MarkdownContent content={block.content} unwrap={block.type !== 'code'} />) : null}
        </View>)}
      </Card>)}
      {doc.sections.length > visibleSections ?
        <Button label="继续阅读" action={() => setVisibleSections(value => value + 8)} /> :
        doc.summary ? <MarkdownContent content={doc.summary} /> : null}
    </> : null}
    {resource.type === 'video' ? <>
      {videos?.length ? videos.map(video => <Card key={video.id}>
        <Text style={styles.rowTitle}>{video.title}</Text>
        <Text style={styles.detail}>{[video.author, video.duration].filter(Boolean).join(' · ')}</Text>
        <Button label="打开视频" secondary action={() => openLink(video.url)} />
      </Card>) : <Notice text="暂未找到相关视频" />}
    </> : null}
    {resource.type === 'reading' && reading ? <>
      {reading.intro ? <MarkdownContent content={reading.intro} /> : null}
      {reading.cards.map(card => <Card key={card.id}><Text style={styles.rowTitle}>{card.title}</Text>
        <MarkdownContent content={card.description} />
        {card.reason ? <MarkdownContent content={card.reason} /> : null}
      </Card>)}
      {reading.externalLinks.map(link => <Button key={link.url} label={link.title} secondary action={() => openLink(link.url)} />)}
    </> : null}
    {resource.type === 'mindmap' ? <Card><MindmapView content={resource.content} /></Card> : null}
    {((resource.type === 'document' && !doc) || (resource.type === 'reading' && !reading)) ?
      <Card><MarkdownContent content={resource.content} /></Card> : null}
    {resource.type === 'code' ? <Card>
      {/^\s*(?:\x60{3}|~{3})/.test(resource.content) ? <MarkdownContent content={resource.content} unwrap={false} /> :
        <CodeContent content={resource.content} />}
    </Card> : null}
    {onRead ? <Button label="标记已读并返回" action={onRead} /> : null}
  </>;
}

const table = StyleSheet.create({
  grid: { borderColor: color.line, borderTopWidth: 1, borderLeftWidth: 1 },
  row: { flexDirection: 'row' },
  header: { backgroundColor: color.tint },
  cell: { width: 142, padding: 8, borderColor: color.line, borderBottomWidth: 1, borderRightWidth: 1 },
});
