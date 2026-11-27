import MarkdownIt from 'markdown-it';
import { addMath } from './markdown-math';

export const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
export const mathMarkdown = new MarkdownIt({ html: false, breaks: true, linkify: true }).use(addMath);
// Keep formula-rich documents readable offline and avoid fetching remote media in the embedded renderer.
mathMarkdown.renderer.rules.image = (tokens, index) => mathMarkdown.utils.escapeHtml(tokens[index].content);

export function normalizeMarkdown(source: string, unwrap = false) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (unwrap) {
    const first = lines.findIndex(line => line.trim());
    const last = lines.findLastIndex(line => line.trim());
    const wrapper = /^\s*(\x60{3,}|~{3,})\s*(markdown|md|mindmap)?\s*$/i.exec(lines[first] ?? '');
    const end = lines[last]?.trim() ?? '';
    if (wrapper && last > first && end.startsWith(wrapper[1]) && [...end].every(char => char === wrapper[1][0])) {
      const inner = lines.slice(first + 1, last);
      if (wrapper[2] || inner.some(line => /^ {0,3}(?:#{1,6} *\S|[-+*] +\S)/.test(line))) {
        return normalizeMarkdown(inner.join('\n'));
      }
    }
  }

  let fence = '';
  return lines.map(line => {
    const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1].startsWith(fence) && !marker[2].trim()) fence = '';
      return line;
    }
    if (marker) {
      fence = marker[1];
      return line;
    }
    const heading = /^( {0,3})(#{1,6})( *[^#\s].*)$/.exec(line);
    if (!heading) return line;
    const [, indent, hashes, text] = heading;
    const title = text.trim();
    const closing = title.endsWith(hashes);
    if (text.startsWith(' ') && (!closing || hashes.length === 1)) return line;
    if (hashes.length === 1 && !closing && !/^[\u3400-\u9FFF]/.test(title)) return line;
    const label = closing ? title.slice(0, -hashes.length).trimEnd() : title;
    return indent + hashes + ' ' + label;
  }).join('\n');
}

export type MindmapBranch = { id: number; label: string; children: MindmapBranch[] };

export function mindmapBranches(source: string) {
  const roots: MindmapBranch[] = [];
  const headings: { level: number; branch: MindmapBranch }[] = [];
  const items: { branch?: MindmapBranch }[] = [];
  const tokens = markdown.parse(normalizeMarkdown(source, true), {});
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'list_item_open') items.push({});
    if (token.type === 'list_item_close') items.pop();
    if (token.type !== 'inline' || !token.content.trim()) continue;

    const tag = tokens[index - 1]?.tag ?? '';
    const level = /^h[1-6]$/.test(tag) && !items.length ? Number(tag[1]) : 0;
    const branch: MindmapBranch = { id: index, label: token.content, children: [] };
    if (level) {
      while ((headings.at(-1)?.level ?? 0) >= level) headings.pop();
    }
    const item = items.at(-1);
    const parent = item?.branch ?? items.at(-2)?.branch ?? headings.at(-1)?.branch;
    (parent?.children ?? roots).push(branch);
    if (level) headings.push({ level, branch });
    if (item && !item.branch) item.branch = branch;
  }
  return roots;
}
