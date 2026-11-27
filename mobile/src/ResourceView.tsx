import { useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Text, View } from 'react-native';
import { apiUrl } from './api';
import { resourceLabels, type Resource } from './types';
import { Button, Card, Heading, Notice, Section, styles } from './ui';

export default function ResourceView({ resource, token }: { resource: Resource; token: string }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const metadata = resource.metadata;
  const doc = metadata?.structuredDocument;
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
      {doc.introduction ? <Text style={styles.body}>{doc.introduction}</Text> : null}
      {doc.sections.map(section => <Card key={section.id}>
        <Section>{section.title}</Section>
        {section.blocks.map((block, index) => <View key={index}>
          {block.title ? <Text style={styles.rowTitle}>{block.title}</Text> : null}
          {block.type === 'table' ? [block.headers ?? [], ...(block.rows ?? [])].map((row, rowIndex) =>
            <Text key={rowIndex} style={styles.body}>{row.join('  ·  ')}</Text>) :
            <Text selectable style={styles.body}>{block.content}</Text>}
        </View>)}
      </Card>)}
      {doc.summary ? <Text style={styles.body}>{doc.summary}</Text> : null}
    </> : null}
    {resource.type === 'video' ? <>
      {videos?.length ? videos.map(video => <Card key={video.id}>
        <Text style={styles.rowTitle}>{video.title}</Text>
        <Text style={styles.detail}>{[video.author, video.duration].filter(Boolean).join(' · ')}</Text>
        <Button label="打开视频" secondary action={() => openLink(video.url)} />
      </Card>) : <Notice text="暂未找到相关视频" />}
    </> : null}
    {resource.type === 'reading' && reading ? <>
      {reading.intro ? <Text style={styles.body}>{reading.intro}</Text> : null}
      {reading.cards.map(card => <Card key={card.id}><Text style={styles.rowTitle}>{card.title}</Text>
        <Text style={styles.body}>{card.description}</Text>
        {card.reason ? <Text style={styles.detail}>{card.reason}</Text> : null}
      </Card>)}
      {reading.externalLinks.map(link => <Button key={link.url} label={link.title} secondary action={() => openLink(link.url)} />)}
    </> : null}
    {resource.type === 'mindmap' ? <Card>
      {resource.content.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('```')).map((line, index) => {
        const level = /^\s*(#+)\s/.exec(line)?.[1].length ?? 2;
        return <Text key={index} style={[level === 1 ? styles.rowTitle : styles.body, { paddingLeft: Math.min(3, level - 1) * 13 }]}>
          {line.replace(/^\s*#+\s+/, '')}
        </Text>;
      })}
    </Card> : null}
    {(resource.type === 'code' || (resource.type === 'document' && !doc) || (resource.type === 'reading' && !reading)) ?
      <Card><Text selectable style={styles.body}>{resource.content.replace(/^```[^\n]*\n|\n```\s*$/g, '')}</Text></Card> : null}
  </>;
}
