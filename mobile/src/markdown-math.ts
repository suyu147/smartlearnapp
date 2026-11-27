import type MarkdownIt from 'markdown-it';
import katex from 'katex';

function formula(source: string, displayMode: boolean, markdown: MarkdownIt) {
  try {
    return katex.renderToString(source, { displayMode, output: 'mathml', trust: false, maxExpand: 100, maxSize: 10 });
  } catch {
    return '<code>' + markdown.utils.escapeHtml(source) + '</code>';
  }
}

export function addMath(markdown: MarkdownIt) {
  markdown.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    const line = state.src.slice(start, state.posMax);
    const dollar = /^\$(?![\s$])((?:\\[^\n]|[^$\n\\])+?)\$(?![\d$])/.exec(line);
    const parens = /^\\\((.+?)\\\)/.exec(line);
    const match = dollar && !/\s$/.test(dollar[1]) ? dollar : parens;
    if (!match) return false;
    if (!silent) state.push('math_inline', 'math', 0).content = match[1];
    state.pos += match[0].length;
    return true;
  });

  markdown.block.ruler.before('paragraph', 'math_block', (state, start, end, silent) => {
    const read = (line: number) => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    const first = read(start);
    const marker = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\]' : undefined;
    if (!marker || state.sCount[start] - state.blkIndent >= 4) return false;
    const contents = [first.slice(2)];
    let last = start;
    while (!contents[contents.length - 1].trimEnd().endsWith(marker)) {
      last++;
      if (last >= end || state.sCount[last] < state.blkIndent) return false;
      contents.push(read(last));
    }
    const source = contents.join('\n').trimEnd().slice(0, -2).trim();
    if (!source) return false;
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.content = source;
    token.map = [start, last + 1];
    state.line = last + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote'] });

  markdown.renderer.rules.math_inline = (tokens, index) => formula(tokens[index].content, false, markdown);
  markdown.renderer.rules.math_block = (tokens, index) =>
    '<div class="formula">' + formula(tokens[index].content, true, markdown) + '</div>\n';
}

export function containsMath(tokens: ReturnType<MarkdownIt['parse']>): boolean {
  return tokens.some(token => token.type === 'math_inline' || token.type === 'math_block' ||
    (token.children && containsMath(token.children)));
}
