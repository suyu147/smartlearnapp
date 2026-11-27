import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Node } from './types';
import { color, surfaceShadow } from './ui';

type Stage = { id: string; title: string; tasks: Node[] };

const statusLabels: Record<Node['status'], string> = {
  completed: '已完成', in_progress: '进行中', available: '待开始', locked: '未解锁',
};
const statusIcons = { completed: 'check', in_progress: 'play', available: 'book-open', locked: 'lock' } as const;
const stageNumbers = ['一', '二', '三', '四', '五', '六'];

export default function PathTimeline({ nodes, onTask }: { nodes: Node[]; onTask: (node: Node) => void }) {
  const groups = new Map<string, Stage>();
  for (const node of nodes) {
    const stage = node.stage ?? { id: 'existing', title: '已有学习' };
    const group = groups.get(stage.id);
    if (group) group.tasks.push(node);
    else groups.set(stage.id, { ...stage, tasks: [node] });
  }

  return <View style={local.timeline}>
    {[...groups.values()].map((stage, index) => {
      const completed = stage.tasks.filter(node => node.status === 'completed').length;
      const done = completed === stage.tasks.length;
      const locked = stage.tasks.every(node => node.status === 'locked' || node.status === 'completed') && !done;
      const state = done ? 'completed' : locked ? 'locked' : 'in_progress';
      const minutes = stage.tasks.filter(node => node.status !== 'completed')
        .reduce((total, node) => total + node.estimatedMinutes, 0);
      const hours = Math.floor(minutes / 60);
      const remaining = minutes % 60;
      const estimate = hours ? hours + ' 小时' + (remaining ? ' ' + remaining + ' 分钟' : '') : minutes + ' 分钟';
      return <View key={stage.id} style={local.stage}>
        {index < groups.size - 1 ? <View style={local.rail} /> : null}
        <View style={[local.marker, local[state], state === 'in_progress' && local.activeMarker]}>
          <Feather name={state === 'in_progress' ? 'zap' : statusIcons[state]} size={16}
            color={state === 'in_progress' ? color.white : local[state].color} />
        </View>
        <View style={local.stageContent}>
          <View style={local.header}>
            <Text accessibilityRole="header" style={local.stageTitle}>
              {stage.id === 'existing' ? stage.title : '阶段' + (stageNumbers[index] ?? (index + 1)) + ' · ' + stage.title}
            </Text>
            <Text style={[local.pill, local[state]]}>{statusLabels[state]}</Text>
          </View>
          <Text style={local.subtitle}>
            {locked ? '完成上一阶段后自动解锁' :
              completed + ' / ' + stage.tasks.length + ' 个任务' + (done ? '' : ' · 预计还需 ' + estimate)}
          </Text>
          <View style={local.tasks}>
            {stage.tasks.map(node => <Pressable key={node.id} accessibilityRole="button"
              accessibilityLabel={node.title + '，' + statusLabels[node.status]}
              accessibilityState={{ disabled: node.status === 'locked' }}
              disabled={node.status === 'locked'} onPress={() => onTask(node)}
              style={({ pressed }) => [local.task, node.status === 'locked' && local.lockedTask,
                node.status === 'in_progress' && local.activeTask, pressed && local.pressed]}>
              <View style={[local.taskIcon, local[node.status]]}>
                <Feather name={statusIcons[node.status]} size={14} style={local[node.status]} />
              </View>
              <Text style={[local.taskTitle, node.status === 'locked' && local.lockedTitle]}>{node.title}</Text>
              {node.status !== 'locked' ? <Text style={[local.pill, local[node.status]]}>{statusLabels[node.status]}</Text> : null}
            </Pressable>)}
          </View>
        </View>
      </View>;
    })}
  </View>;
}

const local = StyleSheet.create({
  timeline: { paddingTop: 2 },
  stage: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 22 },
  rail: { position: 'absolute', top: 23, bottom: -3, left: 15, width: 2, backgroundColor: '#CFDDFB' },
  marker: { width: 32, height: 32, borderWidth: 2, borderColor: color.white, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stageContent: { flex: 1, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  stageTitle: { flex: 1, color: color.ink, fontSize: 17, fontWeight: '800', lineHeight: 25 },
  subtitle: { color: color.muted, fontSize: 12, lineHeight: 18 },
  tasks: { gap: 7, marginTop: 5 },
  task: { ...surfaceShadow, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10,
    paddingVertical: 9, backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 14 },
  activeTask: { borderColor: '#AFC5FC' },
  activeMarker: { backgroundColor: color.blue, borderColor: '#D7E6FF' },
  lockedTask: { backgroundColor: '#F0F4FA', elevation: 0 },
  taskIcon: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  taskTitle: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700', color: color.ink },
  lockedTitle: { color: color.muted },
  pill: { fontSize: 11, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  completed: { color: color.green, backgroundColor: color.lightGreen },
  in_progress: { color: color.blue, backgroundColor: color.tint },
  available: { color: color.blueDark, backgroundColor: '#F0F4FF' },
  locked: { color: color.muted, backgroundColor: '#E9EFF7' },
  pressed: { opacity: 0.65 },
});
