import { useCallback, useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { ApiError } from './api';
import { createNotebook, getNotebook, listNotebooks, removeNotebook, removeNote, saveNote, type Notebook, type NotebookRecord, type NoteSource } from './notebook-api';
import { Button, Card, Field, Heading, IconButton, Notice, Row, Section, styles } from './ui';
import MarkdownContent from './MarkdownContent';

export default function NotebookView({ token, onAuthError, source, onSaved }: {
  token: string; onAuthError: () => void; source?: NoteSource; onSaved?: () => void;
}) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selected, setSelected] = useState<Notebook>();
  const [records, setRecords] = useState<NotebookRecord[]>([]);
  const [activeRecord, setActiveRecord] = useState<NotebookRecord>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const selectedId = selected?.id;
  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) onAuthError();
    else setError(cause instanceof Error ? cause.message : '记事本暂时不可用');
  }, [onAuthError]);

  useEffect(() => {
    if (selectedId) return;
    const controller = new AbortController();
    setLoading(true);
    listNotebooks(token, controller.signal).then(data => {
      if (!controller.signal.aborted) setNotebooks(data);
    }).catch(cause => {
      if (!controller.signal.aborted) handleError(cause);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [selectedId, token, refresh, handleError]);

  useEffect(() => {
    if (!selectedId) {
      setRecords([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    getNotebook(token, selectedId, controller.signal).then(data => {
      if (!controller.signal.aborted) {
        setSelected(data.notebook);
        setRecords(data.records);
      }
    }).catch(cause => {
      if (!controller.signal.aborted) handleError(cause);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [selectedId, token, refresh, handleError]);

  async function addNotebook() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const notebook = await createNotebook(token, newName.trim(), newDescription.trim());
      setNotebooks(current => [notebook, ...current]);
      setNewName('');
      setNewDescription('');
      setCreateOpen(false);
      selectNotebook(notebook);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  function newNote() {
    setActiveRecord(undefined);
    setTitle('');
    setContent('');
    setEditing(true);
  }

  function selectNotebook(notebook: Notebook) {
    setSelected(notebook);
    setError('');
    if (source) {
      setTitle(source.title.slice(0, 200));
      setContent(source.content);
      setEditing(true);
    }
  }

  function editNote(record: NotebookRecord) {
    setActiveRecord(record);
    setTitle(record.title);
    setContent(record.content);
    setEditing(true);
  }

  async function persistNote() {
    if (!selected || !content.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const record = await saveNote(token, selected.id, {
        recordId: activeRecord?.id,
        expectedUpdatedAt: activeRecord?.updatedAt,
        title: title.trim() || '未命名笔记',
        content,
        metadata: activeRecord ? undefined : source?.metadata,
      });
      if (onSaved) {
        onSaved();
        return;
      }
      setRecords(current => activeRecord
        ? current.map(item => item.id === record.id ? record : item)
        : [record, ...current]);
      setSelected(current => current ? { ...current, recordCount: activeRecord ? current.recordCount : current.recordCount + 1 } : current);
      setActiveRecord(record);
      setEditing(false);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  function confirmRemoveNote(record: NotebookRecord) {
    Alert.alert('删除笔记', `确定删除“${record.title}”吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void (async () => {
        if (!selected || busy) return;
        setBusy(true);
        setError('');
        try {
          await removeNote(token, selected.id, record.id);
          setRecords(current => current.filter(item => item.id !== record.id));
          setSelected(current => current ? { ...current, recordCount: Math.max(0, current.recordCount - 1) } : current);
          if (activeRecord?.id === record.id) setActiveRecord(undefined);
        } catch (cause) {
          handleError(cause);
        } finally {
          setBusy(false);
        }
      })() },
    ]);
  }

  function confirmRemoveNotebook(notebook: Notebook) {
    Alert.alert('删除笔记本', `将同时删除“${notebook.name}”中的所有笔记。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void (async () => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await removeNotebook(token, notebook.id);
          setNotebooks(current => current.filter(item => item.id !== notebook.id));
          setSelected(undefined);
          setActiveRecord(undefined);
          setEditing(false);
        } catch (cause) {
          handleError(cause);
        } finally {
          setBusy(false);
        }
      })() },
    ]);
  }

  return <>
    <Heading title={selected?.name ?? (source ? '选择笔记本' : '记事本')} action={selected ?
      <IconButton icon="list" label={activeRecord || editing ? '返回笔记列表' : '全部笔记本'} disabled={busy} action={() => {
        if (source || (!activeRecord && !editing)) setSelected(undefined);
        setEditing(false);
        setActiveRecord(undefined);
        setError('');
      }} /> : <IconButton icon={createOpen ? 'x' : 'plus'} label={createOpen ? '取消新建' : '新建笔记本'} disabled={busy}
        action={() => setCreateOpen(value => !value)} />} />
    {error ? <Notice text={error} error /> : null}
    {error && !loading && !busy && !editing ? <Button label="刷新" secondary action={() => {
      setError(''); setActiveRecord(undefined); setRefresh(value => value + 1);
    }} /> : null}
    {loading ? <Notice text="正在读取笔记本" busy /> : null}
    {!selected && createOpen ? <Card>
      <Section>新建笔记本</Section>
      <Field accessibilityLabel="笔记本名称" placeholder="笔记本名称" maxLength={80} value={newName} onChangeText={setNewName} />
      <Field accessibilityLabel="笔记本说明" placeholder="说明（可选）" maxLength={1000} value={newDescription} onChangeText={setNewDescription} />
      <Button label={busy ? '正在创建…' : '创建笔记本'} disabled={!newName.trim() || busy} action={() => void addNotebook()} />
    </Card> : null}
    {!selected ? <>
      {notebooks.length ? <Card>{notebooks.map(notebook =>
        <Row key={notebook.id} title={notebook.name} detail={`${notebook.recordCount} 条笔记${notebook.description ? ' · ' + notebook.description : ''}`}
          icon="book-open" onPress={() => selectNotebook(notebook)} />,
      )}</Card> : !loading ? <Notice text="还没有笔记本，创建一个开始整理学习内容。" /> : null}
    </> : editing ? <Card>
      <Section>{activeRecord ? '编辑笔记' : '新建笔记'}</Section>
      <Field accessibilityLabel="笔记标题" placeholder="标题" maxLength={200} value={title} onChangeText={setTitle} />
      <Field accessibilityLabel="笔记内容" placeholder="支持 Markdown 格式" multiline value={content} onChangeText={setContent} />
      <Button label={busy ? '正在保存…' : '保存笔记'} disabled={!content.trim() || busy || loading} action={() => void persistNote()} />
      <Button label="取消编辑" secondary disabled={busy} action={() => {
        setEditing(false);
        setError('');
        if (source) setSelected(undefined);
      }} />
    </Card> : activeRecord ? <Card>
      <Section>{activeRecord.title}</Section>
      <MarkdownContent content={activeRecord.content} />
      <Button label="编辑笔记" secondary disabled={busy} action={() => editNote(activeRecord)} />
      <Button label="删除笔记" secondary disabled={busy} action={() => confirmRemoveNote(activeRecord)} />
    </Card> : <>
      <Card>
        <Button label="新建笔记" secondary disabled={loading || busy || !!error} action={newNote} />
        {records.length ? [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(record => <Row key={record.id} title={record.title || '未命名笔记'}
          detail={record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : ''} icon="file-text" onPress={() => setActiveRecord(record)} />)
          : <Text style={styles.detail}>这个笔记本还没有内容。</Text>}
      </Card>
      <Button label="删除笔记本" secondary disabled={loading || busy} action={() => confirmRemoveNotebook(selected)} />
    </>}
  </>;
}

