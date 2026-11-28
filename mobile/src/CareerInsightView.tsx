import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { JobSummary, LearningPath, MatchResult, PageData, RecommendationItem, ResumeRecord, SkillGap } from '../../lib/career/types';
import { ApiError, api } from './api';
import { Button, Card, Field, Heading, Notice, Row, Section, color, styles } from './ui';
import ResumeUpload from './ResumeUpload';

const educationOptions = ['大专', '本科', '硕士', '博士'];
const gapLabels: Record<SkillGap['status'], string> = { matched: '已具备', partial: '待加强', missing: '待学习' };
const dimensionLabels: Record<string, string> = { skills: '岗位能力', education: '学历', experience: '经验', certificates: '证书' };
const jobPageSize = 10;
const splitValues = (text: string) => [...new Set(text.split(/[，,、\n]/).map(value => value.trim()).filter(Boolean))];

export default function CareerInsightView({ token, onAuthError, onStartLearning }: {
  token: string; onAuthError: () => void; onStartLearning: (goal: string) => void;
}) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [role, setRole] = useState<{ id: string; name: string }>();
  const [jobSearch, setJobSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [jobRetry, setJobRetry] = useState(0);
  const [jobError, setJobError] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [certificatesText, setCertificatesText] = useState('');
  const [education, setEducation] = useState('');
  const [experience, setExperience] = useState('');
  const [result, setResult] = useState<MatchResult>();
  const [advice, setAdvice] = useState<LearningPath>();
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>();
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [busy, setBusy] = useState<'match' | 'recommend' | 'advice' | 'confirm' | null>(null);
  const [resume, setResume] = useState<ResumeRecord>();
  const [resumeConfirmed, setResumeConfirmed] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const profileBusy = !!busy || resumeLoading;
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), [token]);

  const handleError = useCallback((cause: unknown, show = setError) => {
    if (cause instanceof ApiError && cause.status === 401 && !cause.code?.startsWith('career_')) onAuthError();
    else show(cause instanceof Error ? cause.message : '职业洞察暂时不可用');
  }, [onAuthError]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingJobs(true);
    setJobError('');
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(jobPageSize), keyword: jobSearch.trim() });
      void api<PageData<JobSummary>>('/mobile/career/jobs?' + query, token, undefined, controller.signal, { timeoutMs: 45_000 })
        .then(result => {
          if (!controller.signal.aborted) {
            setJobs(result.items);
            setHasMore(page * result.pageSize < result.total && result.items.length > 0);
          }
        })
        .catch(cause => { if (!controller.signal.aborted) handleError(cause, setJobError); })
        .finally(() => { if (!controller.signal.aborted) setLoadingJobs(false); });
    }, jobSearch.trim() ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [token, page, jobSearch, jobRetry, handleError]);
  const skills = splitValues(skillsText);
  const certificates = splitValues(certificatesText);

  function resetDiagnosis() {
    setResult(undefined);
    setAdvice(undefined);
    setError('');
  }

  async function runAction<T>(action: NonNullable<typeof busy>, path: string, body: unknown, complete: (data: T) => void) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(action);
    setError('');
    try {
      const value = await api<T>(path, token, body, controller.signal, {
        method: action === 'confirm' ? 'PUT' : 'POST',
        timeoutMs: action === 'advice' ? 130_000 : 45_000,
      });
      if (!controller.signal.aborted) complete(value);
    } catch (cause) {
      if (!controller.signal.aborted) handleError(cause);
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  function changeProfile() {
    resetDiagnosis();
    setResumeConfirmed(false);
  }

  function applyResume(record: ResumeRecord) {
    changeProfile();
    setResume(record);
    setResumeConfirmed(Boolean(record.confirmed));
    setSkillsText((record.skills ?? []).map(skill => skill.skill_name).join('\n'));
    setEducation(record.education ?? '');
    setExperience(record.experienceYears == null ? '' : String(record.experienceYears));
    setCertificatesText((record.certificates ?? []).join('\n'));
    setRecommendations(undefined);
  }

  function confirmResume() {
    if (!resume || active.current) return;
    const years = experience.trim() ? Number(experience) : null;
    if (years !== null && (!Number.isFinite(years) || years < 0 || years > 80)) {
      setError('请输入 0 到 80 之间的工作年限');
      return;
    }
    void runAction<{ confirmed: boolean }>('confirm',
      '/career/resumes/' + encodeURIComponent(resume.resumeId) + '/confirmation',
      { skills, education, experienceYears: years, certificates }, response => {
        if (!response.confirmed) throw new Error('简历确认失败，请重试');
        setResumeConfirmed(true);
      });
  }

  function runDiagnosis() {
    if (!role || !skills.length || (resume && !resumeConfirmed) || active.current) return;
    const years = experience.trim() ? Number(experience) : null;
    if (years !== null && (!Number.isFinite(years) || years < 0 || years > 80)) {
      setError('请输入 0 到 80 之间的工作年限');
      return;
    }
    resetDiagnosis();
    const path = resumeConfirmed ? '/career/matching/manual' : '/mobile/career/matching/manual';
    void runAction<MatchResult>('match', path, {
      targetRoleId: role.id, skills, education, experienceYears: years, certificates,
      ...(resumeConfirmed ? { resumeId: resume?.resumeId, workStyleScore: 60 } : {}),
    }, setResult);
  }

  function findRecommendations() {
    if (!skills.length || (resume && !resumeConfirmed)) return;
    void runAction<{ items: RecommendationItem[] }>('recommend', '/mobile/career/matching/recommendations',
      { skills, limit: 8 }, value => setRecommendations(value.items));
  }

  function loadAdvice() {
    if (!result?.reportId) return;
    void runAction<LearningPath>('advice', '/career/matching/learning-path?reportId=' + encodeURIComponent(result.reportId), {}, setAdvice);
  }

  function createLearningGoal() {
    if (!result) return;
    const priorityGaps = [...(result.gaps ?? [])].filter(gap => gap.status !== 'matched')
      .sort((a, b) => b.importance - a.importance).slice(0, 6).map(gap => gap.skill);
    const focus = priorityGaps.length ? priorityGaps.join('、') : result.roleName + '岗位核心能力';
    onStartLearning(`为达到${result.roleName}岗位要求，重点学习${focus}。请按阶段安排讲义与练习。`);
  }

  return <>
    <Heading title="职业洞察" detail="评估岗位匹配度，找出下一步学习重点" />
    {error ? <Notice text={error} error /> : null}
    <Card>
      <ResumeUpload token={token} disabled={!!busy} onParsed={applyResume} onAuthError={onAuthError} onLoadingChange={setResumeLoading} />
      {resume ? <Text style={styles.detail}>{resume.fileName || '已上传简历'} · {resumeConfirmed ? '已确认' : '已解析，请在能力画像中核对'}</Text> : null}
    </Card>
    <Card>
      <Section>选择目标岗位</Section>
      <Field accessibilityLabel="搜索岗位" placeholder="搜索岗位名称" maxLength={100} value={jobSearch}
        onChangeText={value => { setJobSearch(value); setPage(1); }} />
      {role ? <Text style={local.selectedRole}>当前目标 · {role.name}</Text> : null}
      {loadingJobs ? <Notice text="正在读取岗位数据" busy /> : jobError ? <>
        <Notice text={jobError} error />
        <Button label="重新读取岗位" secondary action={() => setJobRetry(value => value + 1)} />
      </> : jobs.length ?
        <View style={local.jobs}>{jobs.map(job =>
          <Pressable key={job.id} accessibilityRole="button" accessibilityState={{ selected: role?.id === job.id, disabled: !!busy }}
            disabled={!!busy} onPress={() => { setRole(job); resetDiagnosis(); }} style={[local.job, role?.id === job.id && local.selectedJob]}>
            <Text style={[local.jobName, role?.id === job.id && local.selectedJobName]}>{job.name}</Text>
            {job.field ? <Text style={styles.detail}>{job.field}</Text> : null}
          </Pressable>,
        )}</View> : <Notice text="没有匹配的岗位" />}
      {!loadingJobs && !jobError && (page > 1 || hasMore) ? <View style={local.scores}>
        <View style={local.flex}><Button label="上一页" secondary disabled={page === 1} action={() => setPage(page - 1)} /></View>
        <View style={local.flex}><Button label="下一页" secondary disabled={!hasMore} action={() => setPage(page + 1)} /></View>
      </View> : null}
    </Card>
    <Card>
      <Section>填写能力画像</Section>
      <Text style={styles.detail}>用中文逗号分隔你掌握的技能，例如 SQL、数据分析、Python。</Text>
      <Field accessibilityLabel="已掌握技能" placeholder="已掌握技能" editable={!profileBusy} value={skillsText} multiline={!!resume}
        onChangeText={value => { setSkillsText(value); changeProfile(); setRecommendations(undefined); }} />
      <Text style={styles.detail}>学历</Text>
      {resume ? <Field accessibilityLabel="学历" placeholder="学历（可选）" value={education} editable={!profileBusy}
        onChangeText={value => { setEducation(value); changeProfile(); }} /> : <View style={local.options}>{educationOptions.map(option =>
        <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: education === option }}
          disabled={profileBusy} onPress={() => { setEducation(current => current === option ? '' : option); resetDiagnosis(); }}
          style={[local.option, education === option && local.optionSelected]}>
          <Text style={[local.optionText, education === option && local.optionTextSelected]}>{option}</Text>
        </Pressable>,
      )}</View>}
      <Field accessibilityLabel="工作年限" placeholder="工作年限（年，可留空）" keyboardType="decimal-pad" editable={!profileBusy} value={experience}
        onChangeText={value => { setExperience(value); changeProfile(); }} />
      <Field accessibilityLabel="证书" placeholder="证书（可选，逗号分隔）" editable={!profileBusy} value={certificatesText} multiline={!!resume}
        onChangeText={value => { setCertificatesText(value); changeProfile(); }} />
      {resume && !resumeConfirmed ? <>
        {resume.warnings?.length ? <Notice text={resume.warnings.join('\n')} /> : null}
        <Button label={busy === 'confirm' ? '正在确认…' : '确认简历信息'} disabled={profileBusy} action={confirmResume} />
      </> : null}
      {resume ? <Button label="改为手动填写" secondary disabled={profileBusy} action={() => {
        setResume(undefined);
        setSkillsText('');
        setEducation('');
        setExperience('');
        setCertificatesText('');
        setRecommendations(undefined);
        changeProfile();
      }} /> : null}
      <Button label={busy === 'match' ? '正在分析…' : '开始能力诊断'}
        disabled={!role || !skills.length || profileBusy || (!!resume && !resumeConfirmed)} action={runDiagnosis} />
      <Button label={busy === 'recommend' ? '正在匹配岗位…' : '根据技能推荐岗位'} secondary
        disabled={!skills.length || profileBusy || (!!resume && !resumeConfirmed)} action={findRecommendations} />
    </Card>
    {result ? <>
      <Card>
        <Section>{result.roleName} · 能力诊断</Section>
        <View style={local.scores}>
          <View style={local.scoreBlock}><Text style={local.score}>{Math.round(result.score)}</Text><Text style={styles.detail}>岗位匹配度</Text></View>
          <View style={local.scoreBlock}><Text style={local.scoreSecondary}>{Math.round(result.skillScore)}</Text><Text style={styles.detail}>技能匹配度</Text></View>
        </View>
        {result.notice ? <Text style={styles.detail}>{result.notice}</Text> : null}
        {result.dimensions?.length ? <>
          <Section>能力维度</Section>
          {result.dimensions.map(dimension => <View key={dimension.name} style={local.dimension}>
            <Text style={local.dimensionName}>{dimensionLabels[dimension.name] ?? dimension.name}</Text>
            <View style={local.track}><View style={[local.fill, { width: `${Math.max(0, Math.min(100, dimension.score))}%` }]} /></View>
            <Text style={local.dimensionScore}>{Math.round(dimension.score)}</Text>
          </View>)}
        </> : null}
        {result.gaps?.length ? <>
          <Section>技能差距</Section>
          {result.gaps.map((gap, index) => <View key={gap.skillId || gap.skill + index} style={local.gap}>
            <View style={styles.rowText}><Text style={local.gapName}>{gap.skill}</Text><Text style={styles.detail}>{gap.level}</Text></View>
            <Text style={[local.gapStatus, gap.status === 'matched' && local.matched]}>{gapLabels[gap.status]}</Text>
          </View>)}
        </> : null}
        {result.reportId && !advice ? <Button label={busy === 'advice' ? '正在生成学习建议…' : '生成学习建议'}
          secondary disabled={profileBusy} action={loadAdvice} /> : null}
        <Button label="按能力差距创建学习路径" disabled={profileBusy} action={createLearningGoal} />
      </Card>
    </> : null}
    {advice ? <Card>
      <Section>学习建议</Section>
      {advice.stages?.length ? advice.stages.map((stage, index) => <View key={index} style={local.advice}>
        <Text style={styles.rowTitle}>{stage.name}</Text>
        {stage.duration ? <Text style={styles.detail}>{stage.duration}</Text> : null}
        {stage.goal ? <Text style={styles.body}>{stage.goal}</Text> : null}
        {stage.skills?.length ? <Text style={styles.detail}>{stage.skills.join('、')}</Text> : null}
        {stage.weeklyTasks?.map((task, taskIndex) => <Text key={taskIndex} style={styles.detail}>{task.period} · {task.title}</Text>)}
        {stage.outcome ? <Text style={styles.detail}>{stage.outcome}</Text> : null}
      </View>) : <Text style={styles.detail}>这份诊断暂时没有学习建议。</Text>}
    </Card> : null}
    {recommendations ? <Card>
      <Section>适配岗位推荐</Section>
      {recommendations.map(item => <Row key={item.roleId} title={item.roleName} detail={`匹配度 ${Math.round(item.score)} · ${item.topGaps?.length ? '待加强：' + item.topGaps.join('、') : '技能适配'}`}
        icon="briefcase" onPress={() => {
          if (!active.current) { setRole({ id: item.roleId, name: item.roleName }); resetDiagnosis(); }
        }} />)}
      {!recommendations.length ? <Text style={styles.detail}>暂未找到适合当前技能的岗位。</Text> : null}
    </Card> : null}
  </>;
}

const local = StyleSheet.create({
  selectedRole: { color: color.blueDark, fontSize: 13, fontWeight: '700' },
  jobs: { gap: 6 },
  job: { borderWidth: 1, borderColor: color.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  selectedJob: { backgroundColor: color.tint, borderColor: '#B9CCFF' },
  jobName: { color: color.ink, fontSize: 14, fontWeight: '600' },
  selectedJobName: { color: color.blueDark },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { borderWidth: 1, borderColor: color.line, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7 },
  optionSelected: { backgroundColor: color.tint, borderColor: color.blue },
  optionText: { color: color.muted, fontSize: 13, fontWeight: '600' },
  optionTextSelected: { color: color.blueDark },
  scores: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  advice: { gap: 3, borderTopWidth: 1, borderColor: color.line, paddingTop: 8 },
  scoreBlock: { flex: 1, alignItems: 'center', backgroundColor: color.tint, borderRadius: 15, padding: 12 },
  score: { color: color.blueDark, fontSize: 30, fontWeight: '800' },
  scoreSecondary: { color: color.violet, fontSize: 30, fontWeight: '800' },
  dimension: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dimensionName: { color: color.ink, width: 62, fontSize: 13 },
  track: { flex: 1, height: 7, borderRadius: 5, backgroundColor: color.line, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: color.blue, borderRadius: 5 },
  dimensionScore: { color: color.muted, width: 26, textAlign: 'right', fontSize: 12 },
  gap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: color.line, paddingTop: 8 },
  gapName: { color: color.ink, fontSize: 14, fontWeight: '700' },
  gapStatus: { color: color.amber, fontSize: 12, fontWeight: '700' },
  matched: { color: color.green },
});
