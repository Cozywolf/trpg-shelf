'use strict';
(() => {
const $ = s => document.querySelector(s);
const KINDS = ["官方出版","同人","自印","PDF列印","其他"];
const SYSTEMS = ["CoC 7版","CoC 6版","D&D 5e","D&D 2024","Pathfinder 2e","SW2.5 劍世界","忍神","Emoklore","Insane 瘋狂","Double Cross 3rd","Fabula Ultima","Blades in the Dark","Vampire V5","通用／無系統"];
const COLORS = ["#3E4A89","#6B3E7A","#2F6B5E","#8A4B2E","#2E5A87","#7A2F3F","#4E5D2F","#5A4636"];
const FIELDS = ["title","titleAlt","system","lang","author","publisher","isbn","pubdate","edition","code","shelf","where","note"];
const K = { books:"ts.books", out:"ts.outbox", cfg:"ts.cfg", sort:"ts.sort", last:"ts.lastSync" };

/* ---------- storage ---------- */
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const S = {
  books: load(K.books, []), out: load(K.out, { up:{}, del:[] }), cfg: load(K.cfg, { url:"", token:"" }),
  q:"", sys:"", kind:"", tag:"", sort: load(K.sort, "recent"), check:null,
  syncing:false, again:false, lastSync: load(K.last, 0), syncErr:"",
};
function persist(){
  if (!store(K.books, S.books) || !store(K.out, S.out)) toast("手機儲存空間不足，請先同步或移除部分封面照片。", 4000);
}

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg, ms=2600){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, ms); }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
function hash(s){ let h=0; for (const c of String(s)) h=(h*31+c.codePointAt(0))|0; return Math.abs(h); }
const ALIAS = [
  [/克蘇魯|克苏鲁|クトゥルフ|くとぅるふ|cthulhu|coc/g, "coc"],
  [/龍與地下城|龙与地下城|ダンジョンズ&ドラゴンズ|dungeons&dragons|dungeonsanddragons|d&d|dnd/g, "dnd"],
  [/劍世界|剑世界|ソードワールド|swordworld/g, "sw"],
  [/忍神|シノビガミ|shinobigami/g, "shinobigami"],
  [/劇本|剧本|模組|模组|シナリオ|scenario|module/g, "劇本"],
  [/規則書|规则书|ルールブック|rulebook/g, "規則書"],
];
function norm(s){
  let x = String(s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\-_・·.,:：、，。（）()\[\]「」『』【】《》〈〉!！?？'"~～\/]/g, "");
  for (const [re, to] of ALIAS) x = x.replace(re, to);
  return x;
}
function isbn13Valid(s){ if(!/^97[89]\d{10}$/.test(s)) return false; let sum=0; for(let i=0;i<12;i++) sum+=(+s[i])*(i%2?3:1); return (10-sum%10)%10 === +s[12]; }
function isbn10to13(s){
  s=s.toUpperCase(); if(!/^\d{9}[\dX]$/.test(s)) return "";
  let c=0; for(let i=0;i<10;i++) c += (s[i]==="X"?10:+s[i])*(10-i); if (c%11) return "";
  const b="978"+s.slice(0,9); let sum=0; for(let i=0;i<12;i++) sum+=(+b[i])*(i%2?3:1); return b+((10-sum%10)%10);
}
function toIsbn(raw){
  const str = String(raw ?? ""); const d = str.replace(/[^0-9Xx]/g, "");
  if (isbn13Valid(d)) return d;
  if (d.length===10){ const t = isbn10to13(d); if (t) return t; }
  const m = str.match(/97[89][\d\- ]{10,17}/); if (m){ const x=m[0].replace(/[\- ]/g,"").slice(0,13); if (isbn13Valid(x)) return x; }
  return "";
}
function haystack(b){ return norm([b.title,b.titleAlt,b.system,b.author,b.publisher,b.edition,b.lang,b.kind,b.where,b.note,(b.tags||[]).join(" "),b.isbn,b.code,b.shelf].join("|")); }
const coverOf = b => b.coverData || b.coverUrl || "";
const shelfStr = n => n ? "#" + String(n).padStart(4,"0") : "";
const nextShelf = () => S.books.reduce((m,b)=>Math.max(m, +b.shelf||0), 0) + 1;
function counts(key){ const m=new Map(); for(const b of S.books){ const vs = key==="tags" ? (b.tags||[]) : [b[key]]; for(const v of vs) if(v) m.set(v,(m.get(v)||0)+1);} return [...m].sort((a,b)=>b[1]-a[1]); }
function findByCode(isbn, code){ return S.books.filter(b => (isbn && b.isbn===isbn) || (code && b.code && norm(b.code)===norm(code))); }
function guessSystem(t, publisher="", pubdate=""){
  const s = String(t||""), pub = String(publisher||""), y = parseInt(String(pubdate).slice(0,4),10) || 0;
  if (/クトゥルフ|克蘇魯|克苏鲁|Cthulhu/i.test(s)) return /6版|第6版|6th/i.test(s) || (y && y < 2014) ? "CoC 6版" : "CoC 7版";
  if (/ダンジョンズ|Dungeons|D&D|龍與地下城/i.test(s) || /Wizards of the Coast/i.test(pub)) return y >= 2024 ? "D&D 2024" : y >= 2014 || !y ? "D&D 5e" : "D&D";
  if (/ソード・?ワールド|劍世界|Sword ?World/i.test(s)) return /2\.0/.test(s) ? "SW2.0 劍世界" : "SW2.5 劍世界";
  if (/シノビガミ|忍神/.test(s)) return "忍神";
  if (/Pathfinder|パスファインダー/i.test(s) || /Paizo/i.test(pub)) return y && y < 2019 ? "Pathfinder 1e" : "Pathfinder 2e";
  if (/Starfinder/i.test(s)) return "Starfinder";
  if (/エモクロア|Emoklore/i.test(s)) return "Emoklore";
  if (/インセイン|Insane/i.test(s)) return "Insane 瘋狂";
  if (/ダブルクロス|Double ?Cross/i.test(s)) return "Double Cross 3rd";
  if (/Blades in the Dark/i.test(s)) return "Blades in the Dark";
  if (/Vampire/i.test(s)) return "Vampire V5";
  if (/Fabula Ultima/i.test(s)) return "Fabula Ultima";
  return "";
}

function coverHTML(b){
  const c = COLORS[hash(b.system || b.title) % COLORS.length];
  const ph = `<div class="ph" style="background:linear-gradient(160deg,${c},color-mix(in srgb,${c} 70%,#000))"><span class="sys">${esc(b.system || b.kind || "TRPG")}</span><span class="t">${esc(b.title || "未命名")}</span></div>`;
  const src = coverOf(b);
  return `<div class="cv">${ph}${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</div>`;
}
document.addEventListener("error", e => { if (e.target.tagName==="IMG" && e.target.closest?.(".cv,.lk")) e.target.remove(); }, true);

function cardHTML(b, sample=false){
  const tags = (b.tags||[]).slice(0,3).map(t=>`<span>#${esc(t)}</span>`).join("");
  const pend = !sample && S.out.up[b.id];
  return `<button class="card" ${sample?'tabindex="-1" aria-hidden="true"':`data-id="${esc(b.id)}"`}>${coverHTML(b)}
    ${sample?'<span class="flag sample">範例</span>':(b.needsReview?'<span class="flag">待確認</span>':"")}
    ${pend && S.cfg.url ? '<span class="flag pend">未同步</span>' : ""}
    <div class="meta"><div class="title">${esc(b.title||"未命名")}</div>
    <div class="line">${b.kind?`<span class="badge k-${esc(b.kind)}">${esc(b.kind)}</span>`:""}${b.system?`<span>${esc(b.system)}</span>`:""}</div>
    <div class="line"><span class="shelfno">${shelfStr(b.shelf)}</span>${b.publisher?`<span>${esc(b.publisher)}</span>`:""}</div>
    ${tags?`<div class="tags">${tags}</div>`:""}</div></button>`;
}

/* ---------- render ---------- */
function filtered(){
  if (S.check) return S.check.matches;
  let list = S.books;
  const terms = S.q.trim().split(/\s+/).map(norm).filter(Boolean);
  const qIsbn = toIsbn(S.q);
  if (terms.length) list = list.filter(b => (qIsbn && b.isbn===qIsbn) || terms.every(t=>haystack(b).includes(t)));
  if (S.sys) list = list.filter(b => (b.system||"") === S.sys);
  if (S.kind) list = list.filter(b => (b.kind||"") === S.kind);
  if (S.tag) list = list.filter(b => (b.tags||[]).includes(S.tag));
  const cmp = (a,b)=>String(a||"").localeCompare(String(b||""),"zh-Hant");
  const by = {
    recent:(a,b)=>(b.createdAt||0)-(a.createdAt||0),
    shelf:(a,b)=>(+a.shelf||1e9)-(+b.shelf||1e9),
    title:(a,b)=>cmp(a.title,b.title),
    system:(a,b)=>cmp(a.system||"~",b.system||"~")||cmp(a.title,b.title),
  }[S.sort] || (()=>0);
  return [...list].sort(by);
}
function fillSelect(el, label, values, cur){
  el.innerHTML = `<option value="">${label}</option>` + values.map(v=>`<option ${v===cur?"selected":""} value="${esc(v)}">${esc(v)}</option>`).join("");
  el.classList.toggle("on", !!cur);
}
function render(){
  $("#count").textContent = `${S.books.length} 冊`;
  const sysC = counts("system"), kindC = counts("kind"), tagC = counts("tags");
  fillSelect($("#fSys"), "全部系統", sysC.map(x=>x[0]), S.sys);
  fillSelect($("#fKind"), "全部類型", kindC.map(x=>x[0]), S.kind);
  fillSelect($("#fTag"), "全部標籤", tagC.map(x=>x[0]), S.tag);
  $("#sort").value = S.sort;
  $("#sysList").innerHTML = [...new Set([...sysC.map(x=>x[0]), ...SYSTEMS])].map(v=>`<option value="${esc(v)}">`).join("");
  $("#qclear").hidden = !S.q;
  renderSync();

  $("#setupNote").innerHTML = S.cfg.url ? "" :
    `<div class="note"><span>尚未連接 Google 試算表，資料目前只存在這支手機上。</span><button class="btn small" data-act="settings">設定同步</button></div>`;

  const bn = $("#banner"), c = S.check;
  if (!c) bn.innerHTML = "";
  else {
    const id = c.isbn ? `ISBN <span class="mono">${esc(c.isbn)}</span>` : `<span class="mono">${esc(c.code)}</span>`;
    const lk = c.lookup?.title ? `<div class="lk">${c.lookup.coverUrl?`<img src="${esc(c.lookup.coverUrl)}" alt="" referrerpolicy="no-referrer">`:""}<div><b>${esc(c.lookup.title)}</b><br>${esc([c.lookup.author,c.lookup.publisher].filter(Boolean).join("・"))}</div></div>`
      : c.looking ? `<div class="lk"><span class="spin"></span> 查詢書籍資料中…</div>` : "";
    bn.innerHTML = c.matches.length
      ? `<div class="banner owned"><div class="grow"><div class="big">已收藏${c.matches.length>1?` ${c.matches.length} 本`:""} ✓</div><div class="sub">${id}</div></div><div class="acts"><button class="btn small" data-act="clearcheck">關閉</button></div></div>`
      : `<div class="banner new"><div class="grow"><div class="big">還沒有這本</div><div class="sub">${id}</div>${lk}</div><div class="acts"><button class="btn small primary" data-act="addfromcheck">新增這本</button><button class="btn small" data-act="clearcheck">關閉</button></div></div>`;
  }

  const rev = S.books.filter(b=>b.needsReview).length;
  $("#stats").innerHTML = (S.books.length && !S.check) ? sysC.slice(0,6).map(([k,n])=>`<span>${esc(k)}<b>${n}</b></span>`).join("") + (rev?`<span>待確認<b>${rev}</b></span>`:"") : "";

  const list = $("#list");
  if (!S.books.length) {
    const ex = [
      {title:"克蘇魯神話TRPG 規則書", system:"CoC 7版", kind:"官方出版", publisher:"Chaosium", shelf:1, tags:["規則書"]},
      {title:"霧之港的最後一夜", system:"CoC 7版", kind:"同人", publisher:"某某社團", shelf:2, tags:["短篇","CWT"]},
      {title:"龍巢下的五個房間", system:"D&D 5e", kind:"自印", publisher:"自家團", shelf:3, tags:["1-3級"]},
    ];
    list.innerHTML = `<div class="empty"><h2>開始建立你的收藏</h2>
      <p>有 ISBN 的書按「掃描新增」對準條碼，會自動查詢書名、作者、出版社和封面。同人本或自印劇本用「手動新增」，可以拍封面存檔。</p>
      <p>在書店時，在上方搜尋框打兩三個字，或按「查重」掃條碼，就能確認有沒有買過。沒有網路也能查。</p>
      <div class="grid">${ex.map(b=>cardHTML(b,true)).join("")}</div></div>`;
    return;
  }
  const rows = filtered();
  list.innerHTML = rows.length ? `<div class="grid">${rows.map(b=>cardHTML(b)).join("")}</div>`
    : (S.check ? "" : `<div class="none">找不到符合的書。${S.q?`<br><button class="btn small" style="margin-top:10px" data-act="addfromq">以「${esc(S.q)}」新增</button>`:""}</div>`);
}
function pendingCount(){ return Object.keys(S.out.up).length + S.out.del.length; }
function renderSync(){
  const el = $("#syncBtn"), p = pendingCount();
  let cls="", txt;
  if (!S.cfg.url) txt = "僅本機";
  else if (S.syncing) { cls="busy"; txt="同步中"; }
  else if (S.syncErr) { cls="err"; txt="同步失敗"; }
  else if (!navigator.onLine) { cls="err"; txt = p ? `離線・${p} 筆待同步` : "離線"; }
  else if (p) { cls="busy"; txt=`${p} 筆待同步`; }
  else { cls="live"; txt="已同步"; }
  el.className = "sync " + cls; el.querySelector("span").textContent = txt;
  const info = $("#syncInfo");
  if (info) info.textContent = !S.cfg.url ? "尚未設定。" :
    `上次同步：${S.lastSync ? new Date(S.lastSync).toLocaleString("zh-TW") : "尚未同步"}。待同步：${p} 筆。${S.syncErr ? "錯誤：" + S.syncErr : ""}`;
}

/* ---------- sync with Google Sheets (Apps Script) ---------- */
async function api(body){
  const res = await fetch(S.cfg.url, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, token:S.cfg.token }), redirect:"follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  let j; try { j = await res.json(); } catch { throw new Error("回應格式不對，請確認網址結尾是 /exec，且部署的存取權是「所有人」"); }
  if (!j.ok) throw new Error(j.error || "伺服器錯誤");
  return j;
}
function toServer(b){ const o = { ...b }; delete o.coverData; return o; }
function fromServer(b){
  return { ...b, id:String(b.id), shelf: parseInt(b.shelf,10) || "",
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags||"").split(/[、;；,，]/).map(s=>s.trim()).filter(Boolean),
    needsReview: b.needsReview===true || String(b.needsReview).toUpperCase()==="TRUE",
    createdAt: +b.createdAt || 0, updatedAt: +b.updatedAt || 0,
    isbn: String(b.isbn||""), pubdate: String(b.pubdate||""), edition: String(b.edition||""), code: String(b.code||"") };
}
let syncTimer = 0;
function scheduleSync(ms=1500){ clearTimeout(syncTimer); syncTimer = setTimeout(()=>sync(), ms); }
async function sync(manual=false){
  if (!S.cfg.url) { if (manual) openSettings(); return; }
  if (S.syncing) { S.again = true; return; }
  if (!navigator.onLine) { renderSync(); if (manual) toast("目前離線，恢復網路後會自動同步。"); return; }
  S.syncing = true; S.syncErr = ""; renderSync();
  try {
    for (const b of Object.values(S.out.up)) {
      if (!b.coverData) continue;
      const r = await api({ action:"upload", name:(b.title||b.id).slice(0,60), data:b.coverData.split(",")[1] });
      b.coverUrl = r.url; delete b.coverData;
      const lb = S.books.find(x=>x.id===b.id); if (lb) { lb.coverUrl = r.url; delete lb.coverData; }
      persist();
    }
    const up = Object.values(S.out.up).map(toServer), del = [...S.out.del];
    const r = await api({ action:"sync", upserts:up, deletes:del });
    for (const b of up) { const cur = S.out.up[b.id]; if (cur && cur.updatedAt === b.updatedAt && !cur.coverData) delete S.out.up[b.id]; }
    S.out.del = S.out.del.filter(id => !del.includes(id));
    const map = new Map((r.books||[]).map(fromServer).map(b=>[b.id,b]));
    for (const p of Object.values(S.out.up)) map.set(p.id, p);
    for (const id of S.out.del) map.delete(id);
    S.books = [...map.values()];
    S.lastSync = Date.now(); store(K.last, S.lastSync);
    persist();
    if (manual) toast("同步完成");
  } catch (e) {
    S.syncErr = e.message || "無法連線";
    if (manual) toast("同步失敗：" + S.syncErr, 4000);
  } finally {
    S.syncing = false; render();
    if (S.again) { S.again = false; scheduleSync(300); }
  }
}
function putBook(b, quiet){
  b.updatedAt = Date.now();
  const i = S.books.findIndex(x=>x.id===b.id);
  if (i>=0) S.books[i] = b; else S.books.push(b);
  S.out.up[b.id] = b;
  if (!quiet) { persist(); render(); scheduleSync(); }
}
function removeBook(id){
  S.books = S.books.filter(b=>b.id!==id);
  delete S.out.up[id]; S.out.del.push(id);
  persist(); render(); scheduleSync();
}
window.addEventListener("online", () => { render(); scheduleSync(200); });
window.addEventListener("offline", renderSync);
document.addEventListener("visibilitychange", () => { if (document.visibilityState==="visible" && S.cfg.url && Date.now()-S.lastSync > 60000) scheduleSync(200); });

/* ---------- ISBN lookup ---------- */
const LANG = { ja:"日文", "zh-TW":"繁中", "zh-Hant":"繁中", "zh-HK":"繁中", "zh-CN":"簡中", "zh-Hans":"簡中", zh:"中文", en:"英文", eng:"英文", ko:"韓文", jpn:"日文", chi:"中文" };
function timeout(p, ms){ return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")), ms))]); }
async function getJSON(url){ const r = await timeout(fetch(url), 9000); if (!r.ok) throw new Error(r.status); return r.json(); }
const nfkc = v => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
function cleanJpAuthor(a){
  return nfkc(a).replace(/,\s+/g, ",").split(" ").map(p => {
    p = p.replace(/,\d{4}-(\d{4})?$/, "").replace(/[／/]?(著|編|編著|監修|訳|翻訳|イラスト|原作)$/, "");
    const parts = p.split(",");
    if (parts.length === 2) return /[\u3040-\u30ff\u4e00-\u9fff]/.test(p) ? parts.join("") : `${parts[1]} ${parts[0]}`;
    return p;
  }).filter(Boolean).join("、");
}
// 日本書：openBD（資料來自國立國會圖書館，目前不提供封面）
async function fromOpenBD(isbn){
  const j = await getJSON("https://api.openbd.jp/v1/get?isbn=" + isbn);
  const s = j?.[0]?.summary; if (!s?.title) return null;
  const d = String(s.pubdate||"").replace(/^(\d{4})(\d{2})?(\d{2})?$/, (m,y,mo,da)=>[y,mo,da].filter(Boolean).join("-"));
  return { src:"openBD", title: nfkc(s.title), author: cleanJpAuthor(s.author), publisher: nfkc(s.publisher),
    pubdate: d, lang:"日文", note: s.series ? "系列：" + nfkc(s.series) : "", coverUrl: s.cover || "" };
}
async function fromGoogle(isbn){
  const j = await getJSON("https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn);
  const v = j?.items?.[0]?.volumeInfo; if (!v?.title) return null;
  const img = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace(/^http:/, "https:").replace("&edge=curl", "");
  return { src:"Google Books", title: nfkc(v.title + (v.subtitle ? ": " + v.subtitle : "")), author: (v.authors||[]).map(nfkc).join("、"),
    publisher: nfkc(v.publisher), pubdate: v.publishedDate || "", lang: LANG[v.language] || "", coverUrl: img };
}
async function fromOpenLibrary(isbn){
  const j = await getJSON(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const d = j?.["ISBN:"+isbn]; if (!d?.title) return null;
  return { src:"Open Library", title: nfkc(d.title + (d.subtitle ? ": " + d.subtitle : "")), author: (d.authors||[]).map(a=>nfkc(a.name)).join("、"),
    publisher: nfkc(d.publishers?.[0]?.name), pubdate: d.publish_date || "", coverUrl: d.cover?.medium || d.cover?.large || "" };
}
function probeImage(url, ms=5000){
  return new Promise(res => { const i = new Image(); const t = setTimeout(()=>res(false), ms);
    i.onload = () => { clearTimeout(t); res(i.naturalWidth > 1); }; i.onerror = () => { clearTimeout(t); res(false); };
    i.referrerPolicy = "no-referrer"; i.src = url; });
}
const lookCache = new Map();
async function lookupIsbn(isbn){
  if (lookCache.has(isbn)) return lookCache.get(isbn);
  const jp = /^97[89]4/.test(isbn);
  // 日本書：openBD 資料最完整，Google Books 補封面；美國等其他書：Google Books 與 Open Library
  const srcs = jp ? [fromOpenBD, fromGoogle, fromOpenLibrary] : [fromGoogle, fromOpenLibrary];
  const results = await Promise.allSettled(srcs.map(f => f(isbn)));
  const out = { sources:[] }; let failed = 0;
  results.forEach(r => {
    if (r.status === "rejected") { failed++; return; }
    if (!r.value) return;
    out.sources.push(r.value.src);
    for (const k in r.value) if (k!=="src" && r.value[k] && !out[k]) out[k] = r.value[k];
  });
  if (out.title && !out.coverUrl) {
    const ol = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    if (await probeImage(ol)) out.coverUrl = ol;
  }
  if (out.pubdate && !/^\d{4}(-\d{2}){0,2}$/.test(out.pubdate)) { const d = new Date(out.pubdate); if (!isNaN(d)) out.pubdate = /^\d{4}$/.test(out.pubdate.trim()) ? out.pubdate.trim() : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` + (/\d{1,2},/.test(out.pubdate) ? "-" + String(d.getDate()).padStart(2,"0") : ""); }
  if (out.title && !out.system) out.system = guessSystem(out.title + " " + (out.note||""), out.publisher, out.pubdate);
  if (out.title && !out.lang) out.lang = jp ? "日文" : /^97[89][01]/.test(isbn) ? "英文" : "";
  out.failed = failed === srcs.length;
  if (out.title) lookCache.set(isbn, out);
  return out;
}

/* ---------- scanner ---------- */
const SC = { stream:null, mode:"add", timer:0, detector:null, torch:false, reader:null, canvas:null };
async function openScanner(mode){
  SC.mode = mode;
  $("#scanTitle").textContent = mode==="check" ? "掃條碼查重" : "掃條碼新增";
  $("#scanMsg").textContent = "把書背的 ISBN 條碼或 QR code 放進框內";
  $("#scanManual").value = ""; $("#torchBtn").hidden = true; $("#torchBtn").classList.remove("on"); SC.torch=false;
  if (!$("#scan").open) $("#scan").showModal();
  history.pushState({ scan:1 }, "");
  if (!navigator.mediaDevices?.getUserMedia) { $("#scanMsg").textContent = "這個瀏覽器無法使用相機，請直接輸入 ISBN。"; return; }
  try {
    SC.stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:"environment" }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
    if (!$("#scan").open) { stopStream(); return; }
    const v = $("#video"); v.srcObject = SC.stream; await v.play();
    const track = SC.stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    $("#torchBtn").hidden = !caps.torch;
    if (caps.focusMode?.includes?.("continuous")) track.applyConstraints({ advanced:[{ focusMode:"continuous" }] }).catch(()=>{});
    if (!SC.detector && "BarcodeDetector" in window) {
      try {
        const fm = await BarcodeDetector.getSupportedFormats();
        const want = ["ean_13","ean_8","upc_a","qr_code","code_128"].filter(f=>fm.includes(f));
        if (want.includes("ean_13")) SC.detector = new BarcodeDetector({ formats:want });
      } catch {}
    }
    tick();
  } catch (e) {
    $("#scanMsg").textContent = (e.name==="NotAllowedError" ? "沒有相機權限。請在瀏覽器設定中允許使用相機，" : "無法開啟相機，") + "或直接輸入 ISBN。";
  }
}
function stopStream(){ clearTimeout(SC.timer); SC.stream?.getTracks().forEach(t=>t.stop()); SC.stream=null; $("#video").srcObject=null; }
function closeScanner(fromPop){
  if (!$("#scan").open) return;
  stopStream(); $("#scan").close();
  if (!fromPop && history.state?.scan) history.back();
}
window.addEventListener("popstate", () => closeScanner(true));
$("#scan").addEventListener("cancel", e => { e.preventDefault(); closeScanner(); });
function zxFrame(v){
  const Z = window.ZXing; if (!Z) return null;
  if (!SC.reader) {
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_128]);
    SC.reader = new Z.MultiFormatReader(); SC.reader.setHints(hints);
    SC.canvas = document.createElement("canvas");
  }
  const W = v.videoWidth, H = v.videoHeight; if (!W || !H) return null;
  const sw = W*0.9, sh = H*0.6, k = Math.min(1, 1000/sw);
  const cv = SC.canvas; cv.width = Math.round(sw*k); cv.height = Math.round(sh*k);
  const ctx = cv.getContext("2d", { willReadFrequently:true });
  ctx.drawImage(v, (W-sw)/2, (H-sh)/2, sw, sh, 0, 0, cv.width, cv.height);
  try {
    const r = SC.reader.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv))));
    return { text:r.getText(), qr: r.getBarcodeFormat()===Z.BarcodeFormat.QR_CODE };
  } catch { return null; }
}
async function tick(){
  if (!SC.stream) return;
  const v = $("#video");
  if (v.readyState >= 2) {
    let hits = [];
    if (SC.detector) { try { hits = (await SC.detector.detect(v)).map(x=>({ text:x.rawValue, qr:x.format==="qr_code" })); } catch {} }
    else { const h = zxFrame(v); if (h) hits = [h]; }
    for (const h of hits) {
      const isbn = toIsbn(h.text);
      if (isbn && (h.qr || /^97[89]\d{10}$/.test(h.text))) return found({ isbn, code:"" });
      if (h.qr && h.text.trim()) return found({ isbn:"", code:h.text.trim() });
    }
  }
  SC.timer = setTimeout(tick, SC.detector ? 150 : 250);
}
function found(r){
  navigator.vibrate?.(60);
  const mode = SC.mode; closeScanner();
  if (mode === "check") doCheck(r);
  else if (mode === "editor") applyCode(r);
  else addFromScan(r);
}
async function addFromScan(r){
  const same = r.isbn ? S.books.filter(b => b.isbn === r.isbn) : [];
  if (same.length) {
    const a = await askDup("isbn", same, r.isbn);
    if (a.view) openEditor(a.view);
    return;
  }
  const sameCode = r.code ? S.books.filter(b => b.code && norm(b.code) === norm(r.code)) : [];
  if (sameCode.length) {
    const a = await askDup("code", sameCode, r.code);
    if (a.view) { openEditor(a.view); return; }
    if (a.choice !== "continue") return;
  }
  openEditor(null, { isbn:r.isbn, code:r.code }); if (r.isbn) runLookup();
}
$("#scanClose").onclick = () => closeScanner();
$("#torchBtn").onclick = async () => {
  const t = SC.stream?.getVideoTracks()[0]; if (!t) return;
  SC.torch = !SC.torch;
  try { await t.applyConstraints({ advanced:[{ torch:SC.torch }] }); $("#torchBtn").classList.toggle("on", SC.torch); } catch { SC.torch=false; }
};
$("#scanManualForm").addEventListener("submit", e => {
  e.preventDefault(); const v = $("#scanManual").value.trim(); if (!v) return;
  const isbn = toIsbn(v);
  if (!isbn && /^[\d\-\sXx]{9,17}$/.test(v)) { $("#scanMsg").textContent = "這組號碼不是有效的 ISBN，請再確認一次。"; return; }
  found(isbn ? { isbn, code:"" } : { isbn:"", code:v });
});

async function doCheck(r){
  S.check = { ...r, matches: findByCode(r.isbn, r.code) };
  S.q = ""; $("#q").value = ""; render(); window.scrollTo({ top:0 });
  if (!S.check.matches.length && r.isbn && navigator.onLine) {
    S.check.looking = true; render();
    const c = S.check, lk = await lookupIsbn(r.isbn);
    if (S.check !== c) return;
    c.looking = false; c.lookup = lk; render();
  }
}

/* ---------- search / filters / clicks ---------- */
$("#q").addEventListener("input", e => { S.q = e.target.value; S.check = null; render(); });
$("#qclear").addEventListener("click", () => { S.q=""; $("#q").value=""; render(); $("#q").focus(); });
$("#fSys").addEventListener("change", e => { S.sys=e.target.value; render(); });
$("#fKind").addEventListener("change", e => { S.kind=e.target.value; render(); });
$("#fTag").addEventListener("change", e => { S.tag=e.target.value; render(); });
$("#sort").addEventListener("change", e => { S.sort=e.target.value; store(K.sort, S.sort); render(); });
$("#checkBtn").onclick = () => openScanner("check");
$("#scanAddBtn").onclick = () => openScanner("add");
$("#addManual").onclick = () => openEditor(null);
$("#syncBtn").onclick = () => sync(true);
$("#setBtn").onclick = () => openSettings();
document.addEventListener("click", e => {
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act==="clearcheck") { S.check=null; render(); }
    else if (act==="settings") openSettings();
    else if (act==="addfromcheck") { const c=S.check; S.check=null; render(); openEditor(null, { isbn:c.isbn, code:c.code, ...(c.lookup?.title ? pickLookup(c.lookup) : {}) }, !!c.lookup?.title); if (c.isbn && !c.lookup?.title) runLookup(); }
    else if (act==="addfromq") openEditor(null, toIsbn(S.q) ? { isbn: toIsbn(S.q) } : { title: S.q });
    return;
  }
  const card = e.target.closest(".card[data-id]");
  if (card) { const b = S.books.find(x=>x.id===card.dataset.id); if (b) openEditor(b); }
});
function pickLookup(lk){ const o={}; for (const k of ["title","titleAlt","author","publisher","pubdate","lang","system","note","coverUrl"]) if (lk[k]) o[k]=lk[k]; o.kind="官方出版"; return o; }

/* ---------- editor ---------- */
const ed = $("#ed");
let E = null;
$("#e_kind").innerHTML = KINDS.map(k=>`<label><input type="radio" name="kind" value="${k}"><span>${k}</span></label>`).join("");

function openEditor(book, preset={}, markAuto=false){
  E = { id: book?.id || null, orig: book || null, tags:[...(book?.tags||[])], coverUrl: book?.coverUrl || preset.coverUrl || "", coverData: book?.coverData || "" };
  $("#edTitle").textContent = book ? "編輯書籍" : "新增書籍";
  const v = { ...(book||{}), ...preset };
  for (const k of FIELDS) { const el=$("#e_"+k); el.value = v[k] ?? ""; el.classList.toggle("auto", markAuto && !!preset[k] && k!=="isbn"); }
  if (!book && !v.shelf) $("#e_shelf").value = nextShelf();
  for (const r of ed.querySelectorAll("input[name=kind]")) r.checked = r.value === (v.kind || (v.isbn ? "官方出版" : ""));
  $("#e_review").checked = !!v.needsReview;
  $("#delBtn").hidden = !book; $("#delConfirm").hidden = true;
  setLookupSt(markAuto ? "已帶入查詢到的資料（綠色），請確認後儲存。" : "", markAuto ? "ok" : "");
  renderTags(); renderCover(); checkDup();
  if (!ed.open) ed.showModal();
  ed.querySelector(".body").scrollTop = 0;
}
function closeEditor(){ if (ed.open) ed.close(); E = null; }
$("#edClose").onclick = closeEditor; $("#edCancel").onclick = closeEditor;
ed.addEventListener("close", () => { E = null; });
function setLookupSt(t, cls=""){ const s=$("#lookupSt"); s.innerHTML=t; s.className="st "+cls; }

$("#edScanBtn").onclick = () => openScanner("editor");
function applyCode(r){
  if (!E) return;
  if (r.isbn) { $("#e_isbn").value = r.isbn; if (!ed.querySelector("input[name=kind]:checked")) ed.querySelector('input[value="官方出版"]').checked = true; runLookup(); }
  else { $("#e_code").value = r.code; setLookupSt("已讀取 QR 內容。", "ok"); }
  checkDup();
}
$("#lookupBtn").onclick = () => runLookup(true);
async function runLookup(manual){
  if (!E) return;
  const isbn = toIsbn($("#e_isbn").value);
  if (!isbn) { if (manual) { setLookupSt("請先掃條碼或輸入正確的 ISBN。", "bad"); $("#e_isbn").focus(); } return; }
  $("#e_isbn").value = isbn;
  if (!navigator.onLine) { setLookupSt("目前離線，無法查詢。可先勾「資料待確認」儲存，之後再查。", "bad"); $("#e_review").checked = true; return; }
  const me = E; $("#lookupBtn").disabled = true;
  setLookupSt('<span class="spin"></span> 查詢中…');
  const lk = await lookupIsbn(isbn);
  $("#lookupBtn").disabled = false;
  if (E !== me) return;
  if (!lk.title) {
    setLookupSt(lk.failed ? "查詢失敗，請檢查網路後再試。" : "資料庫查無此書，請手動填寫或拍封面。", "bad");
    return;
  }
  let n = 0;
  for (const k of ["title","titleAlt","author","publisher","pubdate","lang","system","note"]) {
    const el = $("#e_"+k); if (lk[k] && !el.value.trim()) { el.value = lk[k]; el.classList.add("auto"); n++; }
  }
  if (lk.coverUrl && !E.coverUrl && !E.coverData) { E.coverUrl = lk.coverUrl; renderCover(); n++; }
  if (!ed.querySelector("input[name=kind]:checked")) ed.querySelector('input[value="官方出版"]').checked = true;
  setLookupSt(n ? `已從 ${lk.sources.join("、")} 帶入 ${n} 項資料（綠色），請確認。` : `${lk.sources.join("、")} 的資料和目前欄位相同。`, "ok");
  checkDup();
}

/* tags */
function renderTags(){
  const box=$("#tagBox"), inp=$("#e_tag");
  box.querySelectorAll(".chip").forEach(c=>c.remove());
  E.tags.forEach((t,i)=>{ const c=document.createElement("span"); c.className="chip"; c.innerHTML=`${esc(t)}<button type="button" aria-label="移除 ${esc(t)}" data-i="${i}">×</button>`; box.insertBefore(c, inp); });
  $("#tagSuggest").innerHTML = counts("tags").map(x=>x[0]).filter(t=>!E.tags.includes(t)).slice(0,12).map(t=>`<button type="button" data-t="${esc(t)}">+ ${esc(t)}</button>`).join("");
}
function addTag(v){ v=String(v).trim().replace(/^#/,""); if (v && !E.tags.includes(v)) E.tags.push(v); renderTags(); }
$("#e_tag").addEventListener("keydown", e => {
  if ((e.key==="Enter" || e.key===",") && !e.isComposing) { e.preventDefault(); addTag(e.target.value); e.target.value=""; }
  else if (e.key==="Backspace" && !e.target.value && E.tags.length) { E.tags.pop(); renderTags(); }
});
$("#e_tag").addEventListener("input", e => { const v=e.target.value; if (/[,，、]$/.test(v)) { addTag(v.slice(0,-1)); e.target.value=""; } });
$("#e_tag").addEventListener("blur", e => { if (E && e.target.value.trim()) { addTag(e.target.value); e.target.value=""; } });
$("#tagBox").addEventListener("click", e => { const b=e.target.closest("button[data-i]"); if (b) { E.tags.splice(+b.dataset.i,1); renderTags(); } else $("#e_tag").focus(); });
$("#tagSuggest").addEventListener("click", e => { const b=e.target.closest("button[data-t]"); if (b) addTag(b.dataset.t); });

/* cover */
function renderCover(){
  if (!E) return;
  const cur = { title:$("#e_title").value, system:$("#e_system").value, coverUrl:E.coverUrl, coverData:E.coverData };
  $("#coverPrev").innerHTML = coverHTML(cur);
  $("#coverRm").hidden = !(E.coverUrl || E.coverData);
}
async function shrink(file, max=640){
  let img;
  try { img = await createImageBitmap(file, { imageOrientation:"from-image" }); }
  catch { img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(file); }); }
  const k = Math.min(1, max/Math.max(img.width, img.height));
  const cv = document.createElement("canvas"); cv.width=Math.round(img.width*k); cv.height=Math.round(img.height*k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.8);
}
async function onCoverFile(e){
  const f = e.target.files?.[0]; e.target.value=""; if (!f || !E) return;
  try { E.coverData = await shrink(f); E.coverUrl = ""; renderCover(); }
  catch { toast("無法讀取這張照片，請換一張。"); }
}
$("#edCoverCam").addEventListener("change", onCoverFile);
$("#edCoverPick").addEventListener("change", onCoverFile);
$("#coverRm").addEventListener("click", () => { E.coverUrl=""; E.coverData=""; renderCover(); });
$("#e_title").addEventListener("input", () => { renderCover(); checkDup(); });
$("#e_system").addEventListener("input", renderCover);
["isbn","code","titleAlt"].forEach(k => $("#e_"+k).addEventListener("input", checkDup));
for (const k of FIELDS) $("#e_"+k).addEventListener("input", e => e.target.classList.remove("auto"));

function checkDup(){
  if (!E) return;
  const isbn = toIsbn($("#e_isbn").value), code=$("#e_code").value.trim(), t=norm($("#e_title").value), ta=norm($("#e_titleAlt").value);
  const hits = S.books.filter(b => b.id !== E.id && (
    (isbn && b.isbn===isbn) || (code && b.code && norm(b.code)===norm(code)) ||
    (t.length>=2 && (norm(b.title)===t || norm(b.titleAlt)===t)) ||
    (t.length>=4 && norm(b.title).length>=4 && (norm(b.title).includes(t) || t.includes(norm(b.title)))) ||
    (ta.length>=2 && (norm(b.title)===ta || norm(b.titleAlt)===ta))
  )).slice(0,3);
  $("#dupBox").innerHTML = hits.length ? `<div class="dup"><b>可能已經有了：</b>${hits.map(b=>`<br>${shelfStr(b.shelf)} 《${esc(b.title)}》${b.edition?"・"+esc(b.edition):""}${b.system?"・"+esc(b.system):""} <button type="button" data-open="${esc(b.id)}">查看</button>`).join("")}<br><span style="color:var(--muted)">不同版次或場次仍可以另外建檔。</span></div>` : "";
}
$("#dupBox").addEventListener("click", e => { const b=e.target.closest("[data-open]"); if (!b) return; const bk=S.books.find(x=>x.id===b.dataset.open); if (bk) openEditor(bk); });

const exactTitle = t => String(t ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
$("#edForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!E) return;
  const title = $("#e_title").value.trim(); if (!title) { $("#e_title").focus(); return; }
  if ($("#e_tag").value.trim()) { addTag($("#e_tag").value); $("#e_tag").value=""; }
  const b = { ...(E.orig||{}) };
  for (const k of FIELDS) b[k] = $("#e_"+k).value.trim();
  b.id = E.id || uid();
  b.isbn = toIsbn(b.isbn) || b.isbn.replace(/[^0-9X]/gi,"");
  b.shelf = parseInt(b.shelf,10) || nextShelf();
  b.kind = ed.querySelector("input[name=kind]:checked")?.value || "";
  b.tags = [...E.tags]; b.needsReview = $("#e_review").checked;
  b.coverUrl = E.coverUrl || ""; if (E.coverData) b.coverData = E.coverData; else delete b.coverData;
  b.createdAt = E.orig?.createdAt || Date.now();
  const isNew = !E.id, o = E.orig || {};
  const others = S.books.filter(x => x.id !== b.id);

  // 有 ISBN：同一個 ISBN 已經存在就不能再登錄
  if (b.isbn && (isNew || b.isbn !== o.isbn)) {
    const same = others.filter(x => x.isbn === b.isbn);
    if (same.length) {
      const a = await askDup("isbn", same, b.isbn);
      if (a.view) openEditor(a.view);
      return;
    }
  }
  // 沒有 ISBN：書名完全相同，或 QR 內容相同 → 讓使用者決定
  if (!b.isbn && (isNew || exactTitle(b.title) !== exactTitle(o.title) || norm(b.code) !== norm(o.code))) {
    const sameTitle = others.filter(x => exactTitle(x.title) === exactTitle(b.title));
    const sameCode = b.code ? others.filter(x => x.code && norm(x.code) === norm(b.code) && !sameTitle.includes(x)) : [];
    if (sameTitle.length || sameCode.length) {
      const a = await askDup(sameTitle.length ? "title" : "code", [...sameTitle, ...sameCode], sameTitle.length ? b.title : b.code);
      if (a.view) { openEditor(a.view); return; }
      if (a.choice !== "continue") return;
    }
  }
  putBook(b);
  toast(isNew ? `已加入 ${shelfStr(b.shelf)}《${title}》` : "已更新");
  closeEditor();
});

/* ---------- duplicate warning ---------- */
const dupDlg = $("#dupDlg");
let dupResolve = null;
function askDup(kind, matches, key){
  const T = {
    isbn:  { cls:"block", h:"這本已經收藏了", m:`ISBN <span class="mono">${esc(key)}</span> 已經登錄過，不會重複新增。` },
    title: { cls:"warn",  h:"有書名完全相同的書", m:`「${esc(key)}」已經在收藏裡。如果是不同版本、場次或另一本複本，可以繼續登錄。` },
    code:  { cls:"warn",  h:"QR 內容相同", m:`有書的 QR／條碼內容和這本一樣（同一個社團的網址也可能相同）。` },
  }[kind];
  dupDlg.className = "alert " + T.cls;
  $("#dupHead").textContent = T.h;
  $("#dupMsg").innerHTML = T.m;
  $("#dupList").innerHTML = matches.slice(0,4).map(b => `<button type="button" class="dup-item" data-view="${esc(b.id)}">
      <span class="dup-cv">${coverHTML(b)}</span>
      <span class="dup-t"><b>${esc(b.title||"未命名")}</b><small>${esc([shelfStr(b.shelf), b.edition, b.system, b.publisher].filter(Boolean).join("・"))}</small></span>
      <span class="dup-go">查看</span></button>`).join("");
  $("#dupActs").innerHTML = kind === "isbn"
    ? `<button type="button" class="btn primary" data-choice="cancel">知道了</button>`
    : `<button type="button" class="btn" data-choice="cancel">取消</button><button type="button" class="btn primary" data-choice="continue">仍要登錄</button>`;
  navigator.vibrate?.([40,60,40]);
  dupDlg.showModal();
  return new Promise(res => { dupResolve = res; });
}
function closeDup(result){ if (dupDlg.open) dupDlg.close(); const r = dupResolve; dupResolve = null; r?.(result); }
dupDlg.addEventListener("click", e => {
  const v = e.target.closest("[data-view]"); if (v) { const bk = S.books.find(x=>x.id===v.dataset.view); closeDup({ view:bk }); return; }
  const c = e.target.closest("[data-choice]"); if (c) closeDup({ choice:c.dataset.choice });
});
dupDlg.addEventListener("cancel", e => { e.preventDefault(); closeDup({ choice:"cancel" }); });

$("#delBtn").onclick = () => { $("#delBtn").hidden=true; $("#delConfirm").hidden=false; };
$("#delNo").onclick = () => { $("#delBtn").hidden=false; $("#delConfirm").hidden=true; };
$("#delYes").onclick = () => { const id=E.id; closeEditor(); removeBook(id); toast("已刪除"); };

/* ---------- settings / import / export ---------- */
const st = $("#st");
function openSettings(){ $("#cfgUrl").value=S.cfg.url; $("#cfgToken").value=S.cfg.token; $("#cfgSt").textContent=""; $("#impSt").textContent=""; renderSync(); st.showModal(); }
$("#stClose").onclick = () => st.close();
$("#syncNow").onclick = () => sync(true);
$("#cfgSave").onclick = async () => {
  const url = $("#cfgUrl").value.trim(), token = $("#cfgToken").value.trim();
  const s = $("#cfgSt");
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) { s.className="st bad"; s.textContent="網址格式不對，應該是 https://script.google.com/macros/s/…/exec"; return; }
  S.cfg = { url, token }; store(K.cfg, S.cfg);
  if (!url) { s.className="st"; s.textContent="已取消同步，資料只存在本機。"; render(); return; }
  // first connect: push all local books so nothing is lost
  for (const b of S.books) if (!S.out.up[b.id]) S.out.up[b.id] = b;
  persist();
  s.className="st"; s.innerHTML='<span class="spin"></span> 連線中…';
  await sync();
  if (S.syncErr) { s.className="st bad"; s.textContent="連線失敗：" + S.syncErr; }
  else { s.className="st ok"; s.textContent=`連線成功，目前共 ${S.books.length} 本。`; }
};

const COLS = [["title","書名"],["titleAlt","原文書名"],["system","系統"],["kind","類型"],["author","作者"],["publisher","出版社"],["isbn","ISBN"],["pubdate","出版日期"],["code","QR內容"],["edition","版次"],["lang","語言"],["tags","標籤"],["note","備註"],["shelf","流水號"],["where","收藏位置"],["needsReview","待確認"],["coverUrl","封面網址"]];
const csvCell = v => { const s=String(v??""); return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
$("#expBtn").onclick = () => {
  const rows = [...S.books].sort((a,b)=>(+a.shelf||0)-(+b.shelf||0));
  const csv = "﻿" + [COLS.map(c=>c[1]).join(","), ...rows.map(b=>COLS.map(([k]) =>
    k==="tags" ? (b.tags||[]).join("、") : k==="needsReview" ? (b.needsReview?"是":"") : k==="isbn" && b.isbn ? "=\"" + b.isbn + "\"" : b[k]).map(csvCell).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type:"text/csv" }));
  a.download = `TRPG藏書_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
};
function parseCSV(text){
  const rows=[]; let row=[], cell="", q=false;
  for (let i=0;i<text.length;i++){ const c=text[i];
    if (q) { if (c==='"') { if (text[i+1]==='"') { cell+='"'; i++; } else q=false; } else cell+=c; }
    else if (c==='"') q=true; else if (c===",") { row.push(cell); cell=""; }
    else if (c==="\n" || c==="\r") { if (c==="\r" && text[i+1]==="\n") i++; row.push(cell); rows.push(row); row=[]; cell=""; }
    else cell+=c; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r=>r.some(x=>x.trim()));
}
const HEAD = { "書名":"title","title":"title","名稱":"title","原文書名":"titleAlt","別名":"titleAlt","系統":"system","system":"system","類型":"kind","作者":"author","author":"author","出版社":"publisher","社團":"publisher","出版社/社團":"publisher","publisher":"publisher","isbn":"isbn","出版日期":"pubdate","qr內容":"code","版次":"edition","場次":"edition","語言":"lang","標籤":"tags","tags":"tags","備註":"note","note":"note","流水號":"shelf","收藏位置":"where","待確認":"needsReview","封面網址":"coverUrl" };
$("#impFile").addEventListener("change", async e => {
  const f=e.target.files?.[0]; e.target.value=""; if (!f) return;
  const s=$("#impSt");
  const rows = parseCSV((await f.text()).replace(/^﻿/,""));
  if (rows.length<2) { s.textContent="檔案沒有資料列。"; return; }
  const map = rows[0].map(h => HEAD[h.trim().toLowerCase()] || HEAD[h.trim()] || null);
  if (!map.includes("title")) { s.textContent="找不到「書名」欄位，請確認第一列是欄位名稱。"; return; }
  let shelf = nextShelf(), ok=0, skip=0; const t0=Date.now();
  for (let i=1;i<rows.length;i++){
    const d = { id:uid(), title:"",titleAlt:"",system:"",kind:"",author:"",publisher:"",isbn:"",pubdate:"",code:"",edition:"",lang:"",tags:[],note:"",where:"",needsReview:false,coverUrl:"" };
    rows[i].forEach((v,j)=>{ const k=map[j]; if(!k) return; v=v.trim();
      if (k==="tags") d.tags = v.split(/[、;；,，]/).map(x=>x.trim()).filter(Boolean);
      else if (k==="needsReview") d.needsReview = /^(是|y|yes|true|1)$/i.test(v);
      else if (k==="isbn") d.isbn = toIsbn(v) || v.replace(/[^0-9X]/gi,"");
      else d[k]=v; });
    if (!d.title) { skip++; continue; }
    if (d.isbn && S.books.some(b=>b.isbn===d.isbn)) { skip++; continue; }
    d.shelf = parseInt(d.shelf,10) || shelf++; d.createdAt = t0 + i;
    putBook(d, true); ok++;
  }
  persist(); render(); scheduleSync(300);
  s.textContent = `完成：匯入 ${ok} 本${skip?`，略過 ${skip} 列（沒有書名或 ISBN 重複）`:""}。`;
});

/* ---------- boot ---------- */
render();
if (S.cfg.url) scheduleSync(300);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
