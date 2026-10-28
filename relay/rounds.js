// Hourpad: one coin an hour. Coins are submitted with their pump.fun launch already signed by their creator,
// against a durable nonce the creator's wallet owns, so the transaction stays valid until it is used. Anyone can
// vote (one vote per voter and per address each hour). At the top of the hour the relay broadcasts the winner's own
// signed launch; if it can't land (a copy appeared, the nonce moved), the next in line goes. Unlaunched submissions
// carry over for up to three hours; their votes start again each hour.
export const HOUR = 3600_000
const MAX_SUBS = 150, CARRY = 3

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
export function b58(bytes) { let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x); let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of bytes) { if (x) break; s = "1" + s } return s }
export function b58decode(s) {
  let n = 0n
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("b58"); n = n * 58n + BigInt(i) }
  const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0) }
  return new Uint8Array(out)
}
async function ed25519(pub, msg, sig) {
  try { const k = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]); return await crypto.subtle.verify({ name: "Ed25519" }, k, sig, msg) } catch { return false }
}
const hexOrB58 = (s) => (/^[0-9a-f]+$/i.test(s) ? Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16))) : b58decode(s))

// the parts of a serialized transaction we check: signatures, fee payer, account keys, the signed message bytes
function parseTx(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  let o = 0
  const cu16 = () => { let v = 0, s = 0; for (;;) { const b = raw[o++]; v |= (b & 0x7f) << s; if (!(b & 0x80)) return v; s += 7 } }
  const nsig = cu16(), sigs = []
  for (let i = 0; i < nsig; i++) { sigs.push(raw.slice(o, o + 64)); o += 64 }
  const msg = raw.slice(o)
  let m = 0
  const versioned = msg[0] & 0x80; if (versioned) m = 1
  m += 3                                                   // header
  let nk = 0, s2 = 0; for (;;) { const b = msg[m++]; nk |= (b & 0x7f) << s2; if (!(b & 0x80)) break; s2 += 7 }
  const keys = []; for (let i = 0; i < nk; i++) { keys.push(b58(msg.slice(m, m + 32))); m += 32 }
  const blockhash = b58(msg.slice(m, m + 32))
  return { sigs, msg, keys, blockhash, raw }
}

export function createRounds({ feed, store, rpc, sendRaw }) {
  const subs = new Map()          // id -> submission (pending ones, any round)
  const votes = new Map()         // hour -> Map(voterKey -> subId)
  const ipVotes = new Map()       // hour -> Map(ip -> subId)
  let hall = [], last = null, closing = false
  const hourNow = () => Math.floor(Date.now() / HOUR)

  const tally = (h) => { const t = new Map(); for (const id of (votes.get(h) || new Map()).values()) t.set(id, (t.get(id) || 0) + 1); return t }
  const view = (s, t) => ({ id: s.id, name: s.name, symbol: s.symbol, desc: s.desc, image: s.image, wallet: s.wallet.slice(0, 4) + "…" + s.wallet.slice(-4), at: s.at, hours: hourNow() - s.hour, votes: t?.get(s.id) || 0, buy: s.buy })

  async function submit(b) {
    const s = (x, n) => String(x || "").trim().slice(0, n)
    const name = s(b.name, 32), symbol = s(b.symbol, 10).replace(/^\$+/, "")
    if (!name || !symbol) throw new Error("name and ticker are required")
    if (subs.size >= MAX_SUBS) throw new Error("this hour is full. try the next one")
    const tx = parseTx(String(b.tx || ""))
    const wallet = tx.keys[0], mint = String(b.mint || "")
    if (!tx.keys.includes(mint)) throw new Error("the transaction doesn't create that coin")
    if (!(await ed25519(b58decode(wallet), tx.msg, tx.sigs[0]))) throw new Error("the launch isn't signed by its creator")
    for (const x of subs.values()) {
      if (x.wallet === wallet) throw new Error("this wallet already has a coin in the running")
      if (x.symbol.toLowerCase() === symbol.toLowerCase() || x.name.toLowerCase() === name.toLowerCase()) throw new Error(`$${x.symbol} is already in the running. no copies`)
    }
    const hits = feed.vamp(name, symbol)
    if (hits.length) throw new Error(`$${hits[0].symbol} launched on pump.fun ${Math.round((Date.now() - hits[0].at) / 60000)} min ago. no copies`)
    // it has to be a launch that would land right now
    const sim = await rpc("simulateTransaction", [b.tx, { encoding: "base64", sigVerify: true, replaceRecentBlockhash: false, commitment: "processed" }])
    if (sim?.value?.err) throw new Error("the signed launch wouldn't land: " + JSON.stringify(sim.value.err).slice(0, 120))
    const id = mint.slice(0, 10)
    const sub = { id, hour: hourNow(), at: Date.now(), name, symbol, desc: s(b.desc, 280), image: s(b.image, 300), uri: s(b.uri, 300), mint, wallet, tx: b.tx, buy: +b.buy || 0 }
    subs.set(id, sub)
    await save()
    return view(sub, tally(hourNow()))
  }

  async function vote({ id, voter, msg, sig, ip }) {
    const h = hourNow()
    if (!subs.has(id)) throw new Error("that coin isn't in the running")
    const m = String(msg || "").match(/^thehour:vote:([1-9A-HJ-NP-Za-km-z]{32,44}):(\d{13})$/)
    if (!m || m[1] !== voter || Math.abs(Date.now() - +m[2]) > 10 * 60_000) throw new Error("bad vote")
    if (!(await ed25519(b58decode(voter), new TextEncoder().encode(msg), hexOrB58(String(sig || ""))))) throw new Error("bad signature")
    if (!votes.has(h)) votes.set(h, new Map()); if (!ipVotes.has(h)) ipVotes.set(h, new Map())
    const v = votes.get(h), iv = ipVotes.get(h)
    // one vote per voter and per address each hour; voting again moves it
    const prevIp = ip && iv.get(ip)
    if (prevIp && prevIp.voter !== voter) throw new Error("someone on this connection already voted this hour")
    v.set(voter, id); if (ip) iv.set(ip, { voter, id })
    return { ok: true, votes: tally(h).get(id) || 0 }
  }

  // the top of the hour: broadcast the winner's own signed launch, next in line if it can't land
  async function close(h) {
    if (closing) return; closing = true
    try {
      const t = tally(h)
      const pending = [...subs.values()].sort((a, b) => (t.get(b.id) || 0) - (t.get(a.id) || 0) || a.at - b.at)
      let won = null
      for (const s of pending) {
        if (feed.vamp(s.name, s.symbol).length) { s.skip = "a copy launched this hour"; continue }
        try {
          const sig = await sendRaw(s.tx)
          won = { hour: h, at: Date.now(), id: s.id, name: s.name, symbol: s.symbol, image: s.image, mint: s.mint, wallet: s.wallet, sig, votes: t.get(s.id) || 0, entries: pending.length }
          subs.delete(s.id); feed.pinned?.add?.(s.mint)
          break
        } catch (e) { s.skip = String(e.message || e).slice(0, 80) }
      }
      for (const s of [...subs.values()]) if (h - s.hour >= CARRY - 1) subs.delete(s.id)        // three hours in the running at most
      last = won || { hour: h, at: Date.now(), none: true, entries: pending.length }
      if (won) { hall.unshift(won); if (hall.length > 200) hall.length = 200 }
      votes.delete(h); ipVotes.delete(h)
      await save()
    } finally { closing = false }
  }
  let lastHour = hourNow()
  async function tick() {
    const h = hourNow()
    if (h !== lastHour) { const done = lastHour; lastHour = h; await close(done) }
  }

  async function save() {
    await store.put("hour:subs", [...subs.values()])
    await store.put("hour:hall", hall)
    await store.put("hour:last", last)
    await store.put("hour:votes", [...votes.entries()].map(([h, m]) => [h, [...m.entries()]]))
  }
  async function restore() {
    for (const s of (await store.get("hour:subs")) || []) subs.set(s.id, s)
    hall = (await store.get("hour:hall")) || []; last = (await store.get("hour:last")) || null
    for (const [h, list] of (await store.get("hour:votes")) || []) votes.set(h, new Map(list))
    const h = hourNow()
    if (votes.size && Math.max(...votes.keys()) < h) lastHour = Math.max(...votes.keys())   // missed a close while asleep
  }

  function state() {
    const h = hourNow(), t = tally(h)
    const list = [...subs.values()].map((s) => view(s, t)).sort((a, b) => b.votes - a.votes || a.at - b.at)
    const live = (m) => { const c = feed.coins.get(m); return c ? { mc: +(c.vTok > 0 ? (c.vSol / c.vTok) * 1e9 : 0).toFixed(2), buyers: c.buyers.size, prog: c.rTok0 ? +((1 - c.rTok / c.rTok0) * 100).toFixed(1) : 0, done: c.done, peak: c.peak || 0 } : null }
    return {
      now: Date.now(), hour: h, closes: (h + 1) * HOUR, entries: list.length, votes: [...t.values()].reduce((a, b) => a + b, 0), list,
      last: last ? { ...last, live: last.mint ? live(last.mint) : null } : null,
      hall: hall.slice(0, 48).map((w) => ({ ...w, live: live(w.mint) })),
    }
  }
  const hasPending = () => subs.size > 0
  return { submit, vote, tick, close, state, save, restore, hasPending }
}
