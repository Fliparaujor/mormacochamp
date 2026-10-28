export interface DeckCard {
  qty: number;
  name: string;
  set: string | null;
  number: string | null;
  section: "pokemon" | "trainer" | "energy" | "unknown";
}

export interface ParsedDeck {
  cards: DeckCard[];
  total: number;
  ok: boolean; // 60 cartas
  warnings: string[];
  unparsed: string[];
}

const SECTION_RE = /^(pok[eé]mon|trainers?|treinador(?:es)?|energ(?:y|ies|ia|ias))\s*(?:[:\-–(]\s*\d*\)?)?\s*$/i;
const TOTAL_RE = /^total\s+(?:de\s+)?(?:cards|cartas)\s*[:\-]?\s*\d+\s*$/i;
// "4 Dreepy TWM 128", "* 4 Arven SVI 166", "2x Iono PAL 185", "8 Basic Fire Energy SVE 2", "1 Pokégear 3.0 SVI 186"
const CARD_RE = /^[*\-•\s]*(\d{1,2})\s*[xX]?\s+(.+?)(?:\s+([A-Z][A-Z0-9]{1,4}(?:-[A-Z0-9]{1,4})?)\s+([A-Za-z]{0,3}\d{1,3}[a-z]?))?\s*$/;

const BASIC_ENERGY = /^(basic\s+)?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy)\s+energy$/i;

export function parseDecklist(text: string | null | undefined): ParsedDeck {
  const cards: DeckCard[] = [];
  const unparsed: string[] = [];
  const warnings: string[] = [];
  let section: DeckCard["section"] = "unknown";
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(SECTION_RE);
    if (sec) {
      const s = sec[1].toLowerCase();
      section = s.startsWith("pok") ? "pokemon" : s.startsWith("ener") ? "energy" : "trainer";
      continue;
    }
    if (TOTAL_RE.test(line)) continue;
    const m = line.match(CARD_RE);
    if (!m) {
      unparsed.push(line);
      continue;
    }
    cards.push({
      qty: Number(m[1]),
      name: m[2].trim(),
      set: m[3] ?? null,
      number: m[4] ?? null,
      section,
    });
  }
  const total = cards.reduce((s, c) => s + c.qty, 0);
  if (cards.length > 0 && total !== 60) warnings.push(`A lista tem ${total} cartas, precisa ter 60.`);
  const byName = new Map<string, number>();
  for (const c of cards) {
    if (BASIC_ENERGY.test(c.name)) continue;
    byName.set(c.name.toLowerCase(), (byName.get(c.name.toLowerCase()) ?? 0) + c.qty);
  }
  for (const [name, qty] of byName) {
    if (qty > 4) warnings.push(`Mais de 4 cópias de "${name}" (${qty}).`);
  }
  if (unparsed.length) warnings.push(`${unparsed.length} linha(s) não reconhecida(s).`);
  return { cards, total, ok: total === 60, warnings, unparsed };
}
