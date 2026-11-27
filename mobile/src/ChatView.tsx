import { useCallback, useEffect, useRef, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, api, stream } from './api';
import type { Chat, Message, Node } from './types';
import { Button, Card, Field, Heading, Notice, Page, Row, color, styles } from './ui';

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
    setError('');
    let current = chat;
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
    } catch (cause) {
      if (!controller.signal.aborted) fail(cause);
    } finally {
      if (current && !controller.signal.aborted) {
        try {
          const page = await api<ChatPage>(messagePath(current.id), token, undefined, controller.signal);
          setMessages(page);
        } catch (cause) {
          if (!controller.signal.aborted) fail(cause);
        }
      }
      active.current = null;
      setPending('');
      setDraft('');
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
      <View style={local.headerTitle}><Heading title="智学 AI" detail={chat?.title ?? '学习助手'} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="对话历史" disabled={busy || loading} onPress={() => {
        setHistoryOpen(true);
        void readChats().catch(fail);
      }} style={local.icon}><Feather name="clock" size={21} color={color.blue} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="开始新对话" disabled={busy || loading} onPress={() => {
        setChat(undefined); setMessages(initialMessages); setQuestion(''); setError('');
      }} style={local.icon}><Feather name="plus" size={22} color={color.blue} /></Pressable>
    </View>
    {node ? <Pressable accessibilityRole="button" accessibilityLabel="清除课节上下文" style={local.context} onPress={onClearNode}>
      <Text style={styles.detail}>当前课节 · {node.title}</Text><Feather name="x" size={17} color={color.blue} />
    </Pressable> : null}
    <ScrollView style={local.screen} contentContainerStyle={local.thread} ref={transcript} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => { if (pending) transcript.current?.scrollToEnd({ animated: true }); }}>
      {messages.nextBefore ? <Button label="加载更早的消息" secondary disabled={busy || loading} action={() => {
        if (chat) void select(chat, messages.nextBefore ?? undefined);
      }} /> : null}
      {!conversation.length && !pending ? <Text style={styles.detail}>问一个概念、一道题，或请 AI 举例讲解。</Text> : null}
      {conversation.map(message => <Bubble key={message.id} content={message.content} own={message.role === 'user'} />)}
      {pending ? <Bubble content={pending} own /> : null}
      {draft ? <Bubble content={draft} /> : null}
      {busy && !draft ? <Text style={styles.detail}>正在思考…</Text> : null}
      {error ? <Notice text={error} error /> : null}
    </ScrollView>
    <View style={local.composer}>
      <Field style={local.input} accessibilityLabel="消息" placeholder="输入你的学习问题" value={question} maxLength={4000}
        onChangeText={setQuestion} onSubmitEditing={() => void send()} />
      {busy ? <Button label="停止" secondary action={() => active.current?.abort()} /> :
        <Button label="发送" disabled={!question.trim() || loading} action={() => void send()} />}
    </View>
  </View>;
}

function Bubble({ content, own = false }: { content: string; own?: boolean }) {
  return <View style={[local.bubble, own && local.own]}>
    <Text selectable style={[styles.body, own && local.ownText]}>{content}</Text>
  </View>;
}

const local = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 17, gap: 7 },
  headerTitle: { flex: 1 },
  icon: { padding: 10, backgroundColor: color.tint, borderRadius: 13 },
  context: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, backgroundColor: color.tint,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 17, marginTop: 6 },
  thread: { padding: 17, gap: 12 },
  bubble: { alignSelf: 'flex-start', maxWidth: '94%', borderWidth: 1, borderColor: color.line,
    backgroundColor: color.white, padding: 13, borderRadius: 17 },
  own: { alignSelf: 'flex-end', backgroundColor: color.blue, borderColor: color.blue },
  ownText: { color: color.white },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 8 },
  input: { flex: 1 },
});
