import { useCallback, useEffect, useRef, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import * as SecureStore from 'expo-secure-store';
import { Alert, AppState, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api, apiUrl, isTemporaryError } from './api';
import { type Account, type LearningPath, type Node, type PathSummary, type Resource, type ResourceType, type Resume, type ReviewBatch, type ReviewItem, type ReviewMode, type ReviewTarget, type Stats, resourceLabels } from './types';
import { Button, Card, Field, Gradient, Heading, IconButton, Notice, Page, Row, Section, color, gradient, styles, surfaceShadow } from './ui';
import ResourceView from './ResourceView';
import PracticeView from './PracticeView';
import ReviewView from './ReviewView';
import LearningStatsView from './LearningStatsView';
import ChatView from './ChatView';
import NotebookView from './NotebookView';
import CareerInsightView from './CareerInsightView';
import type { NoteSource } from './notebook-api';
import { documentProgress, flushSubmissions, getLearning, readBatch, readDraft, saveBatch, saveDraft } from './learning-storage';
import PathTimeline from './PathTimeline';
import { usePathGeneration, type Generation } from './usePathGeneration';

const tokenKey = 'smartlearn.account.token';
const accountKey = 'smartlearn.account.snapshot';
type Auth = { token: string; account: Account; hasProfile: boolean };
type SavedAccount = Omit<Auth, 'token'> & { server: string };

async function storeAccount(auth: Auth) {
  const previous = await SecureStore.getItemAsync(tokenKey);
  if (previous !== auth.token) await SecureStore.deleteItemAsync(accountKey);
  await SecureStore.setItemAsync(tokenKey, auth.token);
  const snapshot: SavedAccount = { account: auth.account, hasProfile: auth.hasProfile, server: apiUrl('/') };
  await SecureStore.setItemAsync(accountKey, JSON.stringify(snapshot)).catch(() => {});
}
const tabs = [
  { id: 'home', title: '首页', icon: 'home' },
  { id: 'learn', title: '学习', icon: 'book-open' },
  { id: 'chat', title: 'AI 助手', icon: 'zap' },
  { id: 'resources', title: '资源', icon: 'layers' },
  { id: 'profile', title: '我的', icon: 'user' },
] as const;
type Tab = typeof tabs[number]['id'];
type Screen =
  | { type: 'main' }
  | { type: 'path'; sessionId: string; taskId?: string }
  | { type: 'resource'; resource: Resource }
  | { type: 'practice'; resourceId?: string; reportId?: string; review?: ReviewTarget; batch?: ReviewBatch }
  | { type: 'review'; mode: ReviewMode; topic?: string }
  | { type: 'stats' }
  | { type: 'notebook' }
  | { type: 'career' };

const resourceIcons = {
  document: 'file-text', mindmap: 'share-2', quiz: 'check-square', video: 'play-circle',
  code: 'code', reading: 'book-open', ppt: 'monitor',
} as const;
const resourceTones = {
  document: [color.blue, color.tint], mindmap: [color.violet, color.lightViolet], quiz: [color.green, color.lightGreen],
  video: [color.red, color.lightRed], code: [color.cyan, color.lightCyan], reading: [color.amber, color.lightAmber],
  ppt: [color.violet, color.lightViolet],
} as const;

function dateLabel() {
  const date = new Date();
  return `${date.getMonth() + 1}月${date.getDate()}日 · 周${'日一二三四五六'[date.getDay()]}`;
}

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
      await storeAccount({ token: result.token, account: auth.user, hasProfile: auth.hasProfile });
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
      <Gradient style={local.brandIcon}><Feather name="compass" size={31} color={color.white} /></Gradient>
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
  const progress = item.staged && item.nodeCount > 0 ? Math.round(100 * item.completedCount / item.nodeCount) : undefined;
  return <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => [local.pathCard, pressed && styles.dim]}>
    <Gradient image={gradient.blue} style={local.pathIcon}><Feather name="book-open" size={22} color={color.white} /></Gradient>
    <View style={local.pathCopy}>
      <Text style={styles.rowTitle}>{item.goal}</Text>
      <Text style={styles.detail}>{item.currentNode?.title ?? (item.status === 'pending' ? '继续规划学习路径' : '查看学习路径')}</Text>
      {progress !== undefined ? <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={local.pathTrack}>
        <View style={[local.pathFill, { width: `${progress}%` }]} />
      </View> : null}
      <Text style={local.pathCount}>{item.staged && item.nodeCount > 0
        ? `已完成 ${item.completedCount} / ${item.nodeCount} 个任务`
        : `已完成 ${item.completedCount} 节${item.nodeCount > 0 ? ` · 已生成 ${item.nodeCount} 节` : ''}`}</Text>
    </View>
    <Feather name="chevron-right" size={17} color={color.muted} />
  </Pressable>;
}

function ResourceRow({ resource, open }: { resource: Resource; open: () => void }) {
  return <Row title={resource.title} detail={resourceLabels[resource.type]} icon={resourceIcons[resource.type]} tone={resourceTones[resource.type]} onPress={open} />;
}

function QuickLink({ label, icon, tone, action }: {
  label: string; icon: React.ComponentProps<typeof Feather>['name']; tone: readonly [string, string]; action: () => void;
}) {
  return <Pressable accessibilityRole="button" onPress={action} style={({ pressed }) => [local.quick, pressed && styles.dim]}>
    <View style={[styles.iconBox, { backgroundColor: tone[1] }]}><Feather name={icon} size={19} color={tone[0]} /></View>
    <Text style={local.quickLabel}>{label}</Text>
  </Pressable>;
}

function HomeHero({ recent, label, busy, onContinue }: { recent?: PathSummary; label: string; busy: boolean; onContinue: () => void }) {
  const progress = recent?.staged && recent.nodeCount > 0 ? Math.round(100 * recent.completedCount / recent.nodeCount) : undefined;
  const angle = (progress ?? 0) * 3.6;
  return <View style={local.heroShadow}>
    <Gradient style={local.hero}>
      <View pointerEvents="none" style={local.heroOrbit} />
      <View pointerEvents="none" style={local.heroOrbitInner} />
      <View style={local.heroLabel}><Feather name="compass" size={13} color={color.white} /><Text style={local.heroLabelText}>{recent ? '学习进度' : '新建学习路径'}</Text></View>
      <View style={local.heroMain}>
        <View style={local.heroCopy}>
          <Text textBreakStrategy="balanced" style={local.heroTitle}>{recent?.goal ?? '从一个学习目标开始'}</Text>
          <Text style={local.heroDetail}>{recent?.currentNode?.title ?? (recent?.status === 'completed' ? '已完成全部学习任务' : 'AI 将规划学习阶段与任务')}</Text>
          <Pressable accessibilityRole="button" style={({ pressed }) => [local.heroAction, (pressed || busy) && styles.dim]} disabled={busy} onPress={onContinue}>
            <Feather name="play" size={15} color={color.blueDark} /><Text style={local.heroActionText}>{busy ? '正在打开…' : label}</Text>
          </Pressable>
        </View>
        {progress !== undefined ? <View accessible accessibilityLabel={`完成 ${progress}%`} style={local.heroRing}>
          <View style={local.ringRight}>
            <View style={[local.heroArc, { transform: [{ rotate: `${Math.min(angle, 180) - 180}deg` }] }]}><View style={local.arcFill} /></View>
          </View>
          <View style={local.ringLeft}>
            <View style={[local.heroArc, local.leftArc, { transform: [{ rotate: `${Math.max(0, angle - 180)}deg` }] }]}><View style={local.arcFill} /></View>
          </View>
          <View style={local.ringCenter}><Text style={local.heroRingText}>{progress}%</Text></View>
        </View> : <Feather name="compass" size={53} color="#D3DCFF" />}
      </View>
    </Gradient>
  </View>;
}

function PathView({ sessionId, taskId, accountId, token, generation, anotherPathRunning, syncRevision, run, onTask, onResource, onChat, onAuthError, onPractice }: {
  sessionId: string; accountId: string; token: string; generation?: Generation; run: ReturnType<typeof usePathGeneration>['run'];
  taskId?: string; anotherPathRunning: boolean; syncRevision: number; onTask: (node: Node) => void;
  onResource: (resource: Resource) => void; onChat: (node: Node) => void; onAuthError: () => void;
  onPractice: (resourceId: string, reportId?: string) => void;
}) {
  const [savedPath, setSavedPath] = useState<LearningPath | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [staged, setStaged] = useState(false);
  const [lastReport, setLastReport] = useState<{ quizId: string; attemptId: string }>();
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [offline, setOffline] = useState(false);
  const [remoteRunning, setRemoteRunning] = useState(false);
  const busy = !!generation?.running;
  const generationDisabled = busy || remoteRunning || anotherPathRunning;
  const streamedPath = generation?.path;
  const path = streamedPath && (!savedPath || (streamedPath.revision ?? 0) > (savedPath.revision ?? 0)) ? streamedPath : savedPath;
  const isStaged = staged || !!path?.nodes.some(item => item.stage);
  const node = taskId ? path?.nodes.find(item => item.id === taskId) : undefined;
  const live = busy || !loaded || (streamedPath?.revision ?? 0) > (savedPath?.revision ?? 0) ? generation?.resources ?? [] : [];
  const quizId = node?.resources.find(link => link.type === 'quiz')?.resourceId ??
    live.find(resource => resource.type === 'quiz' && resource.metadata?.nodeId === node?.id)?.id;
  const latest = lastReport?.quizId === quizId ? lastReport?.attemptId : undefined;

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) onAuthError();
    else setError(cause instanceof Error ? cause.message : '路径加载失败');
  }, [onAuthError]);

  useEffect(() => {
    let active: AbortController | undefined;
    const load = async () => {
      active?.abort();
      const request = new AbortController();
      active = request;
      const encoded = encodeURIComponent(sessionId);
      const [detail, assets] = await Promise.allSettled([
        getLearning<{ path: LearningPath | null; staged?: boolean; generating?: boolean }>(accountId, '/smartlearn?sessionId=' + encoded, token, request.signal),
        getLearning<{ resources: Resource[] }>(accountId, '/mobile/resources?sessionId=' + encoded, token, request.signal),
      ]);
      if (request.signal.aborted) return;
      setError('');
      if (detail.status === 'fulfilled') {
        setSavedPath(previous => detail.value.offline && previous &&
          (previous.revision ?? 0) > (detail.value.data.path?.revision ?? 0) ? previous : detail.value.data.path);
        setStaged(!!detail.value.data.staged);
        setLoaded(true);
        if (!detail.value.offline) setRemoteRunning(!!detail.value.data.generating);
      }
      else fail(detail.reason);
      if (assets.status === 'fulfilled') setResources(assets.value.data.resources);
      else fail(assets.reason);
      setOffline((detail.status === 'fulfilled' && detail.value.offline) || (assets.status === 'fulfilled' && assets.value.offline));
    };
    void load();
    const timer = remoteRunning && !busy ? setInterval(() => { if (AppState.currentState === 'active') void load(); }, 6000) : undefined;
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active?.abort(); clearInterval(timer); foreground.remove(); };
  }, [sessionId, accountId, token, fail, busy, remoteRunning, reload, syncRevision]);

  useEffect(() => {
    if (!quizId) return;
    const request = new AbortController();
    getLearning<{ latestAttemptId: string | null }>(accountId, '/mobile/practice/' + encodeURIComponent(quizId), token, request.signal)
      .then(({ data: result }) => {
        if (!request.signal.aborted) setLastReport(result.latestAttemptId ? { quizId, attemptId: result.latestAttemptId } : undefined);
      })
      .catch(cause => { if (!request.signal.aborted) fail(cause); });
    return () => request.abort();
  }, [quizId, accountId, token, fail, reload, syncRevision]);

  function generate(type?: ResourceType, advance = false) {
    setError('');
    const body = type ? { sessionId, currentNodeId: node?.id, resourceType: type } :
      { sessionId, action: advance ? 'node_complete' : 'start', ...(advance ? { currentNodeId: node?.id } : {}) };
    void run(type ? '/smartlearn/resources' : '/smartlearn', body, sessionId);
  }

  function openTask(task: Node) {
    if (isStaged && task.status === 'available' && !offline && !generationDisabled) {
      void run('/smartlearn/resources', { sessionId, currentNodeId: task.id }, sessionId);
    }
    onTask(task);
  }

  function replan() {
    Alert.alert('重新规划学习路径', '已开始和已完成的任务会保留，AI 将重新安排其余内容。', [
      { text: '取消', style: 'cancel' },
      { text: '重新规划', onPress: () => void run('/smartlearn', { sessionId, action: 'replan' }, sessionId) },
    ]);
  }

  function renderResource(type: ResourceType) {
    const reference = node?.resources.find(link => link.type === type);
    const resource = resources.find(item => item.id === reference?.resourceId) ??
      live.find(item => item.type === type && item.metadata?.nodeId === node?.id);
    if (resource) return <ResourceRow key={type} resource={resource} open={() => onResource(resource)} />;
    if (type === 'quiz' && quizId) return <Row key={type} title="随堂练习" icon="check-square" onPress={() => onPractice(quizId)} />;
    const status = generation?.nodeId === node?.id ? generation?.statuses[type] : undefined;
    const currentGeneration = busy && generation.nodeId === node?.id &&
      (!generation.resourceType || generation.resourceType === type);
    if (currentGeneration && status !== 'failed') {
      return <Notice key={type} text={resourceLabels[type] + (status === 'running' ? '生成中' : '等待生成')} busy={status === 'running'} />;
    }
    return <Button key={type} label={(status === 'failed' ? '重试' : '生成') + resourceLabels[type]}
      secondary disabled={generationDisabled || offline} action={() => generate(type)} />;
  }

  const types = new Set([...(node?.recommendedTypes ?? []), ...(node?.resources.map(resource => resource.type) ?? [])]);
  const extras = [...types].filter(type => type !== 'document' && type !== 'quiz');
  return <>
    <Heading title={taskId ? node?.title ?? '学习任务' : path?.goal ?? '学习路径'} />
    {offline ? <Notice text="正在查看本机缓存的课节和资源" /> : null}
    {generation?.error ? <Notice text={generation.error} error /> : null}
    {error ? <Notice text={error} error /> : null}
    {(error || generation?.error) && !busy ? <Button label="刷新课节" secondary action={() => setReload(value => value + 1)} /> : null}
    {busy ? <Notice text={generation.stage} busy /> : remoteRunning ? <Notice text="服务器正在生成，已保存的内容会自动刷新" busy />
      : !loaded && !error ? <Notice text="正在读取学习路径" busy /> : null}
    {anotherPathRunning ? <Notice text="另一条学习路径正在生成，可先阅读本课节已完成的内容。" /> : null}
    {loaded && !path && !busy && !taskId ? <Button label={isStaged ? '重试规划学习路径' : '生成第一节'}
      disabled={generationDisabled || offline} action={() => generate()} /> : null}
    {!taskId && path?.nodes.length ? <>
      <PathTimeline nodes={path.nodes} onTask={openTask} />
      <Button label="让 AI 重新规划学习路径" secondary disabled={generationDisabled || offline} action={replan} />
    </> : null}
    {taskId && loaded && (!node || node.status === 'locked') ? <Notice text={node
      ? '完成前面的阶段后才能开始此任务' : '此任务已从当前学习路径调整，请返回查看'} /> : null}
    {node && node.status !== 'locked' ? <>
      <Card>
        <Text style={styles.detail}>{node.estimatedMinutes} 分钟 · {node.knowledgePoints.join('、')}</Text>
        {isStaged && node.status === 'available' && !generationDisabled ? <Button label="生成讲义与练习"
          disabled={offline} action={() => void run('/smartlearn/resources', { sessionId, currentNodeId: node.id }, sessionId)} />
          : <>{renderResource('document')}{renderResource('quiz')}</>}
        {latest && quizId ? <Row title="查看练习报告" icon="bar-chart-2" onPress={() => onPractice(quizId, latest)} /> : null}
        {!isStaged && node.status === 'in_progress' && latest ?
          <Button label="完成并生成下一节" disabled={generationDisabled} action={() => generate(undefined, true)} /> : null}
        <Button label="向 AI 提问" secondary action={() => onChat(node)} />
      </Card>
      {extras.length ? <><Section>配套资源</Section><Card>{extras.map(renderResource)}</Card></> : null}
    </> : null}
  </>;
}


export default function SmartLearn() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [screens, setScreens] = useState<Screen[]>([{ type: 'main' }]);
  const [items, setItems] = useState<PathSummary[]>([]);
  const [resume, setResume] = useState<Resume | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats>();
  const [goal, setGoal] = useState('');
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [openingResume, setOpeningResume] = useState(false);
  const [error, setError] = useState('');
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceFilter, setResourceFilter] = useState<ResourceType | 'all'>('all');
  const [resourceQuery, setResourceQuery] = useState('');
  const [chatNode, setChatNode] = useState<Node>();
  const [noteSource, setNoteSource] = useState<NoteSource>();
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  const [savedBatch, setSavedBatch] = useState<ReviewBatch>();
  const resumeRequest = useRef<AbortController | null>(null);
  const mainRequest = useRef<AbortController | null>(null);
  const screen = screens[screens.length - 1];
  const token = auth?.token;
  const accountId = auth?.account.id;

  const logout = useCallback(() => {
    resumeRequest.current?.abort();
    mainRequest.current?.abort();
    setAuth(null);
    setTab('home');
    setScreens([{ type: 'main' }]);
    setItems([]);
    setResume(null);
    setNextOffset(null);
    setResources([]);
    setStats(undefined);
    setGoal('');
    setShowGoalForm(false);
    setChatNode(undefined);
    setNoteSource(undefined);
    setResourceFilter('all');
    setResourceQuery('');
    setError('');
    setOpeningResume(false);
    setOffline(false);
    setSavedBatch(undefined);
    void SecureStore.deleteItemAsync(tokenKey).catch(() => {});
    void SecureStore.deleteItemAsync(accountKey).catch(() => {});
  }, []);
  const { generation, reset, run } = usePathGeneration(token, logout);
  useEffect(() => { if (!token) reset(); }, [token, reset]);
  const creating = generation?.running && !generation.sessionId;

  const restore = useCallback(async (signal?: AbortSignal) => {
    setBooting(true);
    setBootError('');
    let saved: string | null = null;
    try {
      saved = await SecureStore.getItemAsync(tokenKey);
      if (!saved) return;
      const status = await api<{ mode: string; user: Account | null; hasProfile: boolean }>('/auth/status', saved, undefined, signal);
      if (signal?.aborted) return;
      if (status.mode === 'multi' && status.user) {
        const current = { token: saved, account: status.user, hasProfile: status.hasProfile };
        await storeAccount(current);
        if (!signal?.aborted) setAuth(current);
      } else logout();
    } catch (cause) {
      if (signal?.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) { logout(); return; }
      if (saved && isTemporaryError(cause)) {
        const snapshot = await SecureStore.getItemAsync(accountKey).catch(() => null);
        let previous: SavedAccount | undefined;
        try { if (snapshot) previous = JSON.parse(snapshot); } catch { /* Restore requires a valid account snapshot. */ }
        if (!signal?.aborted && previous?.server === apiUrl('/') && previous.account?.id) {
          setAuth({ token: saved, account: previous.account, hasProfile: previous.hasProfile });
          setOffline(true);
          return;
        }
      }
      if (!signal?.aborted) setBootError(cause instanceof Error ? cause.message : '无法恢复登录');
    } finally {
      if (!signal?.aborted) setBooting(false);
    }
  }, [logout]);
  useEffect(() => {
    const request = new AbortController();
    void restore(request.signal);
    return () => request.abort();
  }, [restore]);

  useEffect(() => {
    if (!accountId || !token) return;
    const controller = new AbortController();
    let running = false;
    const sync = async () => {
      if (running || controller.signal.aborted || AppState.currentState !== 'active') return;
      running = true;
      try {
        await flushSubmissions(accountId, token, controller.signal, () => setSyncRevision(value => value + 1));
      } catch (cause) {
        if (!controller.signal.aborted && cause instanceof ApiError && cause.status === 401) logout();
      } finally {
        running = false;
      }
    };
    setSavedBatch(readBatch(accountId));
    void sync();
    const timer = setInterval(() => void sync(), 8000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    return () => { controller.abort(); clearInterval(timer); foreground.remove(); };
  }, [accountId, token, logout]);

  const refresh = useCallback(async (offset = 0) => {
    if (!token || !accountId) return;
    mainRequest.current?.abort();
    const request = new AbortController();
    mainRequest.current = request;
    const signal = request.signal;
    setLoading(true);
    try {
      if (tab === 'resources') {
        const { data, offline: cached } = await getLearning<{ resources: Resource[] }>(accountId, '/mobile/resources', token, signal);
        if (signal.aborted) return;
        setOffline(cached);
        setResources(data.resources);
      } else if (tab !== 'chat') {
        const query = '/mobile/learning-paths?offset=' + offset + (tab === 'home' ? '&resume=1' : '');
        const { data, offline: cached } = await getLearning<{ items: PathSummary[]; nextOffset: number | null; resume?: Resume | null }>(accountId, query, token, signal);
        if (signal?.aborted) return;
        setOffline(cached);
        setItems(current => offset ? [...current, ...data.items.filter(item => !current.some(existing => existing.sessionId === item.sessionId))] : data.items);
        setNextOffset(data.nextOffset);
        if (tab === 'home') setResume(data.resume ?? null);
        if (tab === 'profile') await getLearning<Stats>(accountId, '/stats/learning', token, signal).then(result => {
          if (!signal.aborted) setStats(result.data);
        }).catch(cause => {
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
  }, [tab, token, accountId, logout]);
  useEffect(() => {
    if (screen.type !== 'main') return;
    void refresh();
    if (accountId) setSavedBatch(readBatch(accountId));
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => { mainRequest.current?.abort(); foreground.remove(); };
  }, [screen.type, refresh, generation?.running, accountId, syncRevision]);

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
    resumeRequest.current?.abort();
    setScreens([{ type: 'main' }]);
    setTab(value);
    setError('');
    if (value !== 'chat') setChatNode(undefined);
  }

  function startCareerLearning(goalText: string) {
    setGoal(goalText.slice(0, 500));
    setShowGoalForm(true);
    switchTab('learn');
  }

  async function createPath() {
    setError('');
    await run('/smartlearn', { action: 'start', goal: goal.trim(), client: 'mobile', planMode: 'staged' }, undefined, sessionId => {
      setGoal('');
      setShowGoalForm(false);
      openPath(sessionId);
    });
  }

  const openPractice = (resourceId: string, reportId?: string) => open({ type: 'practice', resourceId, reportId });
  const startReview = ({ resourceId, questionId, version }: ReviewItem) => open({
    type: 'practice', resourceId, review: { questionId, version },
  });
  const startBatch = (batch: ReviewBatch) => {
    if (!accountId) return;
    const existing = readBatch(accountId);
    if (existing) { open({ type: 'practice', batch: existing }); return; }
    try {
      saveDraft(accountId, 'review-batch');
      saveBatch(accountId, batch);
      setSavedBatch(batch);
    } catch { /* The batch is still usable while this screen is open. */ }
    open({ type: 'practice', batch });
  };
  const openWrongReport = (item: ReviewItem) => openPractice(item.resourceId, item.lastWrongAttemptId);
  const openResource = (resource: Resource) => {
    if (resource.type === 'quiz') return openPractice(resource.id);
    if (resource.type === 'document' && auth) documentProgress(auth.account.id, resource.id, 'opened');
    open({ type: 'resource', resource });
  };
  const openPath = (sessionId: string) => open({ type: 'path', sessionId });
  const recent = items[0];
  const needsFirstPath = !items.length && !loading;
  const avatarInitial = Array.from(auth?.account.username ?? '')[0]?.toUpperCase();
  const searchTerm = resourceQuery.trim().toLocaleLowerCase();
  const visibleResources = resources.filter(resource =>
    (resourceFilter === 'all' || resource.type === resourceFilter) &&
    (!searchTerm || (resource.title + ' ' + resourceLabels[resource.type]).toLocaleLowerCase().includes(searchTerm)));
  const currentResume = resume?.sessionId === recent?.sessionId ? resume : null;
  const quiz = currentResume?.quiz;
  const draft = auth && quiz && readDraft(auth.account.id, quiz.id, quiz.revision);
  const draftInProgress = draft && (!draft.attemptId || draft.attemptId !== currentResume?.attemptId) &&
    Object.values(draft.answers).some(answer => answer.trim());
  const reportId = draftInProgress ? undefined : currentResume?.attemptId ?? undefined;
  const document = currentResume?.document;
  const reading = auth && document ? documentProgress(auth.account.id, document.id) : 'new';
  const resumeTarget = quiz && (draftInProgress || reportId || !document || reading === 'read') ? 'quiz' : document ? 'document' : 'path';
  const resumeLabel = !recent ? '创建学习路径' : resumeTarget === 'quiz' ?
    (reportId ? '查看练习报告' : draftInProgress ? '继续答题' : '开始随堂练习') :
    resumeTarget === 'document' ? (reading !== 'new' ? '继续读讲义' : '阅读讲义') :
    recent.status === 'pending' ? '继续规划学习路径' : recent.status === 'completed' ? '查看学习路径' : '继续学习';

  async function continueLearning() {
    if (!recent || !auth) {
      setShowGoalForm(true);
      return switchTab('learn');
    }
    if (resumeRequest.current) return;
    const baseScreens: Screen[] = [{ type: 'main' }, { type: 'path', sessionId: recent.sessionId }];
    if (currentResume) baseScreens.push({ type: 'path', sessionId: recent.sessionId, taskId: currentResume.nodeId });
    if (resumeTarget === 'quiz' && quiz) {
      setScreens([...baseScreens, { type: 'practice', resourceId: quiz.id, reportId }]);
      return;
    }
    if (resumeTarget !== 'document' || !document) return openPath(recent.sessionId);
    const request = new AbortController();
    resumeRequest.current = request;
    setOpeningResume(true);
    setError('');
    try {
      const { data, offline: cached } = await getLearning<{ resources: Resource[] }>(auth.account.id, '/mobile/resources?sessionId=' + encodeURIComponent(recent.sessionId), auth.token, request.signal);
      if (request.signal.aborted) return;
      const resource = data.resources.find(item => item.id === document.id);
      if (resource) {
        documentProgress(auth.account.id, resource.id, 'opened');
        setScreens([...baseScreens, { type: 'resource', resource }]);
        setOffline(cached);
      } else setScreens(baseScreens);
    } catch (cause) {
      if (request.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) logout();
      else setScreens(baseScreens);
    } finally {
      if (resumeRequest.current === request) {
        resumeRequest.current = null;
        setOpeningResume(false);
      }
    }
  }

  return <SafeAreaView style={local.safe}>
    <View style={local.fill}>
      {booting ? <Page><Heading title="智学方舟" /><Notice text="正在读取账号" busy /></Page> :
        bootError ? <Page><Heading title="智学方舟" /><Notice text={bootError} error /><Button label="重试" action={() => void restore()} />
          <Button label="返回登录" secondary action={() => setBootError('')} /></Page> :
        !auth ? <AuthScreen onLogin={(token, account, hasProfile) => setAuth({ token, account, hasProfile })} /> :
        <>
          {screen.type !== 'main' ? <View style={local.back}>
            <IconButton icon="arrow-left" label="返回" action={back} />
          </View> : null}
          {screen.type === 'main' && tab === 'chat' ?
            <ChatView token={auth.token} node={chatNode} onClearNode={() => setChatNode(undefined)} onAuthError={logout} onSaveNote={setNoteSource} /> :
            <Page key={screen.type + ':' + screens.length + (screen.type === 'main' ? ':' + tab : '')}>
              {screen.type === 'path' ? <PathView key={screen.sessionId + ':' + (screen.taskId ?? '')} sessionId={screen.sessionId} taskId={screen.taskId}
                accountId={auth.account.id} token={auth.token} onResource={openResource} syncRevision={syncRevision}
                onTask={node => open({ type: 'path', sessionId: screen.sessionId, taskId: node.id })}
                generation={generation?.sessionId === screen.sessionId ? generation : undefined} run={run}
                anotherPathRunning={!!generation?.running && generation.sessionId !== screen.sessionId}
                onPractice={openPractice} onAuthError={logout} onChat={node => { switchTab('chat'); setChatNode(node); }} /> : null}
              {screen.type === 'resource' ? <ResourceView key={screen.resource.id} resource={screen.resource} token={auth.token} onSaveNote={setNoteSource}
                onRead={screen.resource.type === 'document' ? () => {
                  documentProgress(auth.account.id, screen.resource.id, 'read');
                  back();
                } : undefined} /> : null}
              {screen.type === 'practice' ? <PracticeView key={screen.resourceId} resourceId={screen.resourceId} accountId={auth.account.id}
                reportId={screen.reportId} review={screen.review} token={auth.token} onBack={back} onAuthError={logout}
                batch={screen.batch} syncRevision={syncRevision} onNextBatch={({ mode, topic }) => {
                  setScreens(previous => {
                    const parent = previous.at(-2);
                    return parent?.type === 'review' && parent.mode === mode && parent.topic === topic ? previous.slice(0, -1)
                    : [...previous.slice(0, -1), { type: 'review', mode, topic }];
                  });
                }}
                onReview={report => {
                  // Keep the source report on the navigation stack when leaving a retry.
                  setScreens(previous => [
                    ...previous.slice(0, -1),
                    { type: 'practice', resourceId: report.resourceId, reportId: report.attemptId },
                    { type: 'practice', resourceId: report.resourceId, review: { reportId: report.attemptId, version: report.version } },
                  ]);
                }}
                onPractice={resourceId => openPractice(resourceId)} /> : null}
              {screen.type === 'review' ? <ReviewView mode={screen.mode} initialTopic={screen.topic} accountId={auth.account.id} token={auth.token}
                syncRevision={syncRevision} onStart={startReview} onBatch={startBatch}
                onReport={openWrongReport} onAuthError={logout} /> : null}
              {screen.type === 'stats' ? <>
                <Heading title="学习统计" />
                <LearningStatsView accountId={auth.account.id} token={auth.token} syncRevision={syncRevision} onAuthError={logout}
                  onTopic={topic => open({ type: 'review', mode: 'mistakes', topic })} />
              </> : null}
              {screen.type === 'notebook' ? <NotebookView token={auth.token} onAuthError={logout} /> : null}
              {screen.type === 'career' ? <CareerInsightView token={auth.token} onAuthError={logout} onStartLearning={startCareerLearning} /> : null}
              {screen.type === 'main' ? <>
                {error ? <Notice text={error} error /> : null}
                {offline ? <Notice text="部分学习内容来自本机缓存" /> : null}
                {loading ? <Notice text="正在读取学习记录" busy /> : null}
                {tab === 'home' ? <>
                  <Heading title={'你好，' + auth.account.username} eyebrow={dateLabel()} action={
                    <Pressable accessibilityRole="button" accessibilityLabel="打开个人中心" onPress={() => switchTab('profile')}>
                      <Gradient image={gradient.warm} style={local.avatar}><Text style={local.avatarText}>{avatarInitial}</Text></Gradient>
                    </Pressable>} />
                  <HomeHero recent={recent} label={resumeLabel} busy={openingResume} onContinue={() => void continueLearning()} />
                  {savedBatch ? <Button label="继续上一组复习" action={() => startBatch(savedBatch)} /> : null}
                  <ReviewView mode="today" compact accountId={auth.account.id} token={auth.token} syncRevision={syncRevision} onStart={startReview} onBatch={startBatch}
                    onOpen={() => open({ type: 'review', mode: 'today' })} onReport={openWrongReport} onAuthError={logout} />
                  <View style={local.sectionGroup}>
                    <Section>快捷入口</Section>
                    <View style={local.quickGrid}>
                      <QuickLink icon="zap" label="AI 助手" tone={[color.violet, color.lightViolet]} action={() => switchTab('chat')} />
                      <QuickLink icon="repeat" label="错题本" tone={[color.red, color.lightRed]} action={() => open({ type: 'review', mode: 'mistakes' })} />
                      <QuickLink icon="layers" label="资源库" tone={[color.cyan, color.lightCyan]} action={() => switchTab('resources')} />
                      <QuickLink icon="bar-chart-2" label="学习统计" tone={[color.amber, color.lightAmber]} action={() => open({ type: 'stats' })} />
                    </View>
                    <View style={local.quickGrid}>
                      <QuickLink icon="book-open" label="记事本" tone={[color.cyan, color.lightCyan]} action={() => open({ type: 'notebook' })} />
                      <QuickLink icon="briefcase" label="职业洞察" tone={[color.violet, color.lightViolet]} action={() => open({ type: 'career' })} />
                    </View>
                  </View>
                  <LearningStatsView compact accountId={auth.account.id} token={auth.token} syncRevision={syncRevision}
                    onAuthError={logout} onOpen={() => open({ type: 'stats' })} />
                  <Section>最近学习</Section>
                  {items.slice(0, 3).map(item => <PathCard key={item.sessionId} item={item} open={() => openPath(item.sessionId)} />)}
                  {!items.length && !loading ? <Text style={styles.detail}>暂无学习路径</Text> : null}
                </> : null}
                {tab === 'learn' ? <>
                  <Heading title="我的学习" action={needsFirstPath ? undefined :
                    <IconButton icon={showGoalForm ? 'minus' : 'plus'} label={showGoalForm ? '收起学习目标' : '新建学习路径'}
                      action={() => setShowGoalForm(value => !value)} />} />
                  {recent ? <Pressable accessibilityRole="button" onPress={() => openPath(recent.sessionId)}>
                    <Gradient image={gradient.soft} style={local.goalBanner}>
                      <View style={local.goalIcon}><Feather name="target" size={21} color={color.blue} /></View>
                      <View style={local.pathCopy}><Text style={styles.detail}>当前目标</Text><Text style={styles.rowTitle} numberOfLines={2}>{recent.goal}</Text></View>
                      <Feather name="chevron-right" size={17} color={color.blue} />
                    </Gradient>
                  </Pressable> : null}
                  <View style={local.segments}>
                    <View style={[local.segment, local.segmentCurrent]}><Text accessibilityRole="header" style={[local.segmentText, local.segmentCurrentText]}>学习路径</Text></View>
                    <Pressable accessibilityRole="button" onPress={() => open({ type: 'review', mode: 'mistakes' })} style={local.segment}>
                      <Text style={local.segmentText}>错题本</Text>
                    </Pressable>
                  </View>
                  {showGoalForm || needsFirstPath || creating || (generation?.error && !generation.sessionId) ? <Card>
                    <Section>生成学习路径</Section>
                    <Field multiline maxLength={500} accessibilityLabel="学习目标" placeholder="例如，一个月内掌握决策树，每周学习三小时" value={goal} onChangeText={setGoal} />
                    {creating ? <Notice text={generation.stage} busy /> : null}
                    {generation?.running && generation.sessionId ? <Row title="返回正在生成的课节" icon="book-open" onPress={() => openPath(generation.sessionId!)} /> : null}
                    {generation?.error && !generation.sessionId ? <Notice text={generation.error} error /> : null}
                    <Button label={generation?.running ? '生成中…' : '生成学习路径'} disabled={!goal.trim() || !!generation?.running} action={() => void createPath()} />
                  </Card> : null}
                  {generation?.running && generation.sessionId && !showGoalForm && items.length ? <Card>
                    <Row title="返回正在生成的学习路径" icon="book-open" onPress={() => openPath(generation.sessionId!)} />
                  </Card> : null}
                  {items.map(item => <PathCard key={item.sessionId} item={item} open={() => openPath(item.sessionId)} />)}
                  {!items.length && !loading ? <Text style={styles.detail}>暂无学习路径</Text> : null}
                  {nextOffset !== null ? <Button label="加载更多" secondary disabled={loading} action={() => void refresh(nextOffset)} /> : null}
                </> : null}
                {tab === 'resources' ? <>
                  <Heading title="资源库" detail="来自学习路径的资源" />
                  <View style={local.search}>
                    <Feather name="search" size={18} color={color.muted} />
                    <Field style={local.searchInput} accessibilityLabel="搜索资源" placeholder="搜索资源名称或类型" value={resourceQuery}
                      onChangeText={setResourceQuery} returnKeyType="search" />
                    {resourceQuery.length ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setResourceQuery('')} style={local.searchClear}>
                      <Feather name="x" size={17} color={color.muted} />
                    </Pressable> : null}
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={local.filters}>
                    {(['all', ...Object.keys(resourceLabels)] as (ResourceType | 'all')[]).map(type =>
                      <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: resourceFilter === type }} onPress={() => setResourceFilter(type)}
                        style={[local.filter, resourceFilter === type && local.activeFilter]}>
                        <Text style={[local.filterText, resourceFilter === type && local.activeFilterText]}>{type === 'all' ? '全部' : resourceLabels[type]}</Text>
                      </Pressable>)}
                  </ScrollView>
                  {visibleResources.length ? <Card style={local.resourceList}>
                    {visibleResources.map(resource => <View key={resource.id} style={local.resourceItem}>
                    <ResourceRow resource={resource} open={() => openResource(resource)} />
                    </View>)}
                  </Card> : !loading ? <Notice text={searchTerm ? '未找到匹配的资源' : '此分类暂无学习资源'} /> : null}
                </> : null}
                {tab === 'profile' ? <>
                  <Heading title="我的" />
                  <Card><View style={local.statRow}>
                    <Gradient image={gradient.warm} style={local.brandIcon}><Text style={local.profileInitial}>{avatarInitial}</Text></Gradient>
                    <View style={styles.rowText}><Text style={local.profileName}>{auth.account.username}</Text>
                      <Text style={styles.detail}>{auth.hasProfile ? '已建立学习画像' : '尚未建立学习画像'}</Text></View>
                  </View></Card>
                  {stats ? <Card><View style={local.statRow}>
                    <Stat value={String(stats.answered)} label="已答题数" />
                    <Stat value={stats.accuracy + '%'} label="练习正确率" />
                    <Stat value={String(items.length)} label={nextOffset === null ? '学习路径' : '已加载路径'} />
                  </View></Card> : null}
                  <Card>
                    <Row title="学习统计" icon="bar-chart-2" onPress={() => open({ type: 'stats' })} />
                    <Row title="错题本" icon="repeat" tone={[color.violet, color.lightViolet]} onPress={() => open({ type: 'review', mode: 'mistakes' })} />
                  </Card>
                  <Section>个人工具</Section>
                  <Card>
                    <Row title="记事本" detail="查看和整理网页端共用的笔记" icon="book-open" tone={[color.cyan, color.lightCyan]}
                      onPress={() => open({ type: 'notebook' })} />
                    <Row title="职业洞察" detail="评估目标岗位并规划能力提升" icon="briefcase" tone={[color.violet, color.lightViolet]}
                      onPress={() => open({ type: 'career' })} />
                  </Card>
                  <Button label="退出登录" secondary action={logout} />
                </> : null}
                {error && !loading ? <Button label="重新加载" secondary action={() => { setError(''); void refresh(); }} /> : null}
              </> : null}
            </Page>}
          {screen.type === 'main' ? <View style={local.nav}>
            {tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
              disabled={!!creating} onPress={() => switchTab(item.id)} style={local.navItem}>
              {item.id === 'chat' ? <View style={local.navAiEdge}>
                <Gradient style={local.navAi}><Feather name={item.icon} size={24} color={color.white} /></Gradient>
              </View> : <View style={[local.navIcon, tab === item.id && local.navActive]}><Feather name={item.icon} size={21} color={tab === item.id ? color.blue : color.muted} /></View>}
              <Text style={[local.navText, tab === item.id && local.navTextActive]}>{item.title}</Text>
            </Pressable>)}
          </View> : null}
          {noteSource ? <Modal visible onRequestClose={() => setNoteSource(undefined)}>
            <SafeAreaView style={local.safe}>
              <View style={local.back}><IconButton icon="x" label="关闭保存笔记" action={() => setNoteSource(undefined)} /></View>
              <Page><NotebookView token={auth.token} source={noteSource} onAuthError={logout} onSaved={() => {
                setNoteSource(undefined);
                Alert.alert('笔记已保存');
              }} /></Page>
            </SafeAreaView>
          </Modal> : null}
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
  authBrand: { marginTop: 48, marginBottom: 8, gap: 14 },
  brandIcon: { backgroundColor: color.blue, width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#B8540C', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: color.white, fontSize: 17, fontWeight: '800' },
  profileInitial: { color: color.white, fontSize: 24, fontWeight: '800' },
  profileName: { color: color.ink, fontSize: 21, fontWeight: '800' },
  heroShadow: { ...surfaceShadow, backgroundColor: '#344AC9', borderRadius: 26, elevation: 4 },
  hero: { borderRadius: 26, padding: 18, gap: 14 },
  heroOrbit: { position: 'absolute', right: -54, top: -75, width: 208, height: 208, borderRadius: 104, backgroundColor: '#FFFFFF12' },
  heroOrbitInner: { position: 'absolute', left: -31, bottom: -112, width: 200, height: 200, borderRadius: 100, borderWidth: 1, borderColor: '#FFFFFF36' },
  heroLabel: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20,
    paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#FFFFFF24' },
  heroLabelText: { color: color.white, fontSize: 11, fontWeight: '700' },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroCopy: { flex: 1, gap: 5 },
  heroTitle: { color: color.white, fontSize: 21, fontWeight: '800', lineHeight: 28 },
  heroDetail: { color: '#E5ECFF', lineHeight: 20, fontSize: 13 },
  heroAction: { backgroundColor: color.white, borderRadius: 12, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    gap: 7, paddingVertical: 9, paddingHorizontal: 12, minHeight: 44, marginTop: 6, maxWidth: '100%' },
  heroActionText: { color: color.blueDark, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  heroRing: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF47' },
  ringRight: { position: 'absolute', right: 0, top: 0, width: 38, height: 76, overflow: 'hidden' },
  ringLeft: { position: 'absolute', left: 0, top: 0, width: 38, height: 76, overflow: 'hidden' },
  heroArc: { position: 'absolute', left: -38, top: 0, width: 76, height: 76, borderRadius: 38, overflow: 'hidden' },
  arcFill: { position: 'absolute', right: 0, width: 38, height: 76, backgroundColor: color.white },
  leftArc: { left: 0 },
  ringCenter: { width: 63, height: 63, borderRadius: 32, backgroundColor: '#4D3FB7', alignItems: 'center', justifyContent: 'center' },
  heroRingText: { color: color.white, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sectionGroup: { gap: 8 },
  quickGrid: { flexDirection: 'row', gap: 8 },
  quick: { ...surfaceShadow, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 74, padding: 5,
    backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 17 },
  quickLabel: { color: color.ink, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  pathCard: { ...surfaceShadow, backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 20,
    padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  pathIcon: { width: 47, height: 47, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pathCopy: { flex: 1 },
  pathTrack: { marginTop: 5, height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: color.tint },
  pathFill: { height: '100%', backgroundColor: color.blue, borderRadius: 3 },
  pathCount: { marginTop: 4, color: color.muted, fontSize: 11, lineHeight: 16 },
  goalBanner: { backgroundColor: color.tint, borderColor: '#D9E5FC', borderWidth: 1, padding: 14, borderRadius: 20,
    flexDirection: 'row', alignItems: 'center', gap: 11 },
  goalIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 15, backgroundColor: '#E8EEFB' },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 4 },
  segmentCurrent: { ...surfaceShadow, backgroundColor: color.white },
  segmentText: { color: color.muted, fontSize: 13, fontWeight: '700' },
  segmentCurrentText: { color: color.blue },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stat: { flex: 1, gap: 3, alignItems: 'center' },
  statValue: { color: color.ink, fontSize: 23, fontWeight: '800', fontVariant: ['tabular-nums'] },
  nav: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: color.white, borderTopWidth: 1, borderColor: color.line,
    paddingHorizontal: 6, paddingBottom: 5, paddingTop: 2 },
  navItem: { flex: 1, minHeight: 53, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  navIcon: { width: 44, height: 29, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  navActive: { backgroundColor: color.tint },
  navAiEdge: { ...surfaceShadow, borderRadius: 29, padding: 3, backgroundColor: color.white, marginTop: -13 },
  navAi: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 11, color: color.muted, fontWeight: '600' },
  navTextActive: { color: color.blueDark, fontWeight: '700' },
  back: { height: 51, width: '100%', maxWidth: 640, paddingHorizontal: 20, alignSelf: 'center', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 3 },
  search: { ...surfaceShadow, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 12, backgroundColor: color.white,
    borderWidth: 1, borderColor: color.line, borderRadius: 15 },
  searchInput: { flex: 1, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', minHeight: 46, paddingHorizontal: 0, marginRight: 8 },
  searchClear: { alignItems: 'center', justifyContent: 'center', width: 44, minHeight: 44 },
  filters: { gap: 7, paddingBottom: 2 },
  filter: { borderRadius: 20, paddingHorizontal: 13, minHeight: 42, justifyContent: 'center', backgroundColor: color.white, borderWidth: 1, borderColor: color.line },
  activeFilter: { backgroundColor: color.blue, borderColor: color.blue },
  filterText: { color: color.muted, fontSize: 13, fontWeight: '600' },
  activeFilterText: { color: color.white },
  resourceList: { overflow: 'hidden', paddingVertical: 2, gap: 0 },
  resourceItem: { paddingVertical: 3, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
});
