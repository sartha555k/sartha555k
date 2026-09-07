/**
 * Renders status.svg: a terminal-style card of real GitHub activity, in the
 * portfolio's palette. Runs daily in a GitHub Action (see profile-assets.yml).
 *
 *   GITHUB_TOKEN=... GH_USER=sartha555k node render.mjs [outDir]
 *
 * Data: GitHub GraphQL (contribution calendar, repos, languages, latest commits).
 * Output: pure SVG with fonts embedded as glyph paths, so it renders identically
 * anywhere without loading fonts. No runtime service, nothing to rate-limit.
 */
import satori from 'satori'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const USER = process.env.GH_USER || 'sartha555k'
const TOKEN = process.env.GITHUB_TOKEN
const OUT_DIR = process.argv[2] || 'dist'

const C = {
  bg: '#0a0a0b', bg2: '#111114', bg3: '#18181c', line: '#26262c',
  text: '#ededef', text2: '#9a9ba3', text3: '#85868f',
  accent: '#ff3b1f', gold: '#f5b942', ok: '#3ddc84',
}

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      nodes {
        name stargazerCount pushedAt isPrivate
        languages(first: 6, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
        defaultBranchRef { target { ... on Commit { history(first: 6) { nodes { abbreviatedOid messageHeadline committedDate } } } } }
      }
    }
  }
}`

async function fetchData() {
  if (!TOKEN) {
    console.warn('no GITHUB_TOKEN: rendering with sample data')
    return sample()
  }
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'status-card' },
    body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return shape(json.data.user)
}

function shape(u) {
  const days = u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays)
  // streak: consecutive days with contributions ending today or yesterday
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) streak++
    else if (i === days.length - 1) continue // today may not be counted yet
    else break
  }
  const last90 = days.slice(-91).map((d) => d.contributionCount)

  const langBytes = new Map()
  for (const r of u.repositories.nodes) {
    for (const e of r.languages.edges) {
      const cur = langBytes.get(e.node.name) || { size: 0, color: e.node.color || C.text3 }
      cur.size += e.size
      langBytes.set(e.node.name, cur)
    }
  }
  const total = [...langBytes.values()].reduce((a, b) => a + b.size, 0) || 1
  const languages = [...langBytes.entries()]
    .map(([name, v]) => ({ name, color: v.color, pct: (v.size / total) * 100 }))
    .filter((l) => l.pct >= 1)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6)

  const commits = u.repositories.nodes
    .filter((r) => !r.isPrivate && r.defaultBranchRef && r.name.toLowerCase() !== USER.toLowerCase())
    .flatMap((r) => r.defaultBranchRef.target.history.nodes.map((c) => ({ repo: r.name, ...c })))
    .sort((a, b) => new Date(b.committedDate) - new Date(a.committedDate))
    .slice(0, 11)

  return {
    contributions: u.contributionsCollection.contributionCalendar.totalContributions,
    commitsYear: u.contributionsCollection.totalCommitContributions,
    prs: u.contributionsCollection.totalPullRequestContributions,
    streak,
    repos: u.repositories.totalCount,
    stars: u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
    languages,
    commits,
    last90,
    lastPush: u.repositories.nodes[0]?.pushedAt,
  }
}

function sample() {
  const now = Date.now()
  return {
    contributions: 198, commitsYear: 171, prs: 9, streak: 1, repos: 24, stars: 11,
    languages: [
      { name: 'TypeScript', color: '#3178c6', pct: 46 }, { name: 'JavaScript', color: '#f1e05a', pct: 31 },
      { name: 'Python', color: '#3572A5', pct: 12 }, { name: 'CSS', color: '#663399', pct: 7 }, { name: 'HTML', color: '#e34c26', pct: 4 },
    ],
    commits: [
      { repo: 'eventbus-services', abbreviatedOid: '7d2e4b1', messageHeadline: 'record idempotency key in the same tx as the side effect', committedDate: new Date(now - 3.6e6).toISOString() },
      { repo: 'eventbus-services', abbreviatedOid: 'a91c0f3', messageHeadline: 'dlq after 3 retries with backoff', committedDate: new Date(now - 8e6).toISOString() },
      { repo: 'moviebook', abbreviatedOid: 'c58a0f2', messageHeadline: 'seat lock: SET NX PX, countdown from real TTL', committedDate: new Date(now - 9e7).toISOString() },
      { repo: 'portfolio', abbreviatedOid: '1d298f6', messageHeadline: 'prerender routes, paint before hydrate', committedDate: new Date(now - 1.7e8).toISOString() },
      { repo: 'Crack.AI', abbreviatedOid: 'f4c81e0', messageHeadline: 'prefetch next question while the answer is spoken', committedDate: new Date(now - 4e8).toISOString() },
      { repo: 'ResumeX', abbreviatedOid: 'b16f2a8', messageHeadline: 'memoise preview per section', committedDate: new Date(now - 9e8).toISOString() },
    ],
    last90: Array.from({ length: 91 }, (_, i) => (i % 7 === 3 ? 0 : Math.max(0, Math.round(Math.sin(i / 5) * 3 + 2)))),
    lastPush: new Date(now - 3.6e6).toISOString(),
  }
}

const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
const el = (type, style, children, extra = {}) => ({
  type,
  // satori requires an explicit display on any node with several children
  props: { style: Array.isArray(children) && !style.display ? { display: 'flex', ...style } : style, children, ...extra },
})
const txt = (s, style = {}) => el('div', style, s)
const mono = (s, style = {}) => txt(s, { fontFamily: 'JetBrains Mono', ...style })

function card(d) {
  const W = 1200, H = 600
  const updated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const tile = (label, value, sub, color = C.text) =>
    el('div', { display: 'flex', flexDirection: 'column', flex: 1, background: C.bg3, border: `1px solid ${C.line}`, borderRadius: 10, padding: '14px 16px' }, [
      mono(label, { fontSize: 11, letterSpacing: 2, color: C.text3, textTransform: 'uppercase' }),
      txt(String(value), { fontFamily: 'Bebas Neue', fontSize: 44, lineHeight: 1, color, marginTop: 8 }),
      mono(sub, { fontSize: 11, color: C.text3, marginTop: 4 }),
    ])

  const max = Math.max(1, ...d.last90)
  const spark = el('div', { display: 'flex', alignItems: 'flex-end', gap: 1, height: 36, flexShrink: 0 },
    d.last90.map((v) => el('div', { width: 4, height: Math.max(2, Math.round((v / max) * 36)), background: v ? (v >= max * 0.6 ? C.accent : C.gold) : C.line, borderRadius: 1 })),
  )

  const langBar = el('div', { display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', width: '100%' },
    d.languages.map((l) => el('div', { width: `${l.pct}%`, background: l.color })),
  )
  const langLegend = el('div', { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10, flexShrink: 0 },
    d.languages.map((l) => el('div', { display: 'flex', alignItems: 'center', gap: 6 }, [
      el('div', { width: 8, height: 8, borderRadius: 2, background: l.color }),
      mono(`${l.name} ${l.pct.toFixed(0)}%`, { fontSize: 11, color: C.text2 }),
    ])),
  )

  const log = el('div', { display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 },
    d.commits.map((c) => el('div', { display: 'flex', gap: 10, alignItems: 'baseline', fontFamily: 'JetBrains Mono', fontSize: 12 }, [
      txt(c.abbreviatedOid, { color: C.gold, width: 62, flexShrink: 0 }),
      txt(`${c.repo}:`, { color: C.text3, width: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }),
      txt(c.messageHeadline, { color: C.text, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
      txt(ago(c.committedDate), { color: C.text3, width: 60, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }),
    ])),
  )

  return el('div', { width: W, height: H, display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, padding: 36, border: `1px solid ${C.line}`, borderRadius: 18, fontFamily: 'JetBrains Mono' }, [
    // header
    el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
      el('div', { display: 'flex', alignItems: 'baseline', gap: 14 }, [
        txt('SARTHAK', { fontFamily: 'Bebas Neue', fontSize: 40, lineHeight: 1, color: C.accent, letterSpacing: 1 }),
        mono('$ sarthak --status', { fontSize: 13, color: C.text2 }),
      ]),
      el('div', { display: 'flex', alignItems: 'center', gap: 8 }, [
        el('div', { width: 8, height: 8, borderRadius: 4, background: C.ok }),
        mono(`last push ${d.lastPush ? ago(d.lastPush) : 'n/a'} · rendered ${updated}`, { fontSize: 11, color: C.text3 }),
      ]),
    ]),
    el('div', { height: 1, background: C.line, marginTop: 18, marginBottom: 22 }),
    // body
    el('div', { display: 'flex', gap: 28, flex: 1 }, [
      // left column
      el('div', { display: 'flex', flexDirection: 'column', width: 500, gap: 14 }, [
        el('div', { display: 'flex', gap: 10 }, [
          tile('contributions', d.contributions, 'last 12 months'),
          tile('streak', `${d.streak}d`, 'current', d.streak > 6 ? C.gold : C.text),
        ]),
        el('div', { display: 'flex', gap: 10 }, [
          tile('commits', d.commitsYear, 'last 12 months'),
          tile('repos', d.repos, `${d.stars} stars`),
        ]),
        el('div', { display: 'flex', flexDirection: 'column', background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 16px', flex: 1 }, [
          mono('last 90 days', { fontSize: 11, letterSpacing: 2, color: C.text3, textTransform: 'uppercase', flexShrink: 0 }),
          el('div', { marginTop: 10, height: 36, flexShrink: 0 }, [spark]),
          mono('languages by bytes, own repos', { fontSize: 11, letterSpacing: 2, color: C.text3, textTransform: 'uppercase', marginTop: 18, flexShrink: 0 }),
          el('div', { marginTop: 8, height: 8, flexShrink: 0 }, [langBar]),
          langLegend,
        ]),
      ]),
      // right column
      el('div', { display: 'flex', flexDirection: 'column', flex: 1, background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 10, padding: '14px 18px' }, [
        el('div', { display: 'flex', alignItems: 'center', gap: 6 }, [
          el('div', { width: 8, height: 8, borderRadius: 4, background: C.line }),
          el('div', { width: 8, height: 8, borderRadius: 4, background: C.line }),
          el('div', { width: 8, height: 8, borderRadius: 4, background: C.line }),
          mono('git log --oneline --all --author=sarthak', { fontSize: 11, color: C.text3, marginLeft: 8 }),
        ]),
        log,
        el('div', { flex: 1 }),
        mono('building things nobody asked for. yet.', { fontSize: 12, color: C.text3 }),
      ]),
    ]),
  ])
}

async function main() {
  const font = (p) => readFile(require.resolve(p))
  const fonts = [
    { name: 'Bebas Neue', data: await font('@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'JetBrains Mono', data: await font('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'), weight: 400, style: 'normal' },
  ]
  const data = await fetchData()
  const svg = await satori(card(data), { width: 1200, height: 600, fonts })
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, 'status.svg'), svg)
  console.log(`wrote ${OUT_DIR}/status.svg (${(svg.length / 1024).toFixed(0)} kB)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
