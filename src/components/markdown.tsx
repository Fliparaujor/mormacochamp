/** Markdown mínimo e seguro (títulos, listas, parágrafos, **negrito**, links). Sem HTML cru. */
export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="mb-4 list-disc space-y-1 pl-5">{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`} className="mb-4">{inline(para.join(" "))}</p>);
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushList();
      flushPara();
      const lvl = h[1].length;
      const cls = lvl === 1 ? "font-title mb-4 text-3xl" : lvl === 2 ? "font-title mt-6 mb-2 text-xl" : "font-title mt-4 mb-2 text-lg";
      blocks.push(lvl === 1 ? <h1 key={blocks.length} className={cls}>{inline(h[2])}</h1> : lvl === 2 ? <h2 key={blocks.length} className={cls}>{inline(h[2])}</h2> : <h3 key={blocks.length} className={cls}>{inline(h[2])}</h3>);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      flushPara();
      list.push(li[1]);
      continue;
    }
    if (!line.trim()) {
      flushList();
      flushPara();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushList();
  flushPara();
  return <div>{blocks}</div>;
}

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
    else out.push(<a key={m.index} href={m[3]} className="link" target="_blank" rel="noreferrer">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
