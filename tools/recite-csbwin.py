#!/usr/bin/env python3
"""Re-cite CSBWin: every citation of a 2016 line becomes the 2023 line (DEBT.md C157).

    python3 tools/recite-csbwin.py [--write] [--review doc/C157-review.tsv]

Reads doc/CSBwin-src-20160923/ (the old reference) and doc/CSBwin-src/ (20230608), maps
each line through their diff (`git diff --no-index --histogram -w`), and rewrites in every
tracked text file:

  - `doc/CSBwin-src/File.cpp:N-M` and a bare `File.cpp:N-M`: the 2016 lines, mapped;
  - `doc/CSBwin-src-20230608/File.cpp:N`: already 2023's, the prefix shortened;
  - a continuation, `:N` with no file, after the file it cites. The file is not always
    the nearest one named: an aside (`(10, CSB.h:1545)`) does not change it. So the
    candidates are the files the paragraph names, then the file's header, then the
    whole file, those long enough for the line, and the one whose cited lines hold the
    identifiers and code quoted beside the citation wins; with no such evidence, the
    nearest. A continuation whose candidates disagree without evidence, unless it
    follows its file within a line, is listed for review.

A citation whose 2016 lines changed in 2023 is listed for review too: its fact may not
hold any more. `doc/PLAN_ARCHIVE.md` is mapped and never listed (frozen). Without
--write it only counts.
"""
import os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OLD = os.path.join(ROOT, 'doc/CSBwin-src-20160923')
NEW = os.path.join(ROOT, 'doc/CSBwin-src')
WRITE = '--write' in sys.argv
REVIEW = sys.argv[sys.argv.index('--review') + 1] if '--review' in sys.argv else None

# Bare citations of 2023 lines, written before the swap beside a mention of 20230608.
# (path, line in the unedited file, citation as written)
ALREADY_2023 = {
    ('DEBT.md', 245, 'Attack.cpp:972-980'), ('DEBT.md', 245, 'CSBCode.cpp:1785'),
    ('DEBT.md', 659, 'Chaos.cpp:2168-2171'),
    ('doc/3D2D1D.md', 50, 'SaveGame.cpp:415-416'), ('doc/3D2D1D.md', 50, ':427-430'),
    ('doc/CSBWIN_INPUT_REFERENCE.md', 9, 'CSB.h:1716-1779'),
    ('doc/CSBWIN_INPUT_REFERENCE.md', 9, 'Mouse.cpp:1374-1442'),
    ('doc/CSBWIN_INPUT_REFERENCE.md', 9, ':1510-1528'),
    ('doc/PROVEN_FACTS.md', 1672, 'Character.cpp:3587'),
    ('doc/PROVEN_FACTS.md', 1673, 'Code11f52.cpp:29-60'),
    ('doc/PROVEN_FACTS.md', 1674, 'Translation.cpp:187'),
    ('doc/PROVEN_FACTS.md', 3812, 'SaveGame.cpp:312'),
    ('doc/PROVEN_FACTS.md', 3814, 'data.cpp:240-241'),
    ('doc/PROVEN_FACTS.md', 3817, 'Chaos.cpp:2168-2171'),
    ('doc/PROVEN_FACTS.md', 3819, 'DSA.cpp:5466-5477'),
    ('src/engine/GameContext.ts', 173, 'DSA.cpp:5472'),
    ('src/engine/GameContext.ts', 174, 'SaveGame.cpp:312'),
    ('src/engine/GameContext.ts', 179, 'CSBCode.cpp:8166'),
    ('src/engine/GameContext.ts', 185, 'CSBCode.cpp:8575'),
    ('src/renderer/ui/Objects.ts', 93, 'Translation.cpp:187'),
    ('tools/dump-extended-dungeon.ts', 178, 'SaveGame.cpp:427-430'),
    ('tools/dump-hand-boxes.ts', 149, 'Character.cpp:4904-4923'),
    ('tools/dump-mouse-queue.ts', 187, 'Mouse.cpp:1374-1442'),
    ('tools/dump-mouse-queue.ts', 187, ':1510-1528'),
}

# Continuations after a 2023 citation that cite 2016 lines all the same.
OLD_AFTER_2023 = {
    ('doc/PROVEN_FACTS.md', 6584, ':3000-3020'): 'DSA.cpp',
    ('src/data/CsbwinExtendedFeatures.ts', 890, ':972-976'): 'SaveGame.cpp',
    ('src/data/CsbwinExtendedFeatures.ts', 894, ':936-939'): 'SaveGame.cpp',
    ('tools/dump-extended-dungeon.ts', 25, ':2362-2369'): 'SaveGame.cpp',
}

CSB = set(os.listdir(OLD)) | set(os.listdir(NEW))

# ---- the line map ------------------------------------------------------------------
_maps = {}
def linemap(name):
    """-> (hunks, line count of the 2016 file), or None if one tree lacks the file."""
    if name not in _maps:
        o, n = os.path.join(OLD, name), os.path.join(NEW, name)
        if not (os.path.isfile(o) and os.path.isfile(n)):
            _maps[name] = None
        else:
            out = subprocess.run(['git', 'diff', '--no-index', '--histogram', '-w', '-U0', o, n],
                                 capture_output=True, text=True, errors='replace').stdout
            hunks = [(int(m[1]), int(m[2] or 1), int(m[3]), int(m[4] or 1)) for m in
                     re.finditer(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', out, re.M)]
            _maps[name] = (hunks, sum(1 for _ in open(o, 'rb')))
    return _maps[name]

def map_line(name, ln):
    hunks, _ = linemap(name)
    delta = 0
    for os_, oc, ns, nc in hunks:
        if oc == 0:                     # lines inserted after os_
            if ln > os_:
                delta = ns + nc - 1 - os_
                continue
            break
        if ln < os_:
            break
        if nc == 0:                     # lines deleted after new line ns
            ns += 1
        if ln < os_ + oc:               # a changed line: its place in the new block
            return ns + (ln - os_ if oc == nc else min(ln - os_, max(nc - 1, 0)))
        delta = (ns + nc) - (os_ + oc)
    return ln + delta

def range_changed(name, a, b):
    for os_, oc, ns, nc in linemap(name)[0]:
        if (oc == 0 and a <= os_ < b) or (oc and os_ <= b and os_ + oc - 1 >= a):
            return True
    return False

def fits(name, b):
    return linemap(name) is not None and b <= linemap(name)[1]

# ---- evidence ----------------------------------------------------------------------
_old = {}
def old_lines(name):
    if name not in _old:
        _old[name] = open(os.path.join(OLD, name), encoding='latin1').read().split('\n')
    return _old[name]

SYMS = {}
for row in open(os.path.join(ROOT, 'doc/CSBWIN_SYMBOL_INDEX.tsv'), encoding='utf-8'):
    p = row.rstrip('\n').split('\t')
    if len(p) >= 3 and ':' in p[2]:
        f, l = p[2].rsplit(':', 1)
        SYMS.setdefault(p[0], []).append((f, int(l)))

def score(name, a, b, quotes, toks):
    """How much of what is quoted beside the citation the cited 2016 lines hold."""
    seg = '\n'.join(old_lines(name)[max(0, a - 3):b + 2])
    flat = re.sub(r'\s+', '', seg)
    sc = 0
    for q in quotes:
        q = re.sub(r'\s+', '', q)
        if len(q) >= 8 and q in flat:
            sc += 5
    for t in toks:
        sc += 5 * sum(1 for f, l in SYMS.get(t, []) if f == name and a - 2 <= l <= b + 1)
        if re.search(r'(?<![A-Za-z0-9_])' + re.escape(t) + r'(?![A-Za-z0-9_])', seg):
            sc += 2 if len(t) >= 8 else 1
    return sc

CITE = re.compile(r'[A-Za-z0-9_]+\.(?:cpp|h|rc|ts|mjs|md)(?::\d+(?:-\d+)?)?'
                  r'|(?<![A-Za-z0-9_.)\]>:/])`?:\d+(?:-\d+)?`?')
CODEWORD = re.compile(r'\b(?:[a-z]+[A-Z][A-Za-z0-9_]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9_]*'
                      r'|[A-Za-z0-9]*_[A-Za-z0-9_]+)\b')

def clause_of(lines, li, col):
    """The text between the citations around the one at (li, col), the line before included."""
    prev = (lines[li - 1] + ' ') if li > 0 else ''
    full, c = prev + lines[li], len(prev) + col
    lo = max([m.end() for m in CITE.finditer(full) if m.end() < c - 1] or [0])
    hi = min([m.start() for m in CITE.finditer(full) if m.start() > c + 1] or [len(full)])
    clause = full[lo:hi]
    quotes = [q for q in re.findall(r'`([^`]+)`', clause) if not re.fullmatch(r':?\d+(-\d+)?', q)]
    toks = {t for q in quotes for t in re.findall(r'[A-Za-z_][A-Za-z0-9_]{3,}', q)}
    toks |= set(CODEWORD.findall(clause))
    return quotes, toks

TRACKED = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True).stdout.split('\n')

def repo_path(mention):
    if os.path.isfile(os.path.join(ROOT, mention)):
        return mention
    hits = [f for f in TRACKED if f.endswith('/' + mention) or f == mention]
    return hits[0] if len(hits) == 1 else None

def noncsb_holds(noncsb, lines, li, col, a, b):
    """Whether a `:N` after a port file names a line of that file: its lines hold what is quoted."""
    if not noncsb or not noncsb[0]:
        return False
    try:
        own = open(os.path.join(ROOT, noncsb[0]), encoding='utf-8').read().split('\n')
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        return False
    if b > len(own):
        return False
    quotes, toks = clause_of(lines, li, col)
    seg = '\n'.join(own[max(0, a - 3):b + 2])
    return any(re.search(r'(?<![A-Za-z0-9_])' + re.escape(t) + r'(?![A-Za-z0-9_])', seg) for t in toks)

# ---- the rewrite -------------------------------------------------------------------
P_OLD, P_NEW = 'doc/CSBwin-src/', 'doc/CSBwin-src-20230608/'
NONCSB_EXT = {'ts', 'mts', 'mjs', 'js', 'md', 'json', 'sh', 'html', 'py', 'tsv', 'dat',
              'png', 'css', 'yml', 'yaml', 'rtc', 'img', 'hct', 'exe', 'zip', '7z'}
FILE = re.compile(r'(?<![A-Za-z0-9_\-])((?:[A-Za-z0-9_.\-]+/)*)([A-Za-z0-9_\-]+\.([A-Za-z0-9]+))'
                  r'(?::(\d+)(?:([-–])(\d+))?)?')
CONT = re.compile(r'(?<![A-Za-z0-9_.)\]>:/\'"])(:)(\d+)(?:([-–])(\d+))?(?![A-Za-z0-9_:])')
FILES_IN = re.compile(r'([A-Za-z0-9_]+\.(?:cpp|h|rc))\b')

review, counts = [], {'mapped': 0, 'already2023': 0, 'changed': 0, 'file': 0}

def cite(a, sep, b):
    return f'{a}' + (f'{sep}{b}' if b is not None else '')

def process(path, text):
    lines = text.split('\n')
    is_md, archive = path.endswith('.md'), path == 'doc/PLAN_ARCHIVE.md'
    header = [x for x in FILES_IN.findall('\n'.join(lines[:60])) if x in CSB and linemap(x)]
    whole = [x for x in FILES_IN.findall(text) if x in CSB and linemap(x)]
    ctx, para, section, out = None, [], [], []
    noncsb = None   # (repo path, line) of the last non-CSBWin file named

    def note(kind, li, now, was, extra=''):
        counts[kind] += 1
        if not archive:
            review.append((kind, f'{path}:{li + 1}', now, was, extra, lines[li].strip()[:160]))

    def mapped(name, a, sep, b, li, was):
        na, nb = map_line(name, a), (map_line(name, b) if b is not None else None)
        counts['mapped'] += 1
        now = cite(na, sep, nb)
        if range_changed(name, a, b or a):
            note('changed', li, f'{name}:{now}', was)
        return now

    def resolve(li, col, a, b, after=None):
        near = ctx or (None, 'old')
        if near[1] == 'new':
            return near[0], 'new'
        quotes, toks = clause_of(lines, li, col)
        cands, seen = [], set()
        for n in ([p[0] for p in reversed(para) if p[1] != 'new'] + ([near[0]] if near[0] else [])
                  + [p[0] for p in reversed(section) if p[1] != 'new'] + header + whole):
            if n not in seen:
                seen.add(n)
                cands.append(n)
        valid = [n for n in cands if fits(n, b)]
        if not valid:
            return None, None, None
        sc = {n: score(n, a, b, quotes, toks) for n in valid}
        base = near[0] if near[0] in valid else valid[0]
        if near[0] is None and sc and max(sc.values()) == 0:
            alt_all = [n for n in valid if (map_line(n, a), map_line(n, b)) != (map_line(base, a), map_line(base, b))]
            if alt_all:
                return base, 'old', 'no file named in its paragraph; or ' + ', '.join(f'{n}:{a}' for n in alt_all[:3])
        pick = max(valid, key=lambda n: (sc[n], n == base, -valid.index(n)))
        top = [n for n in valid if sc[n] == sc[pick]]
        if sc[pick] == 0:
            inpara = {p[0] for p in para} | ({near[0]} if near[0] else set())
            top = [n for n in top if n in inpara] or top
        res = lambda n: (map_line(n, a), map_line(n, b))
        alt = None
        if len({res(n) for n in top}) > 1:
            dist = li - next((p[2] for p in reversed(para) if p[0] == pick), -99)
            if not (sc[pick] == 0 and pick == near[0] and dist <= 1 and not pick.endswith('.h')):
                alt = 'or ' + ', '.join(f'{n}:{a}' + (f'-{b}' if b != a else '') for n in top if n != pick)
        if after and sc[pick] < 2:
            alt = (alt + '; ' if alt else '') + after
        tree = 'new' if pick != near[0] and any(p[0] == pick and p[1] == 'new' for p in para) else 'old'
        return pick, tree, alt

    for li, line in enumerate(lines):
        if (is_md and line.strip() == '') or not line.strip():
            ctx, para = None, []
        if is_md and line.startswith('#'):
            section = []
        toks = [(m.start(), m.end(), 'F', m) for m in FILE.finditer(line)]
        for m in CONT.finditer(line):
            if not any(s <= m.start() < e for s, e, _, _ in toks):
                toks.append((m.start(), m.end(), 'C', m))
        toks.sort(key=lambda t: t[0])
        res, pos = [], 0
        for s, e, kind, m in toks:
            if s < pos:
                continue
            res.append(line[pos:s])
            rep = line[s:e]
            if kind == 'F':
                d, name, ext, a, sep, b = m[1], m[2], m[3].lower(), m[4], m[5], m[6]
                if name in CSB and (d == '' or d.endswith('CSBwin-src/') or d.endswith('CSBwin-src-20230608/')):
                    was = f'{name}:{cite(a, sep, b)}' if a else None
                    tree = 'new' if d.endswith('CSBwin-src-20230608/') or (path, li + 1, was) in ALREADY_2023 else 'old'
                    ctx = (name, tree)
                    para.append((name, tree, li))
                    section.append((name, tree, li))
                    newd = P_OLD if d.endswith('CSBwin-src-20230608/') else d
                    if a is not None:
                        a, b = int(a), (int(b) if b else None)
                        if tree == 'new':
                            counts['already2023'] += 1
                            rep = f'{newd}{name}:{cite(a, sep, b)}'
                        elif linemap(name) is not None:
                            rep = f'{newd}{name}:' + mapped(name, a, sep, b, li, was)
                            lm = re.match(r'((?:,\d+(?:-\d+)?)+)', line[e:])   # Foo.cpp:12,40
                            if lm:
                                rep += ''.join(',' + '-'.join(str(map_line(name, int(v))) for v in p.split('-'))
                                               for p in lm[1].split(',')[1:])
                                e += len(lm[1])
                elif ext in NONCSB_EXT or d:
                    ctx = ('', None)
                    noncsb = (repo_path(d + name), li)
            elif ctx is None and not header and not section:
                pass
            else:
                a, sep, b = int(m[2]), m[3], (int(m[4]) if m[4] else None)
                was = f':{cite(a, sep, b)}'
                forced = OLD_AFTER_2023.get((path, li + 1, was))
                theirs = ctx is not None and not ctx[0] and noncsb_holds(noncsb, lines, li, s, a, b or a)
                if forced:
                    rep = ':' + mapped(forced, a, sep, b, li, f'{forced}:{cite(a, sep, b)}')
                elif theirs:
                    pass
                elif ctx and ctx[1] == 'new' or (path, li + 1, was) in ALREADY_2023:
                    counts['already2023'] += 1
                else:
                    kept, after = ctx, None
                    if ctx is not None and not ctx[0]:
                        ctx, after = None, f'after {noncsb[0] if noncsb else "a port file"}, named at line {noncsb[1] + 1 if noncsb else "?"}'
                    name, tree, alt = resolve(li, s, a, b or a, after)
                    ctx = kept
                    if name and tree != 'new':
                        rep = ':' + mapped(name, a, sep, b, li, f'{name}:{cite(a, sep, b)}')
                        if alt:
                            note('file', li, f'{name}{rep}', f'{name}:{cite(a, sep, b)}', alt)
                    elif tree == 'new':
                        counts['already2023'] += 1
            res.append(rep)
            pos = e
        res.append(line[pos:])
        out.append(''.join(res))
    return '\n'.join(out)

files = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True).stdout.split('\n')
skip = re.compile(r'^(static/|doc/RTC/|doc/CSBwin-src/|doc/C157-review\.tsv$|doc/CSBWIN_SYMBOL_INDEX\.tsv$|NOTES\.md$|tools/(fixtures|frames|reference)/|tools/recite-csbwin\.py$)')
touched = 0
for f in files:
    if not f or skip.match(f):
        continue
    p = os.path.join(ROOT, f)
    try:
        text = open(p, encoding='utf-8').read()
    except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
        continue
    new = process(f, text)
    if new != text:
        touched += 1
        if WRITE:
            open(p, 'w', encoding='utf-8').write(new)

print(counts, 'files', touched, 'review', len(review))
if REVIEW:
    with open(os.path.join(ROOT, REVIEW), 'w', encoding='utf-8') as fh:
        fh.write('kind\twhere\tnow\t2016\tnote\ttext\n')
        for r in review:
            fh.write('\t'.join('' if x is None else str(x).replace('\t', ' ') for x in r) + '\n')
