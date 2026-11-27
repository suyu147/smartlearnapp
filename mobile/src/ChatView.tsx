import { memo, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, api, stream } from './api';
import type { Chat, Message, Node } from './types';
import { Button, Card, Field, Gradient, Heading, IconButton, Notice, Page, Row, color, gradient, styles, surfaceShadow } from './ui';
import MarkdownContent from './MarkdownContent';

type ChatPage = { messages: Message[]; nextBefore: number | null };
const initialMessages = { messages: [], nextBefore: null } as ChatPage;
const messagePath = (id: string, before?: number) => '/sessions/' + encodeURIComponent(id) + '?limit=40' + (before ? '&before=' + before : '');

export default function ChatView({ token, node, onClearNode, onAuthError }: {
  token: string; node?: Node; onClearNode: () => void; onAuthError: () => void;
}) {
  const [chat, setChat] = useState<Chat>();
  const [chats, setChats] = useState<Chat[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [messages, setMessages] = useState<ChatPage>(initialMessages);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState('');
  const [draft, setDraft] = useState('');
  const [interrupted, setInterrupted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const transcript = useRef<ScrollView>(null);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) onAuthError();
    else setError(cause instanceof Error ? cause.message : '对话暂时不可用');
  }, [onAuthError]);
  const readChats = useCallback((signal?: AbortSignal) => api<Chat[]>('/sessions', token, undefined, signal).then(setChats), [token]);
  useEffect(() => {
    const controller = new AbortController();
    void readChats(controller.signal).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => { controller.abort(); active.current?.abort(); };
  }, [readChats, fail]);

  async function select(item: Chat, before?: number) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError('');
    try {
      const page = await api<ChatPage>(messagePath(item.id, before), token, undefined, controller.signal);
      setChat(item);
      setMessages(previous => ({ ...page, messages: before ? [...page.messages, ...previous.messages] : page.messages }));
      if (!before) { setPending(''); setDraft(''); setInterrupted(false); }
      setHistoryOpen(false);
    } catch (cause) {
      if (!controller.signal.aborted) fail(cause);
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function send() {
    const input = question.trim();
    if (!input || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setPending(input);
    setDraft('');
    setInterrupted(false);
    setError('');
    let current = chat;
    let finished = false;
    try {
      if (!current) {
        current = await api<Chat>('/sessions', token, { title: input.slice(0, 32) }, controller.signal);
        setChat(current);
        const created = current;
        setChats(previous => [created, ...previous]);
      }
      setQuestion('');
      const context = node ? '课节：' + node.title + '\n知识点：' + node.knowledgePoints.join('、') + '\n\n' : '';
      const conversationHistory = messages.messages
        .filter(item => item.role === 'user' || item.role === 'assistant')
        .slice(-20)
        .map(({ role, content }) => ({ role, content }));
      await stream('/turns', token, { sessionId: current.id, message: context + input, conversationHistory, language: 'zh-CN' }, event => {
        if (event.type === 'content' && event.content) setDraft(previous => previous + event.content);
      }, controller.signal);
      finished = true;
    } catch (cause) {
      if (!controller.signal.aborted) fail(cause);
    } finally {
      if (current && finished && !controller.signal.aborted) {
        try {
          const page = await api<ChatPage>(messagePath(current.id), token, undefined, controller.signal);
          if (!controller.signal.aborted) {
            setMessages(page);
            setPending('');
            setDraft('');
          }
        } catch (cause) {
          if (!controller.signal.aborted) fail(cause);
        }
      }
      active.current = null;
      if (!finished || controller.signal.aborted) setInterrupted(true);
      setBusy(false);
    }
  }

  const conversation = messages.messages.filter(item => item.role === 'user' || item.role === 'assistant');

  if (historyOpen) return <Page>
    <Heading title="对话历史" />
    {error ? <Notice text={error} error /> : null}
    {loading ? <Notice text="正在读取对话" busy /> : null}
    {chats.length ? <Card>{chats.map(item => <Row key={item.id} title={item.title} icon="message-circle" onPress={() => void select(item)} />)}</Card> :
      <Notice text="暂无历史对话" />}
    <Button label="返回对话" secondary action={() => setHistoryOpen(false)} />
  </Page>;

  return <View style={local.screen}>
    <View style={local.header}>
      <Gradient style={local.assistantIcon}><Feather name="zap" size={21} color={color.white} /></Gradient>
      <View style={local.headerTitle}><Text accessibilityRole="header" style={styles.rowTitle}>智学 AI</Text>
        <Text numberOfLines={1} style={styles.detail}>{chat?.title ?? '学习助手'}</Text></View>
      <IconButton icon="clock" label="对话历史" disabled={busy || loading} action={() => {
        setHistoryOpen(true);
        void readChats().catch(fail);
      }} />
      <IconButton icon="plus" label="开始新对话" disabled={busy || loading} action={() => {
        setChat(undefined); setMessages(initialMessages); setQuestion(''); setError('');
        setPending(''); setDraft(''); setInterrupted(false);
      }} />
    </View>
    {node ? <Pressable accessibilityRole="button" accessibilityLabel="清除课节上下文" style={local.context} onPress={onClearNode}>
      <Text style={[styles.detail, local.headerTitle]}>当前课节 · {node.title}</Text><Feather name="x" size={17} color={color.blue} />
    </Pressable> : null}
    <ScrollView style={local.screen} contentContainerStyle={local.thread} ref={transcript} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => { if (pending) transcript.current?.scrollToEnd({ animated: true }); }}>
      {messages.nextBefore ? <Button label="加载更早的消息" secondary disabled={busy || loading} action={() => {
        if (chat) void select(chat, messages.nextBefore ?? undefined);
      }} /> : null}
      {!conversation.length && !pending ? <Bubble content="问一个概念、一道题，或请我举例讲解。" /> : null}
      {conversation.map(message => <Bubble key={message.id} content={message.content} own={message.role === 'user'} />)}
      {pending ? <Bubble content={pending} own /> : null}
      {draft ? <Bubble content={draft} /> : null}
      {interrupted && !busy && pending ? <Text style={styles.detail}>当前对话已保留在屏幕上，可从历史记录重新读取。</Text> : null}
      {busy && !draft ? <Text style={styles.detail}>正在思考…</Text> : null}
      {error ? <Notice text={error} error /> : null}
    </ScrollView>
    <View style={local.composer}>
      <Field style={local.input} accessibilityLabel="消息" placeholder="输入你的学习问题" value={question} maxLength={4000}
        onChangeText={setQuestion} onSubmitEditing={() => void send()} />
      <Pressable accessibilityRole="button" accessibilityLabel={busy ? '停止' : '发送'}
        accessibilityState={{ disabled: !busy && (!question.trim() || loading) }}
        disabled={!busy && (!question.trim() || loading)} onPress={() => busy ? active.current?.abort() : void send()}
        style={({ pressed }) => (pressed || (!busy && (!question.trim() || loading))) && styles.dim}>
        <Gradient image={gradient.blue} style={local.send}><Feather name={busy ? 'square' : 'send'} size={17} color={color.white} /></Gradient>
      </Pressable>
    </View>
  </View>;
}

const Bubble = memo(function Bubble({ content, own = false }: { content: string; own?: boolean }) {
  const formatted = useDeferredValue(content);
  return <View style={[local.bubble, own ? local.own : local.assistant]}>
    {own ? <Text selectable style={[styles.body, local.ownText]}>{content}</Text> : <MarkdownContent content={formatted} />}
  </View>;
});

const local = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 11, gap: 9,
    borderBottomWidth: 1, borderColor: color.line },
  headerTitle: { flex: 1 },
  assistantIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  context: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.white, borderWidth: 1, borderColor: color.line,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 20, marginTop: 10, minHeight: 42 },
  thread: { padding: 20, gap: 12 },
  bubble: { ...surfaceShadow, alignSelf: 'flex-start', maxWidth: '91%', borderWidth: 1, borderColor: color.line,
    backgroundColor: color.white, padding: 13, borderRadius: 19 },
  assistant: { borderBottomLeftRadius: 6 },
  own: { alignSelf: 'flex-end', backgroundColor: color.blue, borderColor: color.blue, borderBottomRightRadius: 6 },
  ownText: { color: color.white },
  composer: { ...surfaceShadow, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 5,
    paddingLeft: 13, borderRadius: 19, borderWidth: 1, borderColor: color.line, backgroundColor: color.white },
  input: { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
  send: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
