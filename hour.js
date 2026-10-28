// The Hour: the page. Polls the relay's hour state; votes are signed by a key this browser keeps; submitting builds
// the coin's pump.fun launch (PumpPortal), rewrites it onto the creator's durable nonce, has the mint key and the
// creator's wallet sign it, and hands it to the relay, which broadcasts the winner's at the top of the hour.
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const Q = new URLSearchParams(location.search)
const RELAY = Q.get('relay') || 'https://thehour-relay.vetted-relay.workers.dev'
const get = (p, q = '') => fetch(Q.get('relay') ? `${RELAY}/v1/${p}?${q}` : `/api/r?path=${p}&${q}`, { cache: 'no-store' }).then((r) => r.json())
const post = (p, b) => fetch(`${RELAY}/v1/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())
const rpc = async (method, params) => { const r = await post('rpc', { method, params }); if (r.error) throw new Error(r.error); return r.result }
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? Math.floor(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h' }
let toastT; const toast = (m, bad) => { const t = $('toast'); t.textContent = m; t.className = 'toast on' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 4600) }
const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

// ---------------------------------------------------------------- the hour
let st = null, sol = 0, myVote = localStorage.getItem('th.vote') || ''
const mcf = (mc) => { const v = sol ? mc * sol : mc; return (sol ? '$' : '') + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0)) + (sol ? '' : ' SOL') }
async function pull() {
  try { st = await get('hour'); sol = st.sol || sol; paint() } catch { $('liveDot').className = 'off'; $('liveTxt').textContent = 'reconnecting' }
}
function paint() {
  $('liveDot').className = st.live ? '' : 'off'; $('liveTxt').textContent = st.live ? 'watching pump.fun' : 'reconnecting'
  const voteHour = localStorage.getItem('th.voteHour'); if (String(st.hour) !== voteHour) myVote = ''
  const top = st.list[0], max = Math.max(1, ...st.list.map((s) => s.votes))
  $('atTxt').textContent = `at ${hhmm(st.closes)} · ${st.entries} in the running · ${st.votes} vote${st.votes === 1 ? '' : 's'}`
  $('lead').innerHTML = top ? `<div class="lbl" style="font:500 12px 'Geist Mono';letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">leading</div><span class="tk">$${esc(top.symbol)}</span> <span class="dim">${esc(top.name)} · ${top.votes} vote${top.votes === 1 ? '' : 's'}</span>` : '<span class="dim">Nothing in the running yet. The first coin submitted this hour launches at :00 if nothing beats it.</span>'
  $('runMeta').textContent = `${st.entries} coin${st.entries === 1 ? '' : 's'} · ${st.votes} vote${st.votes === 1 ? '' : 's'} · closes ${hhmm(st.closes)}`
  $('list').innerHTML = st.list.length ? st.list.map((s, i) => `<div class="card${i === 0 ? ' first' : ''}"><span class="rk">#${i + 1}</span>
      ${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
      <div><div class="tk">$${esc(s.symbol)}</div><div class="nm">${esc(s.name)}</div>${s.desc ? `<div class="ds">${esc(s.desc)}</div>` : ''}</div>
      <div class="bar"><i style="width:${(s.votes / max) * 100}%"></i></div>
      <div class="ft"><span class="vt">${s.votes} vote${s.votes === 1 ? '' : 's'} <span class="dim">· ${s.hours ? 'hour ' + (s.hours + 1) + ' of 3' : 'new'}</span></span><button class="vote${myVote === s.id ? ' on' : ''}" data-id="${esc(s.id)}">${myVote === s.id ? 'Voted' : 'Vote'}</button></div></div>`).join('')
    : '<div class="empty">Nothing in the running yet. Submit the first coin of this hour.</div>'
  $('list').querySelectorAll('.vote').forEach((b) => (b.onclick = () => vote(b.dataset.id, b)))
  const L = st.last
  $('lastBand').innerHTML = !L ? '' : L.none ? `<div class="last" style="grid-template-columns:1fr"><div><div class="k">${hhmm(L.hour * 3600_000 + 3600_000)} · last hour</div><h3>No launch</h3><div class="dim">${L.entries ? 'No entry could land.' : 'Nothing was submitted.'}</div></div></div>`
    : `<div class="last">${L.image ? `<img src="${esc(L.image)}" alt="">` : '<span></span>'}<div><div class="k">launched at ${hhmm(L.at)} · ${L.votes} vote${L.votes === 1 ? '' : 's'} of ${L.entries} in the running</div><h3>$${esc(L.symbol)} <span class="dim" style="font-size:26px">${esc(L.name)}</span></h3><span class="ca" id="ca" title="copy">${esc(L.mint)}</span> <a class="mono dim" href="https://pump.fun/coin/${esc(L.mint)}" target="_blank" rel="noopener">open on pump.fun ↗</a></div><div class="stats">${L.live ? `<b class="up">${mcf(L.live.mc)}</b><span class="dim mono">${L.live.buyers} buyers · curve ${L.live.prog}%</span>` : '<span class="dim mono">reading the chain…</span>'}</div></div>`
  const ca = $('ca'); if (ca) ca.onclick = () => navigator.clipboard?.writeText(L.mint).then(() => toast('contract address copied'))
  $('hallList').innerHTML = st.hall.length ? st.hall.map((w) => `<a class="hrow" href="https://pump.fun/coin/${esc(w.mint)}" target="_blank" rel="noopener"><span class="mono dim">${new Date(w.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hhmm(w.at)}</span>${w.image ? `<img src="${esc(w.image)}" alt="">` : '<span></span>'}<span><span class="tk">$${esc(w.symbol)}</span> <span class="dim">${esc(w.name)}</span></span><span class="mono hm">${w.votes} votes · ${w.entries} in</span><span class="mono up">${w.live ? mcf(w.live.mc) : '—'}</span><span class="mono dim hm">${w.live ? (w.live.done ? 'graduated' : 'curve ' + w.live.prog + '%') : 'off the feed'}</span></a>`).join('') : '<div class="empty">The first hour hasn\'t closed yet.</div>'
}
setInterval(() => {
  const end = st ? st.closes : Math.ceil(Date.now() / 3600_000) * 3600_000, left = Math.max(0, end - Date.now())
  $('count').textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`
  $('count').className = 'digits mono' + (left < 60_000 ? ' soon' : '')
  if (st && Date.now() > st.closes + 3000 && Date.now() - lastPull > 2000) { lastPull = Date.now(); pull() }   // straight after :00, the winner
}, 250)
let lastPull = 0
pull(); setInterval(pull, 4000)

// ---------------------------------------------------------------- voting: a key this browser keeps, no wallet
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (bytes) => { let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of bytes) { if (x) break; s = '1' + s } return s }
async function key() {
  try { const s = JSON.parse(localStorage.getItem('th.key') || 'null'); if (s) return { priv: await crypto.subtle.importKey('jwk', s.priv, { name: 'Ed25519' }, false, ['sign']), pub: s.pub } } catch {}
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const pub = b58(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
  localStorage.setItem('th.key', JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub }))
  return { priv: kp.privateKey, pub }
}
async function vote(id, btn) {
  btn.disabled = true
  try {
    const k = await key(), msg = `thehour:vote:${k.pub}:${Date.now()}`
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, k.priv, new TextEncoder().encode(msg)))).map((x) => x.toString(16).padStart(2, '0')).join('')
    const r = await post('vote', { id, voter: k.pub, msg, sig })
    if (r.error) throw new Error(r.error)
    myVote = id; localStorage.setItem('th.vote', id); localStorage.setItem('th.voteHour', String(st.hour)); toast('vote in. it counts until :00'); pull()
  } catch (e) { toast(String(e.message || e), true) }
  btn.disabled = false
}

// ---------------------------------------------------------------- submitting: the signed launch, on a durable nonce
const sheet = $('sheet')
;[$('bSubmit'), $('bSubmit2')].forEach((b) => (b.onclick = () => sheet.classList.add('on')))
$('sheetX').onclick = () => sheet.classList.remove('on')
addEventListener('keydown', (e) => { if (e.key === 'Escape') sheet.classList.remove('on') })
const mark = (id, s, t) => { const i = $(id); i.className = s; i.textContent = s === 'ok' ? '✓' : s === 'no' ? '✕' : '○'; if (t) $(id + 't').textContent = t }
const W3 = () => import('https://esm.sh/@solana/web3.js@1.98.0?bundle')
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
let wallet = null, img = null, imgHash = ''
$('fImg').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return
  imgHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))).map((x) => x.toString(16).padStart(2, '0')).join('')
  const bmp = await createImageBitmap(f), side = Math.min(bmp.width, bmp.height), size = Math.min(1000, side)
  const cv = document.createElement('canvas'); cv.width = cv.height = size
  cv.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  img = cv.toDataURL('image/webp', 0.9); $('fPrev').src = img; $('fPrev').style.display = 'block'
}
async function confirm(sig) {
  for (let i = 0; i < 40; i++) {
    const r = await rpc('getSignatureStatuses', [[sig]]); const s = r?.value?.[0]
    if (s?.err) throw new Error('the transaction failed on-chain')
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return
    await new Promise((ok) => setTimeout(ok, 1500))
  }
  throw new Error('not confirmed in time, try again')
}
$('fGo').onclick = async () => {
  const b = $('fGo'), note = $('fNote')
  if (!wallet) {
    const p = window.phantom?.solana || window.solflare || window.backpack
    if (!p) return toast('no Solana wallet found. Install Phantom, Solflare or Backpack.', true)
    try { const r = await p.connect(); wallet = { p, pk: (r?.publicKey || p.publicKey).toString() } } catch { return toast('wallet connection cancelled', true) }
    mark('kW', 'ok', `dev wallet ${wallet.pk.slice(0, 4)}…${wallet.pk.slice(-4)}`); b.textContent = 'Sign and submit'; return
  }
  const name = $('fName').value.trim(), symbol = $('fSym').value.trim().replace(/^\$+/, '')
  if (!name || !symbol || !img) return toast('name, ticker and a picture, please', true)
  b.disabled = true
  try {
    const W = await W3(), owner = new W.PublicKey(wallet.pk)
    // 1. no copies: pump.fun's last hour, plus the image (the relay checks the running list too)
    note.textContent = 'checking for copies…'
    const v = await get('vamp', `name=${encodeURIComponent(name)}&symbol=${encodeURIComponent(symbol)}&img=${imgHash}`)
    if ((v.hits || []).length) { mark('kC', 'no', `$${v.hits[0].symbol} launched ${ago(v.hits[0].at)} ago. no copies`); throw new Error('that ticker or name is taken this hour') }
    if (v.image) { mark('kC', 'no', `that picture belongs to $${v.image.symbol}`); throw new Error('that picture is already in use') }
    mark('kC', 'ok', 'ticker, name and picture are original')
    // 2. the nonce account, at an address made from the wallet (created once, reused every hour)
    const SEED = 'thehour'
    const noncePk = await W.PublicKey.createWithSeed(owner, SEED, W.SystemProgram.programId)
    let acc = await rpc('getAccountInfo', [noncePk.toBase58(), { encoding: 'base64', commitment: 'confirmed' }])
    if (!acc?.value) {
      note.textContent = 'sign once to create your nonce account (about 0.0015 SOL rent, yours to reclaim)…'
      const rent = await rpc('getMinimumBalanceForRentExemption', [W.NONCE_ACCOUNT_LENGTH])
      const bh = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash
      const t = new W.Transaction({ feePayer: owner, recentBlockhash: bh }).add(...W.SystemProgram.createNonceAccount({ fromPubkey: owner, noncePubkey: noncePk, basePubkey: owner, seed: SEED, authorizedPubkey: owner, lamports: rent }).instructions)
      const signed = await wallet.p.signTransaction(t)
      const s = await post('send', { tx: b64(signed.serialize()) }); if (s.error) throw new Error(s.error)
      note.textContent = 'creating the nonce account…'; await confirm(s.signature)
      acc = await rpc('getAccountInfo', [noncePk.toBase58(), { encoding: 'base64', commitment: 'confirmed' }])
    }
    const nonce = W.NonceAccount.fromAccountData(unb64(acc.value.data[0])).nonce
    mark('kN', 'ok', `nonce account ${noncePk.toBase58().slice(0, 4)}…${noncePk.toBase58().slice(-4)}`)
    // 3. host the metadata, build the launch, move it onto the nonce
    note.textContent = 'building your launch…'
    const up = await post('upload', { name, symbol, description: $('fDesc').value, image: img, imgHash, twitter: $('fX').value, website: $('fWeb').value })
    if (up.error) throw new Error(up.error)
    const mint = W.Keypair.generate(), buy = Math.max(0, +$('fBuy').value || 0)
    const r = await fetch('https://pumpportal.fun/api/trade-local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicKey: wallet.pk, action: 'create', tokenMetadata: { name, symbol, uri: up.uri }, mint: mint.publicKey.toBase58(), denominatedInSol: 'true', amount: buy, slippage: 15, priorityFee: 0.0005, pool: 'pump' }) })
    if (r.status !== 200) throw new Error('could not build the launch (' + r.status + ')')
    const built = W.VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()))
    const luts = await Promise.all(built.message.addressTableLookups.map(async (l) => {
      const a = await rpc('getAccountInfo', [l.accountKey.toBase58(), { encoding: 'base64' }])
      return new W.AddressLookupTableAccount({ key: l.accountKey, state: W.AddressLookupTableAccount.deserialize(unb64(a.value.data[0])) })
    }))
    const msg = W.TransactionMessage.decompile(built.message, { addressLookupTableAccounts: luts })
    msg.instructions.unshift(W.SystemProgram.nonceAdvance({ noncePubkey: noncePk, authorizedPubkey: owner }))
    msg.recentBlockhash = nonce
    const tx = new W.VersionedTransaction(msg.compileToV0Message(luts))
    tx.sign([mint])
    // 4. the creator signs the launch now; it waits for :00
    note.textContent = 'sign your launch. it is only sent if your coin wins an hour'
    const signed = await wallet.p.signTransaction(tx)
    mark('kS', 'ok', 'launch signed')
    note.textContent = 'checking it would land…'
    const sub = await post('submit', { tx: b64(signed.serialize()), mint: mint.publicKey.toBase58(), name, symbol, desc: $('fDesc').value, image: up.image, uri: up.uri, buy })
    if (sub.error) throw new Error(sub.error)
    toast(`$${symbol} is in the running. Get people to vote before ${hhmm(st.closes)}.`); sheet.classList.remove('on'); pull()
  } catch (e) { toast(String(e.message || e).slice(0, 220), true) }
  note.textContent = 'Two signatures the first time (the nonce account, then the launch), one after that.'; b.disabled = false
}
