// The talk track (rule 3): docs/talk-track.md is the one source. This reads it into sections, so the page, the presenter mode and the
// tests all use the same words. A "## S0n: title" heading belongs to story S0n; any other heading is a general section.
import fs from 'node:fs';
import { fillDeep } from './cast.js';

// (HERE is a variable on purpose: Vite rewrites a literal `new URL('./x', import.meta.url)` into an asset URL, which would break the web tests that load this module.)
const HERE = import.meta.url;
export const TALK_TRACK_FILE = new URL('../../docs/talk-track.md', HERE);
const STORY_HEADING = /^(S\d{2}):\s*(.+)$/;
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A paragraph starts at a blank line: consecutive non-blank lines are one paragraph (joined with a space), so a hard-wrapped line never splits a sentence.
export function parseTalkTrack(markdown) {
  const text = String(markdown).replace(/<!--[\s\S]*?-->/g, '');
  const sections = [];
  let current = null;
  let open = false; // the last line added to the current section's last paragraph, with no blank line since
  for (const line of text.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      const story = STORY_HEADING.exec(h[1]);
      current = { id: story ? story[1] : slug(h[1]), title: story ? story[2] : h[1], paragraphs: [] };
      sections.push(current);
      open = false;
    } else if (current) {
      const t = line.trim();
      if (!t) open = false;
      else if (open) current.paragraphs[current.paragraphs.length - 1] += ` ${t}`;
      else { current.paragraphs.push(t); open = true; }
    }
  }
  return sections.map((s) => ({ ...s, say: s.paragraphs.join('\n\n') }));
}

// A missing or unreadable talk track is never silent: it is logged here (code only, never the path's contents) and GET /api/story says so; the doctor fails.
export function loadTalkTrack(file = TALK_TRACK_FILE) {
  try { return parseTalkTrack(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error(`[talk-track] docs/talk-track.md could not be read (${e?.code || 'error'}); the talk track is empty`);
    return [];
  }
}

// Read ONCE, when the module loads (so a missing file is logged once, not on every request); GET /api/story and the doctor use this copy.
export const TALK_SECTIONS = Object.freeze(loadTalkTrack());

export const buildTalkTrack = (cast, sections = TALK_SECTIONS) => fillDeep(sections, cast);
