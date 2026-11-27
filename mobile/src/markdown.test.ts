import { describe, expect, it } from 'vitest';
import { markdown, mathMarkdown, mindmapBranches, normalizeMarkdown } from './markdown';
import { containsMath } from './markdown-math';

describe('Android Markdown content', () => {
  it('formats AI headings and lists, and keeps source code literal', () => {
    const source = ['`'.repeat(3) + 'markdown', '##分组##', '- 示例', '~~~js', 'const text = "$x$";', '~~~', '`'.repeat(3)].join('\n');
    const normalized = normalizeMarkdown(source, true);
    expect(markdown.render(normalized)).toContain('<h2>分组</h2>');
    expect(markdown.render(normalized)).toContain('<li>示例</li>');
    expect(markdown.render(normalized)).toContain('const text');
    expect(containsMath(mathMarkdown.parse(normalized, {}))).toBe(false);
  });

  it('renders inline and display formulas with wide tables and escapes HTML', () => {
    const source = ['## 公式', '设 $x^2$，另有 \\(z_0\\)。', '| 量 | 值 |', '| --- | --- |',
      '| A | $x$ |', '', '$$', '\\frac{a}{b}', '$$', '', '<script>ignored()</script>'].join('\n');
    const tokens = mathMarkdown.parse(source, {});
    expect(containsMath(tokens)).toBe(true);
    const rendered = mathMarkdown.render(source);
    expect(rendered).toContain('<msup>');
    expect(rendered).toContain('<msub>');
    expect(rendered).toContain('<mfrac>');
    expect(rendered).toContain('<table>');
    expect(rendered).not.toContain('<script>');
    expect(containsMath(mathMarkdown.parse('价格为 $5 和 $10', {}))).toBe(false);
  });

  it('builds nested branches from the existing Markdown mindmap format', () => {
    const [root] = mindmapBranches('# 数组\n## 特性\n- 连续存储\n  - 按索引访问\n## 用法');
    expect(root.label).toBe('数组');
    expect(root.children.map(branch => branch.label)).toEqual(['特性', '用法']);
    expect(root.children[0].children[0].children[0].label).toBe('按索引访问');
  });
});
