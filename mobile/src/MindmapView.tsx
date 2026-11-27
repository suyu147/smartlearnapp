import { useMemo, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, View } from 'react-native';
import MarkdownContent from './MarkdownContent';
import { mindmapBranches, type MindmapBranch } from './markdown';
import { color } from './ui';

function Branch({ branch, depth }: { branch: MindmapBranch; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = branch.children.length > 0;
  const label = <View style={[styles.label, depth === 0 && styles.root]}>
    <MarkdownContent content={branch.label} />
  </View>;

  return <View style={styles.branch}>
    <View style={styles.row}>
      {label}
      {hasChildren ? <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起分支' : '展开分支'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        hitSlop={5}
        style={styles.toggle}
      >
        <Feather name={expanded ? 'minus' : 'plus'} color={color.blue} size={17} />
      </Pressable> : null}
    </View>
    {hasChildren && expanded ? <View style={[styles.children, depth > 5 && styles.deep]}>
      {branch.children.map(child => <View key={child.id} style={styles.child}>
        <View pointerEvents="none" style={styles.connector} />
        <Branch branch={child} depth={depth + 1} />
      </View>)}
    </View> : null}
  </View>;
}

export default function MindmapView({ content }: { content: string }) {
  const branches = useMemo(() => mindmapBranches(content), [content]);
  if (!branches.length) return <MarkdownContent content={content} />;
  return <View style={styles.branch}>
    {branches.map(branch => <Branch key={branch.id} branch={branch} depth={0} />)}
  </View>;
}

const styles = StyleSheet.create({
  branch: { gap: 7, flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { flex: 1, paddingHorizontal: 9, paddingTop: 7, borderRadius: 9, borderWidth: 1, borderColor: color.line },
  root: { backgroundColor: color.tint, borderColor: '#ADC4FC' },
  toggle: { padding: 7, borderRadius: 8, backgroundColor: color.tint },
  children: { gap: 7, marginLeft: 9, paddingLeft: 13, borderLeftWidth: 1, borderLeftColor: '#ADC4FC' },
  deep: { marginLeft: 0, paddingLeft: 6 },
  child: { position: 'relative', flexDirection: 'row' },
  connector: { position: 'absolute', width: 13, height: 1, left: -13, top: 19, backgroundColor: '#ADC4FC' },
});
