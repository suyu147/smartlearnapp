import { useCallback, useEffect, useRef, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import * as SecureStore from 'expo-secure-store';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api, stream, type StreamEvent } from './api';
import { type Account, type LearningPath, type Node, type PathSummary, type Resource, type ResourceType, type Stats, resourceLabels } from './types';
import { Button, Card, Field, Heading, Notice, Page, Row, Section, color, styles } from './ui';
import ResourceView from './ResourceView';
import PracticeView from './PracticeView';
import ChatView from './ChatView';

const tokenKey = 'smartlearn.account.token';
const tabs = [
  { id: 'home', title: '首页', icon: 'home' },
  { id: 'learn', title: '学习', icon: 'book-open' },
  { id: 'chat', title: 'AI 助手', icon: 'message-circle' },
  { id: 'resources', title: '资源', icon: 'layers' },
  { id: 'profile', title: '我的', icon: 'user' },
] as const;
type Tab = typeof tabs[number]['id'];
type Screen =
  | { type: 'main' }
  | { type: 'path'; sessionId: string }
  | { type: 'resource'; resource: Resource }
  | { type: 'practice'; resourceId: string };

const resourceIcons = {
  document: 'file-text', mindmap: 'share-2', quiz: 'check-square', video: 'play-circle',
  code: 'code', reading: 'book-open', ppt: 'monitor',
} as const;
const phases: Record<string, string> = {
  plan: '正在规划课节', analyze: '正在分析学习画像', resource_plan: '正在选择课节资源', generate: '正在生成课节资源',
};
const dateLabel = () => new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

function AuthScreen({ onLogin }: { onLogin: (token: string, account: Account, hasProfile: boolean) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const status = await api<{ mode: string }>('/auth/status');
      if (status.mode !== 'multi') throw new Error('当前服务器未启用多用户登录，请联系管理员');
      const result = await api<{ token: string; user: Account }>(register ? '/auth/register' : '/auth/login', undefined, { username: username.trim(), password });
      const auth = await api<{ user: Account | null; hasProfile: boolean }>('/auth/status', result.token);
      if (!auth.user) throw new Error('无法验证登录状态');
      await SecureStore.setItemAsync(tokenKey, result.token);
      onLogin(result.token, auth.user, auth.hasProfile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <Page>
    <View style={local.authBrand}>
      <View style={local.brandIcon}><Feather name="compass" size={31} color={color.white} /></View>
      <Heading title="智学方舟" detail="用网页端账号登录，开启你的学习计划。" />
    </View>
    <Card>
      <Section>{register ? '创建账号' : '账号登录'}</Section>
      <Field accessibilityLabel="用户名" placeholder="用户名" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
      <Field accessibilityLabel="密码" placeholder="密码" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={() => {
        if (username.trim() && password) void submit();
      }} />
      {error ? <Notice text={error} error /> : null}
      <Button label={busy ? '正在连接…' : register ? '注册并登录' : '登录'} disabled={busy || !username.trim() || !password} action={() => void submit()} />
      <Button label={register ? '返回登录' : '注册账号'} disabled={busy} secondary action={() => { setRegister(!register); setError(''); }} />
    </Card>
  </Page>;
}

function PathCard({ item, open }: { item: PathSummary; open: () => void }) {
  return <Card><Row title={item.goal} detail={item.currentNode?.title ?? (item.status === 'pending' ? '继续生成第一节' : '查看课节')}
    icon="book-open" onPress={open} />
    <Text style={styles.detail}>已完成 {item.completedCount} 节</Text>
  </Card>;
}

function ResourceRow({ resource, open }: { resource: Resource; open: () => void }) {
  return <Row title={resource.title} detail={resourceLabels[resource.type]} icon={resourceIcons[resource.type]} onPress={open} />;
}

function PathView({ sessionId, token, onResource, onChat, onAuthError }: {
  sessionId: string; token: string; onResource: (resource: Resource) => void;
  onChat: (node: Node) => void; onAuthError: () => void;
}) {
  const [path, setPath] = useState<LearningPath | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [nodeId, setNodeId] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [loaded, setLoaded] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const encoded = encodeURIComponent(sessionId);
    const [detail, assetList] = await Promise.all([
      api<{ path: LearningPath | null }>('/smartlearn?sessionId=' + encoded, token, undefined, signal),
      api<{ resources: Resource[] }>('/mobile/resources?sessionId=' + encoded, token, undefined, signal),
    ]);
    setPath(detail.path);
    setResources(assetList.resources);
    setLoaded(true);
  }, [sessionId, token]);
  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) onAuthError();
    else setError(cause instanceof Error ? cause.message : '路径加载失败');
  }, [onAuthError]);

  useEffect(() => {
    const initial = new AbortController();
    load(initial.signal).catch(cause => { if (!initial.signal.aborted) fail(cause); });
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active' && !controller.current) void load(initial.signal).catch(cause => { if (!initial.signal.aborted) fail(cause); });
    });
    return () => { initial.abort(); controller.current?.abort(); foreground.remove(); };
  }, [load, fail]);

  const node = path?.nodes.find(item => item.id === nodeId) ?? path?.nodes.find(item => item.status === 'in_progress') ?? path?.nodes.at(-1);
  const quiz = node?.resources.find(resource => resource.type === 'quiz');
  useEffect(() => {
    setLatest(null);
    if (!quiz) return;
    const request = new AbortController();
    api<{ latestAttemptId: string | null }>('/mobile/practice/' + encodeURIComponent(quiz.resourceId), token, undefined, request.signal)
      .then(result => setLatest(result.latestAttemptId)).catch(() => {});
    return () => request.abort();
  }, [quiz?.resourceId, token, progress]);

  async function generate(type?: ResourceType, advance = false) {
    if (controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setProgress('正在准备…');
    setError('');
    try {
      const endpoint = type ? '/smartlearn/resources' : '/smartlearn';
      const body = type ? { sessionId, currentNodeId: node?.id, resourceType: type } :
        { sessionId, action: advance ? 'node_complete' : 'start', ...(advance ? { currentNodeId: node?.id } : {}) };
      await stream(endpoint, token, body, event => {
        if (event.stage && phases[event.stage]) setProgress(phases[event.stage]);
        if (event.metadata?.learnEventType === 'resource_failed') setError(event.metadata.message ?? '有资源生成失败，可单独重试');
      }, active.signal);
      if (advance) setNodeId('');
    } catch (cause) {
      if (!active.signal.aborted) fail(cause);
    } finally {
      if (!active.signal.aborted) {
        try { await load(active.signal); } catch (cause) { fail(cause); }
        setProgress('');
      }
      controller.current = null;
    }
  }

  const nodeResources = node ? resources.filter(resource => node.resources.some(link => link.resourceId === resource.id)) : [];
  const expected = [...new Set<ResourceType>(['document', 'quiz', ...(node?.recommendedTypes ?? [])])];
  return <>
    <Heading title={path?.goal ?? '学习路径'} detail={node ? '按课节学习和练习' : undefined} />
    {error ? <Notice text={error} error /> : null}
    {progress ? <Notice text={progress} busy /> : null}
    {!loaded && !error ? <Notice text="正在读取学习路径" busy /> : null}
    {!loaded && error ? <Button label="重新加载" action={() => { setError(''); void load().catch(fail); }} /> : null}
    {loaded && !node && !progress ? <Button label="生成第一节" action={() => void generate()} /> : null}
    {path?.nodes.length ? <Card>
      {path.nodes.map((item, index) => <Row key={item.id} title={item.title}
        detail={(index + 1) + ' · ' + (item.status === 'completed' ? '已完成' : item.status === 'in_progress' ? '进行中' : '待学习')}
        icon={item.status === 'completed' ? 'check-circle' : 'book-open'} onPress={() => setNodeId(item.id)} />)}
    </Card> : null}
    {node ? <>
      <Section>{node.title}</Section>
      <Text style={styles.detail}>{node.estimatedMinutes} 分钟 · {node.knowledgePoints.join('、')}</Text>
      {nodeResources.length ? <Card>{nodeResources.map(resource => <ResourceRow key={resource.id} resource={resource} open={() => onResource(resource)} />)}</Card> : null}
      {expected.filter(type => !nodeResources.some(resource => resource.type === type)).map(type =>
        <Button key={type} label={'生成' + resourceLabels[type]} secondary disabled={!!progress} action={() => void generate(type)} />)}
      <Button label="向 AI 提问" secondary disabled={!!progress} action={() => onChat(node)} />
      {node.status === 'in_progress' ? <>
        <Button label="完成并生成下一节" disabled={!latest || !!progress} action={() => void generate(undefined, true)} />
        {!latest && !progress ? <Text style={styles.detail}>提交随堂练习后可继续下一节。</Text> : null}
      </> : null}
    </> : null}
  </>;
}

export default function SmartLearn() {
  const [auth, setAuth] = useState<{ token: string; account: Account; hasProfile: boolean } | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [screens, setScreens] = useState<Screen[]>([{ type: 'main' }]);
  const [items, setItems] = useState<PathSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats>();
  const [goal, setGoal] = useState('');
  const [creating, setCreating] = useState('');
  const [error, setError] = useState('');
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceFilter, setResourceFilter] = useState<ResourceType | 'all'>('all');
  const [chatNode, setChatNode] = useState<Node>();
  const [loading, setLoading] = useState(false);
  const streamController = useRef<AbortController | null>(null);
  const screen = screens[screens.length - 1];
  const token = auth?.token;

  const logout = useCallback(() => {
    streamController.current?.abort();
    setAuth(null);
    setTab('home');
    setScreens([{ type: 'main' }]);
    setItems([]);
    setNextOffset(null);
    setResources([]);
    setStats(undefined);
    setGoal('');
    setChatNode(undefined);
    setResourceFilter('all');
    setError('');
    setCreating('');
    void SecureStore.deleteItemAsync(tokenKey).catch(() => {});
  }, []);

  const restore = useCallback(async (signal?: AbortSignal) => {
    setBooting(true);
    setBootError('');
    try {
      const saved = await SecureStore.getItemAsync(tokenKey);
      if (!saved) return;
      const status = await api<{ mode: string; user: Account | null; hasProfile: boolean }>('/auth/status', saved, undefined, signal);
      if (signal?.aborted) return;
      if (status.mode === 'multi' && status.user) setAuth({ token: saved, account: status.user, hasProfile: status.hasProfile });
      else await SecureStore.deleteItemAsync(tokenKey);
    } catch (cause) {
      if (!signal?.aborted) setBootError(cause instanceof Error ? cause.message : '无法恢复登录');
    } finally {
      if (!signal?.aborted) setBooting(false);
    }
  }, []);
  useEffect(() => {
    const request = new AbortController();
    void restore(request.signal);
    return () => request.abort();
  }, [restore]);

  const refresh = useCallback(async (signal?: AbortSignal, offset = 0) => {
    if (!token) return;
    setLoading(true);
    try {
      if (tab === 'resources') {
        const data = await api<{ resources: Resource[] }>('/mobile/resources', token, undefined, signal);
        setResources(data.resources);
      } else if (tab !== 'chat') {
        const query = '/mobile/learning-paths?offset=' + offset;
        const data = await api<{ items: PathSummary[]; nextOffset: number | null }>(query, token, undefined, signal);
        setItems(current => offset ? [...current, ...data.items.filter(item => !current.some(existing => existing.sessionId === item.sessionId))] : data.items);
        setNextOffset(data.nextOffset);
        if (tab !== 'learn') await api<Stats>('/stats/learning', token, undefined, signal).then(setStats).catch(cause => {
          if (cause instanceof ApiError && cause.status === 401) throw cause;
        });
      }
    } catch (cause) {
      if (!signal?.aborted) {
        if (cause instanceof ApiError && cause.status === 401) logout();
        else setError(cause instanceof Error ? cause.message : '加载失败');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [tab, token, logout]);
  useEffect(() => {
    if (screen.type !== 'main') return;
    const request = new AbortController();
    void refresh(request.signal);
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh(request.signal);
    });
    return () => { request.abort(); foreground.remove(); };
  }, [screen.type, refresh]);

  const open = (value: Screen) => setScreens(previous => [...previous, value]);
  const back = () => { setScreens(previous => previous.length > 1 ? previous.slice(0, -1) : previous); setError(''); };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen.type === 'main') return false;
      setScreens(previous => previous.slice(0, -1));
      return true;
    });
    return () => subscription.remove();
  }, [screen.type]);

  function switchTab(value: Tab) {
    setScreens([{ type: 'main' }]);
    setTab(value);
    setError('');
    if (value !== 'chat') setChatNode(undefined);
  }

  async function createPath() {
    if (!token || streamController.current) return;
    const active = new AbortController();
    streamController.current = active;
    setCreating('正在连接学习服务');
    setError('');
    let sessionId = '';
    try {
      await stream('/smartlearn', token, { action: 'start', goal: goal.trim(), client: 'mobile' }, (event: StreamEvent) => {
        if (event.sessionId) sessionId = event.sessionId;
        if (event.stage && phases[event.stage]) setCreating(phases[event.stage]);
        if (event.metadata?.learnEventType === 'resource_failed') setCreating('部分资源可在课节内重试');
      }, active.signal);
      setGoal('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) logout();
      else if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : '路径生成失败');
    } finally {
      if (!active.signal.aborted) {
        setCreating('');
        if (sessionId) open({ type: 'path', sessionId });
      }
      streamController.current = null;
    }
  }

  const openResource = (resource: Resource) => open(resource.type === 'quiz'
    ? { type: 'practice', resourceId: resource.id } : { type: 'resource', resource });
  const openPath = (sessionId: string) => open({ type: 'path', sessionId });
  const recent = items[0];

  return <SafeAreaView style={local.safe}>
    <View style={local.fill}>
      {booting ? <Page><Heading title="智学方舟" /><Notice text="正在读取账号" busy /></Page> :
        bootError ? <Page><Heading title="智学方舟" /><Notice text={bootError} error /><Button label="重试" action={() => void restore()} />
          <Button label="返回登录" secondary action={() => setBootError('')} /></Page> :
        !auth ? <AuthScreen onLogin={(token, account, hasProfile) => setAuth({ token, account, hasProfile })} /> :
        <>
          {screen.type !== 'main' ? <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={back} style={local.back}>
            <Feather name="arrow-left" size={22} color={color.blue} /><Text style={local.backText}>返回</Text>
          </Pressable> : null}
          {screen.type === 'main' && tab === 'chat' ?
            <ChatView token={auth.token} node={chatNode} onClearNode={() => setChatNode(undefined)} onAuthError={logout} /> :
            <Page>
              {screen.type === 'path' ? <PathView key={screen.sessionId} sessionId={screen.sessionId} token={auth.token} onResource={openResource}
                onAuthError={logout} onChat={node => { switchTab('chat'); setChatNode(node); }} /> : null}
              {screen.type === 'resource' ? <ResourceView key={screen.resource.id} resource={screen.resource} token={auth.token} /> : null}
              {screen.type === 'practice' ? <PracticeView key={screen.resourceId} resourceId={screen.resourceId} token={auth.token} onBack={back} onAuthError={logout} /> : null}
              {screen.type === 'main' ? <>
                {error ? <Notice text={error} error /> : null}
                {loading ? <Notice text="正在读取学习记录" busy /> : null}
                {tab === 'home' ? <>
                  <Heading title={'你好，' + auth.account.username} detail={dateLabel()} />
                  <View style={local.hero}>
                    <Feather name="compass" color="#B5CBFF" size={25} />
                    <Text style={local.heroTitle}>{recent?.goal ?? '从一个学习目标开始'}</Text>
                    <Text style={local.heroDetail}>{recent?.currentNode?.title ?? 'AI 将按课节生成讲义与随堂练习'}</Text>
                    <Pressable accessibilityRole="button" style={local.heroAction} onPress={() => recent ? openPath(recent.sessionId) : switchTab('learn')}>
                      <Text style={local.heroActionText}>{recent ? '继续学习' : '创建学习路径'}</Text><Feather name="arrow-right" size={17} color={color.blueDark} />
                    </Pressable>
                  </View>
                  <Section>学习概览</Section>
                  {stats ? <Card><View style={local.statRow}>
                    <Stat value={String(stats.answered)} label="已答题数" />
                    <Stat value={stats.accuracy + '%'} label="练习正确率" />
                    <Stat value={String(stats.days)} label="累计学习天数" />
                  </View></Card> : <Text style={styles.detail}>学习记录同步后会显示在这里。</Text>}
                  <Section>最近学习</Section>
                  {items.slice(0, 3).map(item => <PathCard key={item.sessionId} item={item} open={() => openPath(item.sessionId)} />)}
                  {!items.length && !loading ? <Text style={styles.detail}>暂无学习路径</Text> : null}
                </> : null}
                {tab === 'learn' ? <>
                  <Heading title="我的学习" detail="查看学习路径，继续上次的课节。" />
                  <Card>
                    <Section>生成学习路径</Section>
                    <Field multiline maxLength={500} accessibilityLabel="学习目标" placeholder="例如，一个月内掌握决策树，每周学习三小时" value={goal} onChangeText={setGoal} />
                    {creating ? <Notice text={creating} busy /> : null}
                    <Button label={creating ? '生成中…' : '生成学习路径'} disabled={!goal.trim() || !!creating} action={() => void createPath()} />
                  </Card>
                  <Section>学习路径</Section>
                  {items.map(item => <PathCard key={item.sessionId} item={item} open={() => openPath(item.sessionId)} />)}
                  {!items.length && !loading ? <Text style={styles.detail}>暂无学习路径</Text> : null}
                  {nextOffset !== null ? <Button label="加载更多" secondary disabled={loading} action={() => void refresh(undefined, nextOffset)} /> : null}
                </> : null}
                {tab === 'resources' ? <>
                  <Heading title="资源库" detail="来自学习路径的资源可在网页资源库查看。" />
                  <View style={local.filters}>
                    {(['all', ...Object.keys(resourceLabels)] as (ResourceType | 'all')[]).map(type =>
                      <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: resourceFilter === type }} onPress={() => setResourceFilter(type)}
                        style={[local.filter, resourceFilter === type && local.activeFilter]}>
                        <Text style={local.filterText}>{type === 'all' ? '全部' : resourceLabels[type]}</Text>
                      </Pressable>)}
                  </View>
                  {resources.some(item => resourceFilter === 'all' || item.type === resourceFilter) ? <Card>
                    {resources.filter(item => resourceFilter === 'all' || item.type === resourceFilter).map(resource =>
                      <ResourceRow key={resource.id} resource={resource} open={() => openResource(resource)} />)}
                  </Card> : !loading ? <Notice text="此分类暂无学习资源" /> : null}
                </> : null}
                {tab === 'profile' ? <>
                  <Heading title="我的" />
                  <Card><View style={local.statRow}>
                    <View style={local.brandIcon}><Feather name="user" size={25} color={color.white} /></View>
                    <View style={styles.rowText}><Text style={styles.rowTitle}>{auth.account.username}</Text>
                      <Text style={styles.detail}>{auth.hasProfile ? '已建立学习画像' : '尚未建立学习画像'}</Text></View>
                  </View></Card>
                  {stats ? <Card><View style={local.statRow}>
                    <Stat value={String(stats.answered)} label="已答题数" />
                    <Stat value={stats.accuracy + '%'} label="练习正确率" />
                    <Stat value={String(items.length)} label={nextOffset === null ? '学习路径' : '已加载路径'} />
                  </View></Card> : null}
                  <Button label="退出登录" secondary action={logout} />
                </> : null}
                {error && !loading ? <Button label="重新加载" secondary action={() => { setError(''); void refresh(); }} /> : null}
              </> : null}
            </Page>}
          {screen.type === 'main' ? <View style={local.nav}>
            {tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
              disabled={!!creating} onPress={() => switchTab(item.id)} style={local.navItem}>
              <View style={[local.navIcon, tab === item.id && local.navActive]}><Feather name={item.icon} size={21} color={tab === item.id ? color.blue : color.muted} /></View>
              <Text style={[local.navText, tab === item.id && local.navTextActive]}>{item.title}</Text>
            </Pressable>)}
          </View> : null}
        </>}
    </View>
  </SafeAreaView>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={local.stat}><Text style={local.statValue}>{value}</Text><Text style={styles.detail}>{label}</Text></View>;
}

const local = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  fill: { flex: 1 },
  authBrand: { marginTop: 56, marginBottom: 8, gap: 16 },
  brandIcon: { backgroundColor: color.blue, width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: 24, padding: 22, backgroundColor: color.blue, gap: 10 },
  heroTitle: { color: color.white, fontSize: 25, fontWeight: '800', lineHeight: 34 },
  heroDetail: { color: '#DFE9FF', lineHeight: 22, fontSize: 14 },
  heroAction: { backgroundColor: color.white, borderRadius: 12, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, padding: 11, marginTop: 5 },
  heroActionText: { color: color.blueDark, fontSize: 15, fontWeight: '700' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stat: { flex: 1, gap: 3, alignItems: 'center' },
  statValue: { color: color.ink, fontSize: 23, fontWeight: '800', fontVariant: ['tabular-nums'] },
  nav: { flexDirection: 'row', backgroundColor: color.white, borderTopWidth: 1, borderColor: color.line, paddingHorizontal: 5, paddingVertical: 7 },
  navItem: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 3 },
  navIcon: { width: 44, height: 29, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  navActive: { backgroundColor: color.tint },
  navText: { fontSize: 11, color: color.muted },
  navTextActive: { color: color.blueDark, fontWeight: '700' },
  back: { marginHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  backText: { color: color.blueDark, fontSize: 15, fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: color.white, borderWidth: 1, borderColor: color.line },
  activeFilter: { backgroundColor: color.tint, borderColor: '#AEC5FE' },
  filterText: { color: color.blueDark, fontSize: 13, fontWeight: '600' },
});
