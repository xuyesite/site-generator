// solve.js — a fast, dependency-free drop-in for makefun-site 1.0.0.
//
// Written from the makefun-site README (the spec of its front matter, template
// dialect, Markdown subset, slug rule and report). No reference implementation
// was read. `run(input)` returns the output tree for one case's site:
// a JSON object of every path the build writes and that file's text.
//
// Speed comes from doing each piece of work once: templates are parsed once
// per case; each source's Markdown is rendered once (content, excerpt, toc
// and reading minutes in the same pass); a post's card HTML is rendered once
// and reused on every index and tag page that shows it; the header and footer
// are rendered once per case when they do not depend on the page.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const r = ESC[s[i]];
    out += r === undefined ? s[i] : r;
  }
  return out;
}

/** True when the character at pos is escaped: an odd run of backslashes
directly before it. A backslash only escapes an escapable character, and
`*` is escapable, so the odd/even run test is exact for `*`. */
function isEscaped(s, pos) {
  let n = 0;
  for (let j = pos - 1; j >= 0 && s[j] === '\\'; j--) n++;
  return (n & 1) === 1;
}

/** A slug: NFKD, combining marks dropped, lowered, each run of other characters one `-`, none at either end, cut to 64 (a `-` left at the cut dropped), `untitled` when nothing is left. */
function slugify(text) {
  let s = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let a = 0, b = s.length;
  while (a < b && s[a] === '-') a++;
  while (b > a && s[b - 1] === '-') b--;
  s = s.slice(a, b);
  if (s.length > 64) {
    s = s.slice(0, 64);
    if (s.endsWith('-')) s = s.slice(0, -1);
  }
  return s === '' ? 'untitled' : s;
}

/** The first of `base`, `base-2`, `base-3` ... not yet taken. */
function uniqueSlug(taken, base) {
  if (!taken.has(base)) { taken.add(base); return base; }
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  const s = base + '-' + n;
  taken.add(s);
  return s;
}

/** `2026-11-09` is `9 November 2026`; "" when there is no date. */
function dateLong(d) {
  if (!d) return '';
  return (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1) return false;
  let dim = DAYS_IN_MONTH[mo - 1];
  if (mo === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) dim = 29;
  return d <= dim;
}

/** A quoted string value: `"..."` whose only escapes are `\"` and `\\`. */
function parseQuoted(v) {
  let out = '';
  let i = 1;
  while (i < v.length) {
    const c = v[i];
    if (c === '\\') {
      const n = v[i + 1];
      if (n === '"' || n === '\\') { out += n; i += 2; }
      else return { ok: false, reason: 'a quoted string is not closed' };
    } else if (c === '"') {
      if (i !== v.length - 1) return { ok: false, reason: 'a quoted string is not closed' };
      return { ok: true, value: out };
    } else { out += c; i++; }
  }
  return { ok: false, reason: 'a quoted string is not closed' };
}

function parseValue(key, value) {
  switch (key) {
    case 'title':
    case 'summary': {
      if (value[0] === '"') return parseQuoted(value);
      if (value[0] === '[') return { ok: false, reason: 'a bare string opens on [' };
      return { ok: true, value };
    }
    case 'date':
      return validDate(value)
        ? { ok: true, value }
        : { ok: false, reason: 'not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    case 'tags': {
      if (value[0] !== '[' || value[value.length - 1] !== ']') return { ok: false, reason: 'not a list [a, b]' };
      const inner = value.slice(1, -1);
      if (inner.trim() === '') return { ok: true, value: [] };
      const tags = [];
      for (const part of inner.split(',')) {
        const p = part.trim();
        if (p === '' || p.indexOf('"') !== -1 || p.indexOf('[') !== -1 || p.indexOf(']') !== -1) {
          return { ok: false, reason: 'an empty tag, or one holding " [ or ]' };
        }
        tags.push(p);
      }
      return { ok: true, value: tags };
    }
    case 'draft':
      return value === 'true' || value === 'false'
        ? { ok: true, value: value === 'true' }
        : { ok: false, reason: 'true or false' };
    case 'layout':
      return /^[a-z0-9-]+$/.test(value)
        ? { ok: true, value }
        : { ok: false, reason: 'not a template name' };
    case 'slug':
      return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 64
        ? { ok: true, value }
        : { ok: false, reason: 'not a slug' };
    default:
      return { ok: false, reason: 'unknown key' };
  }
}

/**
 * Parse a source's front matter. Returns { ok, fm, body } or { ok: false, reason }.
 * The front matter opens on the line `---` and runs to the next line exactly `---`.
 */
function parseFrontMatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') return { ok: false, reason: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { ok: false, reason: 'the front matter is not closed' };
  const fm = {};
  const seen = new Set();
  for (let i = 1; i < close; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    if (/^[ \t]*$/.test(line)) continue;
    if (line[0] === '#') continue;
    const m = /^([a-z_]+):(.*)$/.exec(line);
    if (!m) return { ok: false, reason: `line ${lineNo} is not "key: value"` };
    const key = m[1], rest = m[2];
    if (!FM_KEYS.has(key)) return { ok: false, reason: `unknown key "${key}"` };
    if (seen.has(key)) return { ok: false, reason: `key "${key}" is given twice` };
    seen.add(key);
    if (rest === '') return { ok: false, reason: `key "${key}" has no value` };
    if (rest[0] !== ' ') return { ok: false, reason: `line ${lineNo} is not "key: value"` };
    const value = rest.slice(1).replace(/[ \t]+$/, '');
    if (value === '') return { ok: false, reason: `key "${key}" has no value` };
    const parsed = parseValue(key, value);
    if (!parsed.ok) return { ok: false, reason: `key "${key}": ${parsed.reason}` };
    fm[key] = parsed.value;
  }
  if (fm.title === undefined) return { ok: false, reason: 'no title' };
  return { ok: true, fm, body: lines.slice(close + 1).join('\n') };
}

// ---------------------------------------------------------------- templates

const PATH_RE = /^([A-Za-z_][A-Za-z0-9_]*)(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
function parsePath(s) {
  const t = s.trim();
  if (!PATH_RE.test(t)) return null;
  return t.split('.');
}

/**
 * Tokenize a template into text / var / raw / tag tokens, then drop the line
 * of every `{% %}` tag that stands alone on its line (only spaces or tabs
 * beside it): the whole line goes with it, its `\n` included.
 */
function tokenizeTemplate(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const v = src.indexOf('{{', i);
    const t = src.indexOf('{%', i);
    let at = -1, kind = '';
    if (v !== -1 && (t === -1 || v <= t)) { at = v; kind = src.startsWith('{{{', v) ? 'raw' : 'var'; }
    else if (t !== -1) { at = t; kind = 'tag'; }
    if (at === -1) { tokens.push({ type: 'text', s: src.slice(i) }); break; }
    if (at > i) tokens.push({ type: 'text', s: src.slice(i, at) });
    if (kind === 'raw') {
      const end = src.indexOf('}}}', at + 3);
      if (end === -1) return { error: 'a {{{ is not closed' };
      const path = parsePath(src.slice(at + 3, end));
      if (!path) return { error: 'a path is not one' };
      tokens.push({ type: 'raw', path });
      i = end + 3;
    } else if (kind === 'var') {
      const end = src.indexOf('}}', at + 2);
      if (end === -1) return { error: 'a {{ is not closed' };
      const path = parsePath(src.slice(at + 2, end));
      if (!path) return { error: 'a path is not one' };
      tokens.push({ type: 'var', path });
      i = end + 2;
    } else {
      const end = src.indexOf('%}', at + 2);
      if (end === -1) return { error: 'a {% is not closed' };
      const inner = src.slice(at + 2, end).trim();
      const tag = parseTag(inner);
      if (tag.error) return { error: tag.error };
      tokens.push(tag);
      i = end + 2;
    }
  }
  // Standalone {% %} lines: the tag alone on its line takes the whole line.
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.type !== 'tag') continue;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    let beforeOk = false;
    if (!prev) beforeOk = true;
    else if (prev.type === 'text') {
      const s = prev.s;
      const li = s.lastIndexOf('\n');
      const tail = li === -1 ? s : s.slice(li + 1);
      if (/^[ \t]*$/.test(tail)) beforeOk = true;
    }
    if (!beforeOk) continue;
    let afterOk = false, afterCut = 0;
    if (!next) afterOk = true;
    else if (next.type === 'text') {
      const m = /^[ \t]*\n/.exec(next.s);
      if (m) { afterOk = true; afterCut = m[0].length; }
      else if (/^[ \t]*$/.test(next.s)) { afterOk = true; afterCut = next.s.length; }
    }
    if (!afterOk) continue;
    if (prev && prev.type === 'text') {
      const s = prev.s;
      const li = s.lastIndexOf('\n');
      prev.s = li === -1 ? '' : s.slice(0, li + 1);
    }
    if (next && next.type === 'text') next.s = next.s.slice(afterCut);
  }
  return { tokens };
}

function parseTag(inner) {
  if (inner === 'endfor') return { type: 'tag', name: 'endfor' };
  if (inner === 'endif') return { type: 'tag', name: 'endif' };
  if (inner === 'else') return { type: 'tag', name: 'else' };
  let m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/.exec(inner);
  if (m) {
    const path = parsePath(m[2]);
    if (!path) return { error: 'a path is not one' };
    return { type: 'tag', name: 'for', v: m[1], path };
  }
  m = /^if\s+not\s+(.+)$/.exec(inner);
  if (m) {
    const path = parsePath(m[1]);
    if (!path) return { error: 'a path is not one' };
    return { type: 'tag', name: 'if', path, not: true };
  }
  m = /^if\s+(.+)$/.exec(inner);
  if (m) {
    const path = parsePath(m[1]);
    if (!path) return { error: 'a path is not one' };
    return { type: 'tag', name: 'if', path, not: false };
  }
  m = /^include\s+"([^"]*)"$/.exec(inner);
  if (m) return { type: 'tag', name: 'include', name2: m[1] };
  return { error: 'a tag is none of the above' };
}

/** Build the node tree from tokens. Node types: 0 text, 1 var, 2 raw, 3 for, 4 if, 5 include. */
function buildAST(tokens) {
  const root = [];
  const stack = [{ nodes: root, kind: 'root', node: null }];
  for (const tok of tokens) {
    const top = stack[stack.length - 1];
    if (tok.type === 'text') {
      if (tok.s !== '') top.nodes.push({ t: 0, s: tok.s });
    } else if (tok.type === 'var') {
      top.nodes.push({ t: 1, path: tok.path });
    } else if (tok.type === 'raw') {
      top.nodes.push({ t: 2, path: tok.path });
    } else if (tok.type === 'tag') {
      if (tok.name === 'for') {
        const node = { t: 3, v: tok.v, path: tok.path, body: [] };
        top.nodes.push(node);
        stack.push({ nodes: node.body, kind: 'for', node });
      } else if (tok.name === 'endfor') {
        if (top.kind !== 'for') return { error: 'a for is closed out of order' };
        stack.pop();
      } else if (tok.name === 'if') {
        const node = { t: 4, path: tok.path, not: tok.not, then: [], els: null };
        top.nodes.push(node);
        stack.push({ nodes: node.then, kind: 'if', node });
      } else if (tok.name === 'else') {
        if (top.kind !== 'if' || top.node.els !== null) return { error: 'an else is out of order' };
        top.node.els = [];
        top.nodes = top.node.els;
      } else if (tok.name === 'endif') {
        if (top.kind !== 'if') return { error: 'an if is closed out of order' };
        stack.pop();
      } else if (tok.name === 'include') {
        top.nodes.push({ t: 5, name: tok.name2 });
      }
    }
  }
  if (stack.length !== 1) return { error: 'a for or if is not closed' };
  return { nodes: root };
}

function parseTemplate(src) {
  const tok = tokenizeTemplate(src);
  if (tok.error) return { error: tok.error };
  return buildAST(tok.tokens);
}

/** The first names of every path a template (and its includes) reads. */
function templateFirstNames(name, templates, seen, out) {
  if (seen.has(name)) return;
  seen.add(name);
  const tpl = templates.get(name);
  if (!tpl) return;
  const walk = (nodes) => {
    for (const nd of nodes) {
      if (nd.t === 1 || nd.t === 2 || nd.t === 3 || nd.t === 4) out.add(nd.path[0]);
      if (nd.t === 3) walk(nd.body);
      if (nd.t === 4) { walk(nd.then); if (nd.els) walk(nd.els); }
      if (nd.t === 5) templateFirstNames(nd.name, templates, seen, out);
    }
  };
  walk(tpl.nodes);
}

// ---------------------------------------------------------------- template rendering

function truthy(v) {
  return !(v === undefined || v === null || v === false || v === '' || v === 0 || (Array.isArray(v) && v.length === 0));
}

function formatValue(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(formatValue).join(', ');
  return '';
}

/** A path's first name from the innermost loop that binds it (`loop` before the element), else from the context; each next name an own property of the value so far. */
function resolvePath(names, ctx, varStack, loopStack) {
  const first = names[0];
  let v;
  let found = false;
  if (first === 'loop' && loopStack.length > 0) {
    v = loopStack[loopStack.length - 1];
    found = true;
  } else {
    for (let i = varStack.length - 1; i >= 0; i--) {
      if (Object.hasOwn(varStack[i], first)) { v = varStack[i][first]; found = true; break; }
    }
    if (!found && Object.hasOwn(ctx, first)) { v = ctx[first]; found = true; }
  }
  if (!found) return undefined;
  for (let k = 1; k < names.length; k++) {
    if (v === null || v === undefined) return undefined;
    const name = names[k];
    if (typeof v === 'object' || typeof v === 'function') {
      if (!Object.hasOwn(v, name)) return undefined;
      v = v[name];
    } else {
      v = v[name];
    }
  }
  return v;
}

function renderNodes(nodes, ctx, rt, varStack, loopStack, out, depth) {
  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n];
    if (node.t === 0) {
      out.push(node.s);
    } else if (node.t === 1) {
      out.push(esc(formatValue(resolvePath(node.path, ctx, varStack, loopStack))));
    } else if (node.t === 2) {
      out.push(formatValue(resolvePath(node.path, ctx, varStack, loopStack)));
    } else if (node.t === 3) {
      const arr = resolvePath(node.path, ctx, varStack, loopStack);
      if (Array.isArray(arr)) {
        const len = arr.length;
        const loop = { index: 0, first: false, last: false, length: len };
        for (let i = 0; i < len; i++) {
          loop.index = i + 1;
          loop.first = i === 0;
          loop.last = i === len - 1;
          const frame = {};
          frame[node.v] = arr[i];
          varStack.push(frame);
          loopStack.push(loop);
          renderNodes(node.body, ctx, rt, varStack, loopStack, out, depth);
          loopStack.pop();
          varStack.pop();
        }
      }
    } else if (node.t === 4) {
      let c = truthy(resolvePath(node.path, ctx, varStack, loopStack));
      if (node.not) c = !c;
      renderNodes(c ? node.then : (node.els || EMPTY_NODES), ctx, rt, varStack, loopStack, out, depth);
    } else if (node.t === 5) {
      renderInclude(node.name, ctx, rt, varStack, loopStack, out, depth);
    }
  }
}
const EMPTY_NODES = [];

function renderInclude(name, ctx, rt, varStack, loopStack, out, depth) {
  if (depth + 1 > 8) return;
  const tpl = rt.templates.get(name);
  if (!tpl) return;
  let key = null;
  if (name === 'card') {
    for (let i = varStack.length - 1; i >= 0; i--) {
      if (Object.hasOwn(varStack[i], 'p')) {
        const p = varStack[i].p;
        if (p && typeof p.url === 'string') key = 'card|' + p.url;
        break;
      }
    }
  } else if ((name === 'header' || name === 'nav') && rt.headerStatic) {
    key = name;
  } else if (name === 'footer' && rt.footerStatic) {
    key = 'footer';
  }
  if (key !== null) {
    const hit = rt.cache.get(key);
    if (hit !== undefined) { out.push(hit); return; }
    const tmp = [];
    renderNodes(tpl.nodes, ctx, rt, varStack, loopStack, tmp, depth + 1);
    const s = tmp.join('');
    rt.cache.set(key, s);
    out.push(s);
    return;
  }
  renderNodes(tpl.nodes, ctx, rt, varStack, loopStack, out, depth + 1);
}

function renderTemplate(name, ctx, rt) {
  const tpl = rt.templates.get(name);
  if (!tpl) return '';
  const out = [];
  renderNodes(tpl.nodes, ctx, rt, [], [], out, 0);
  return out.join('');
}

// ---------------------------------------------------------------- Markdown

const INLINE_ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
// The characters that end a plain-text run. One shared global regex, its
// lastIndex reset before every exec (inline is recursive, but each scan
// stores its result before any nested call, so the shared state is safe).
// A native scan for the next special character beats a per-character loop
// over the long plain stretches between markup.
const INLINE_SPECIAL = /[\\`*\[]/g;

function inline(s, ctx) {
  const out = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    INLINE_SPECIAL.lastIndex = i;
    const m = INLINE_SPECIAL.exec(s);
    const j = m ? m.index : n;
    if (j > i) { out.push(esc(s.slice(i, j))); i = j; }
    if (i >= n) break;
    const c = s[i];
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx !== undefined && INLINE_ESCAPABLE.has(nx)) { out.push(esc(nx)); i += 2; }
      else { out.push('\\'); i += 1; }
    } else if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end === -1 || end === i + 1) { out.push('`'); i += 1; }
      else { out.push('<code>' + esc(s.slice(i + 1, end)) + '</code>'); i = end + 1; }
    } else if (c === '*') {
      if (s[i + 1] === '*') {
        // Strong: the closer is the next `**` whose asterisks are both
        // live (not escaped). A pair whose first `*` is escaped is not a
        // closer: `**\*the\***` closes at the last two asterisks, giving
        // `<strong>*the*</strong>`, not `<strong>*the\</strong>*`.
        let end = -1;
        for (let k = i + 2; k < n - 1; k++) {
          if (s[k] === '*' && s[k + 1] === '*' && !isEscaped(s, k) && !isEscaped(s, k + 1)) { end = k; break; }
        }
        if (end === -1 || end === i + 2) { out.push('**'); i += 2; }
        else { out.push('<strong>' + inline(s.slice(i + 2, end), ctx) + '</strong>'); i = end + 2; }
      } else {
        // Emphasis: the closer is the next lone `*`. A `**` pair is never
        // an em closer — both asterisks are skipped together. That is why
        // in `*quick***` the em closes at the last `*` of the run
        // (`<em>quick**</em>`), while in `***at*** ... **tag** ... *canyon*`
        // the em opened by the dangling `*` after `***at***` skips the
        // `**tag**` pair (so `**tag**` still renders as a strong inside
        // the em) and closes at the `*` before "canyon". A `*` followed
        // by another `*` is not a closer, and neither is the second `*`
        // of a pair.
        let end = -1;
        for (let k = i + 1; k < n; k++) {
          if (s[k] === '\\') { k++; continue; }
          if (s[k] === '*') {
            if (s[k + 1] === '*') { k++; continue; }
            end = k; break;
          }
        }
        if (end === -1 || end === i + 1) { out.push('*'); i += 1; }
        else { out.push('<em>' + inline(s.slice(i + 1, end), ctx) + '</em>'); i = end + 1; }
      }
    } else if (c === '[') {
      let j2 = i + 1, close = -1;
      while (j2 < n) {
        if (s[j2] === '\\') { j2 += 2; continue; }
        if (s[j2] === ']') { close = j2; break; }
        j2++;
      }
      if (close === -1 || s[close + 1] !== '(') { out.push('['); i += 1; continue; }
      const paren = s.indexOf(')', close + 2);
      if (paren === -1) { out.push('['); i += 1; continue; }
      const target = s.slice(close + 2, paren);
      if (target === '' || /\s/.test(target)) { out.push('['); i += 1; continue; }
      const textHtml = inline(s.slice(i + 1, close), ctx);
      out.push('<a href="' + esc(resolveLink(target, ctx)) + '">' + textHtml + '</a>');
      i = paren + 1;
    }
  }
  return out.join('');
}

/** A link's href: a scheme, `/` or `#` target is kept as written; any other is a path from the source's directory. */
function resolveLink(target, ctx) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target[0] === '/' || target[0] === '#') return target;
  let path = target, frag = '';
  const hi = target.indexOf('#');
  if (hi !== -1) { path = target.slice(0, hi); frag = target.slice(hi); }
  const parts = ctx.srcDir === '' ? [] : ctx.srcDir.split('/');
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length) parts.pop(); continue; }
    parts.push(seg);
  }
  const resolved = parts.join('/');
  const url = ctx.pageUrls.get(resolved);
  if (url !== undefined) return url + frag;
  if (ctx.staticSet.has(resolved)) return ctx.base + '/' + resolved + frag;
  ctx.broken.add(`broken-link ${ctx.srcPath} -> ${target}`);
  return target;
}

const FENCE_OPEN = /^```([A-Za-z0-9_+\-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const HR_RE = /^(---|\*\*\*)[ \t]*$/;

/**
 * Render one source's body. Returns { html, toc, excerpt }: the HTML, the
 * level 2 and 3 headings, and the HTML of the body's first paragraph (or "").
 */
function renderMarkdown(body, ctx) {
  const lines = body.split('\n');
  const out = [];
  const toc = [];
  const idTaken = new Set();
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < n && !FENCE_CLOSE.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < n) i++;
      out.push('<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>');
      for (let b = 0; b < buf.length; b++) { out.push(esc(buf[b])); out.push('\n'); }
      out.push('</code></pre>\n');
      continue;
    }
    const hd = HEADING_RE.exec(line);
    if (hd) {
      const text = hd[2].replace(/[ \t]+$/, '');
      if (text !== '') {
        const level = hd[1].length;
        const id = uniqueSlug(idTaken, slugify(text));
        const html = inline(text, ctx);
        if (level === 2 || level === 3) toc.push({ level, id, html });
        out.push('<h' + level + ' id="' + id + '">' + html + '</h' + level + '>\n');
        i++;
        continue;
      }
    }
    if (HR_RE.test(line)) { out.push('<hr>\n'); i++; continue; }
    if (line[0] === '>') {
      const parts = [];
      while (i < n && lines[i][0] === '>') {
        let l = lines[i].slice(1);
        if (l[0] === ' ') l = l.slice(1);
        l = l.trim();
        if (l !== '') parts.push(l);
        i++;
      }
      if (parts.length) out.push('<blockquote>\n<p>' + inline(parts.join('\n'), ctx) + '</p>\n</blockquote>\n');
      else out.push('<blockquote>\n</blockquote>\n');
      continue;
    }
    const ordered = /^\d/.test(line);
    const lm = ordered ? /^(\d+)\. /.exec(line) : /^([-*]) /.exec(line);
    if (lm) {
      const items = [];
      let start = 1;
      if (ordered) start = parseInt(lm[1], 10);
      while (i < n) {
        const l = lines[i];
        let m;
        if (ordered) m = /^(\d+)\. /.exec(l);
        else m = /^([-*]) /.exec(l);
        if (m) { items.push(l.slice(m[0].length)); i++; }
        else if (/^[ \t]{2,}\S/.test(l)) { items[items.length - 1] += '\n' + l.trim(); i++; }
        else break;
      }
      out.push(ordered ? (start !== 1 ? '<ol start="' + start + '">\n' : '<ol>\n') : '<ul>\n');
      for (let k = 0; k < items.length; k++) out.push('<li>' + inline(items[k], ctx) + '</li>\n');
      out.push(ordered ? '</ol>\n' : '</ul>\n');
      continue;
    }
    const parts = [line.trim()];
    i++;
    while (i < n) {
      const l = lines[i];
      if (l.trim() === '') break;
      if (FENCE_OPEN.test(l)) break;
      if (/^#{1,6}[ \t]/.test(l)) break;
      if (HR_RE.test(l)) break;
      parts.push(l.trim());
      i++;
    }
    const html = inline(parts.join('\n'), ctx);
    if (excerpt === null) excerpt = html;
    out.push('<p>' + html + '</p>\n');
  }
  return { html: out.join(''), toc, excerpt: excerpt === null ? '' : excerpt };
}

// ---------------------------------------------------------------- the build

export function run(input) {
  const site = input.site;
  const base = site.base_url.replace(/\/+$/, '');
  const perPage = Math.max(1, site.per_page);
  const recentN = site.recent;
  const report = [];
  const broken = new Set();

  // Templates, parsed in code-unit order of name. One that does not parse
  // is reported and left out, as if it were not there.
  const templates = new Map();
  const tplNames = Object.keys(input.templates).sort();
  for (const name of tplNames) {
    const parsed = parseTemplate(input.templates[name]);
    if (parsed.error) report.push(`template "${name}": ${parsed.error}`);
    else templates.set(name, parsed);
  }

  // Whether the header and footer read anything that varies by page.
  const headerNames = new Set();
  templateFirstNames('header', templates, new Set(), headerNames);
  const footerNames = new Set();
  templateFirstNames('footer', templates, new Set(), footerNames);
  const rt = {
    templates,
    cache: new Map(),
    headerStatic: !headerNames.has('page') && !headerNames.has('tag'),
    footerStatic: !footerNames.has('page') && !footerNames.has('tag'),
  };

  // Sources, sorted by path in code-unit order. `.md` is a source, its
  // `\r\n` and lone `\r` made `\n`; any other file is static.
  const files = input.files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const statics = [];
  const sources = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, content: f.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n') });
    else statics.push(f);
  }
  const staticSet = new Set(statics.map((f) => f.path));

  // Front matter and the checks, in order: refused, under tags/ or page/,
  // a post with no date, a layout that is no template that parses, a draft.
  const kept = [];
  const takenByDir = new Map();
  const rootTaken = new Set(['posts', 'tags', 'page']);
  for (const src of sources) {
    const res = parseFrontMatter(src.content);
    if (!res.ok) { report.push(`refused ${src.path}: ${res.reason}`); continue; }
    const fm = res.fm;
    const isPost = src.path.startsWith('posts/');
    const dir = isPost ? 'posts' : (src.path.includes('/') ? src.path.slice(0, src.path.lastIndexOf('/')) : '');
    if (!isPost && (dir === 'tags' || dir === 'page' || src.path.startsWith('tags/') || src.path.startsWith('page/'))) {
      const d = src.path.startsWith('tags/') ? 'tags' : 'page';
      report.push(`refused ${src.path}: ${d}/ is the generator's own`);
      continue;
    }
    if (isPost && fm.date === undefined) { report.push(`refused ${src.path}: a post needs a date`); continue; }
    const layout = fm.layout || (isPost ? 'post' : 'page');
    if (!templates.has(layout)) { report.push(`refused ${src.path}: layout "${layout}" is no template that parses`); continue; }
    if (fm.draft === true) { report.push(`draft ${src.path}`); continue; }
    let taken = takenByDir.get(dir);
    if (!taken) {
      taken = dir === '' ? rootTaken : new Set();
      takenByDir.set(dir, taken);
    }
    const slug = uniqueSlug(taken, fm.slug || slugify(fm.title));
    const url = base + '/' + (dir ? dir + '/' : '') + slug + '/';
    const outPath = (dir ? dir + '/' : '') + slug + '/index.html';
    // Links resolve from the source file's own directory, not from the
    // permalink directory: a post lives in posts/YYYY/ even though its
    // url is under posts/, so `packet.md` from posts/2018/x.md means
    // posts/2018/packet.md.
    const srcDir = src.path.includes('/') ? src.path.slice(0, src.path.lastIndexOf('/')) : '';
    kept.push({ path: src.path, dir, srcDir, isPost, fm, body: res.body, layout, slug, url, outPath });
  }

  // Markdown, each source's body rendered to HTML, its links resolved.
  const pageUrls = new Map(kept.map((p) => [p.path, p.url]));
  for (const p of kept) {
    const ctx = { srcDir: p.srcDir, pageUrls, staticSet, base, broken, srcPath: p.path };
    const md = renderMarkdown(p.body, ctx);
    p.content = md.html;
    p.toc = md.toc;
    p.excerpt = md.excerpt;
    let words = 0;
    const m = p.body.match(/\S+/g);
    if (m) words = m.length;
    p.readingMinutes = Math.max(1, Math.ceil(words / 200));
  }

  // Collections: the posts, newest date first, equal dates by slug.
  const posts = kept.filter((p) => p.isPost);
  posts.sort((a, b) => (a.fm.date < b.fm.date ? 1 : a.fm.date > b.fm.date ? -1 : (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)));

  // Tags: each post's tags, each slug once (the first spelling kept); a tag
  // is all the posts whose tags have its slug, named as first met walking
  // the posts in collection order; ordered by count, most first, then slug.
  const tagMap = new Map();
  for (const p of posts) {
    const seenSlugs = new Set();
    p.tagSlugs = [];
    for (const t of (p.fm.tags || [])) {
      const s = slugify(t);
      if (seenSlugs.has(s)) continue;
      seenSlugs.add(s);
      p.tagSlugs.push({ name: t, slug: s });
      let tag = tagMap.get(s);
      if (!tag) {
        tag = { name: t, slug: s, url: base + '/tags/' + s + '/', count: 0, posts: [] };
        tagMap.set(s, tag);
      }
      tag.count++;
      tag.posts.push(p);
    }
  }
  const tags = [...tagMap.values()].sort((a, b) => (b.count - a.count) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const tagsCtx = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));

  // A page's tags link to the tag of the same slug, or have the url "" where
  // no post has that tag. The name is the tag's, the first spelling kept.
  function resolveTags(p) {
    const out = [];
    const seen = new Set();
    const raw = p.isPost ? p.tagSlugs : [];
    if (!p.isPost) {
      for (const t of (p.fm.tags || [])) {
        const s = slugify(t);
        if (seen.has(s)) continue;
        seen.add(s);
        raw.push({ name: t, slug: s });
      }
    }
    for (const t of raw) {
      if (seen.has(t.slug) && p.isPost) continue;
      seen.add(t.slug);
      const g = tagMap.get(t.slug);
      out.push(g ? { name: g.name, slug: t.slug, url: g.url } : { name: t.name, slug: t.slug, url: '' });
    }
    return out;
  }

  function cardOf(p) {
    return {
      title: p.fm.title,
      url: p.url,
      date: p.fm.date || '',
      date_long: dateLong(p.fm.date || ''),
      summary: p.fm.summary || '',
      excerpt: p.excerpt,
      reading_minutes: p.readingMinutes,
      tags: resolveTags(p),
    };
  }
  for (const p of kept) p.card = cardOf(p);
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = i > 0 ? posts[i - 1] : null;
    posts[i].older = i < posts.length - 1 ? posts[i + 1] : null;
  }
  function neighbour(p) {
    if (!p) return null;
    return { title: p.fm.title, url: p.url, date: p.fm.date || '', date_long: dateLong(p.fm.date || '') };
  }
  for (const p of kept) {
    p.page = {
      ...p.card,
      slug: p.slug,
      content: p.content,
      toc: p.toc,
      newer: p.isPost ? neighbour(p.newer) : null,
      older: p.isPost ? neighbour(p.older) : null,
      is_post: p.isPost,
    };
  }
  const recent = posts.slice(0, recentN).map((p) => p.card);
  const ctxBase = { site: { title: site.title, base_url: base }, tags: tagsCtx, recent };

  const output = {};

  // Layouts: every page through its layout, with `page`.
  for (const p of kept) {
    const ctx = { ...ctxBase, page: p.page };
    output[p.outPath] = renderTemplate(p.layout, ctx, rt);
  }

  // The index through `index`, `site.per_page` posts a page (at least one).
  const chunks = Math.max(1, Math.ceil(posts.length / perPage));
  for (let k = 0; k < chunks; k++) {
    const num = k + 1;
    const chunk = posts.slice(k * perPage, (k + 1) * perPage).map((p) => p.card);
    const url = num === 1 ? base + '/' : base + '/page/' + num + '/';
    const pager = {
      number: num,
      total: chunks,
      url,
      newer_url: num === 1 ? '' : (num === 2 ? base + '/' : base + '/page/' + (num - 1) + '/'),
      older_url: num === chunks ? '' : base + '/page/' + (num + 1) + '/',
    };
    const ctx = { ...ctxBase, posts: chunk, pager };
    const outPath = num === 1 ? 'index.html' : 'page/' + num + '/index.html';
    if (templates.has('index')) output[outPath] = renderTemplate('index', ctx, rt);
  }

  // Each tag through `tag`, and `tags/index.html` through `tags`.
  for (const t of tags) {
    const tag = { name: t.name, slug: t.slug, url: t.url, count: t.count, posts: t.posts.map((p) => p.card) };
    const ctx = { ...ctxBase, tag };
    if (templates.has('tag')) output['tags/' + t.slug + '/index.html'] = renderTemplate('tag', ctx, rt);
  }
  if (templates.has('tags')) output['tags/index.html'] = renderTemplate('tags', ctxBase, rt);

  // Each static file at its own path, unless a built page has that path.
  let staticWritten = 0;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) {
      report.push(`shadowed ${f.path}: a built page has its path`);
      continue;
    }
    output[f.path] = f.content;
    staticWritten++;
  }

  // The report: every line reported above and each broken link, sorted in
  // code-unit order, then the built line; every line ending in `\n`.
  for (const line of broken) report.push(line);
  report.sort();
  const pageCount = kept.length - posts.length;
  report.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${staticWritten} static files`);
  output['build-report.txt'] = report.map((l) => l + '\n').join('');

  return output;
}
