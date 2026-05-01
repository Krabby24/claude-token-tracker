// ================================================================
// Claude Token Tracker — popup.js v6 FINAL
// ================================================================

const PLANS = {
  free:  { label:'Free',    tok:80000,   msg:40,   color:'#6b7280' },
  pro:   { label:'Pro',     tok:640000,  msg:225,  color:'#f97316' },
  max5:  { label:'Max 5×',  tok:1280000, msg:450,  color:'#8b5cf6' },
  max20: { label:'Max 20×', tok:5120000, msg:1800, color:'#ec4899' }
};

// ── Formatters ──
function fmtN(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n/1e6).toFixed(2)+'M';
  if (n >= 1000)    return (n/1000).toFixed(1)+'k';
  return String(n);
}
function fmtMs(ms) {
  if (ms <= 0) return '00:00:00';
  const h = Math.floor(ms/3600000);
  const m = Math.floor((ms%3600000)/60000);
  const s = Math.floor((ms%60000)/1000);
  return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
}
function fmtClock(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function pctCol(p) {
  if (p >= 90) return '#ef4444';
  if (p >= 70) return '#f97316';
  if (p >= 50) return '#eab308';
  return '#22c55e';
}

// ── SVG gauge ──
function buildGauge(pct, color) {
  const NS = 'http://www.w3.org/2000/svg';
  const r = 30, circ = 2*Math.PI*r;
  const offset = circ*(1-Math.min(1,pct/100));
  const svg = document.createElementNS(NS,'svg');
  svg.setAttribute('width','76'); svg.setAttribute('height','76');
  svg.setAttribute('viewBox','0 0 76 76');
  svg.style.cssText='transform:rotate(-90deg);position:absolute;top:0;left:0';
  const track = document.createElementNS(NS,'circle');
  track.setAttribute('cx','38');track.setAttribute('cy','38');track.setAttribute('r',r);
  track.setAttribute('fill','none');track.setAttribute('stroke','#1e2230');track.setAttribute('stroke-width','5');
  const arc = document.createElementNS(NS,'circle');
  arc.setAttribute('cx','38');arc.setAttribute('cy','38');arc.setAttribute('r',r);
  arc.setAttribute('fill','none');arc.setAttribute('stroke',color);
  arc.setAttribute('stroke-width','5');arc.setAttribute('stroke-linecap','round');
  arc.setAttribute('stroke-dasharray',circ);arc.setAttribute('stroke-dashoffset',offset);
  arc.style.transition='stroke-dashoffset .6s ease,stroke .3s ease';
  svg.appendChild(track);svg.appendChild(arc);
  const wrap = document.createElement('div');wrap.className='gauge-wrap';wrap.appendChild(svg);
  const center = document.createElement('div');center.className='gauge-center';
  const pEl=document.createElement('div');pEl.className='gauge-pct';pEl.style.color=color;pEl.textContent=Math.round(pct)+'%';
  const sEl=document.createElement('div');sEl.className='gauge-sub';sEl.textContent='used';
  center.appendChild(pEl);center.appendChild(sEl);wrap.appendChild(center);
  return wrap;
}

// ── Progress bar ──
function buildBar(pct, color, label) {
  const wrap=document.createElement('div');wrap.className='bar-wrap';
  const meta=document.createElement('div');meta.className='bar-meta';
  const l=document.createElement('span');l.textContent=label;
  const r=document.createElement('span');r.textContent=pct.toFixed(1)+'%';
  meta.appendChild(l);meta.appendChild(r);
  const bg=document.createElement('div');bg.className='bar-bg';
  const fill=document.createElement('div');fill.className='bar-fill';
  fill.style.width=Math.min(100,pct)+'%';fill.style.background=color;
  bg.appendChild(fill);wrap.appendChild(meta);wrap.appendChild(bg);
  return wrap;
}

// ── Stat row ──
function buildStat(label, value, color) {
  const row=document.createElement('div');row.className='stat-row';
  const l=document.createElement('span');l.className='stat-lbl';l.textContent=label;
  const v=document.createElement('span');v.className='stat-val';
  if(color) v.style.color=color;
  v.textContent=value;
  row.appendChild(l);row.appendChild(v);
  return row;
}

// ── Sparkline (5-hour usage graph) ──
function buildSparkline(buckets, planColor) {
  if (!buckets || buckets.length === 0) return null;
  const wrap = document.createElement('div'); wrap.className = 'spark-wrap';
  const hdr = document.createElement('div'); hdr.className = 'spark-hdr';
  const lbl = document.createElement('span'); lbl.className = 'spark-lbl'; lbl.textContent = 'Usage / hour';
  const total = buckets.reduce((s,b)=>s+b.tokens,0);
  const tot = document.createElement('span');
  tot.style.cssText='font-family:"IBM Plex Mono",monospace;font-size:9px;color:var(--text3)';
  tot.textContent=fmtN(total)+' total';
  hdr.appendChild(lbl); hdr.appendChild(tot); wrap.appendChild(hdr);

  const NS = 'http://www.w3.org/2000/svg';
  const W=348, H=36, pad=2;
  const svg=document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio','none');
  svg.className='spark-svg';

  const maxTok = Math.max(...buckets.map(b=>b.tokens), 1);
  const bw = (W - pad*(buckets.length+1)) / buckets.length;

  buckets.forEach((b, i) => {
    const barH = Math.max(2, (b.tokens / maxTok) * (H - 8));
    const x = pad + i*(bw+pad);
    const y = H - barH;
    const rect=document.createElementNS(NS,'rect');
    rect.setAttribute('x',x.toFixed(1));
    rect.setAttribute('y',y.toFixed(1));
    rect.setAttribute('width',bw.toFixed(1));
    rect.setAttribute('height',barH.toFixed(1));
    rect.setAttribute('rx','2');
    rect.setAttribute('fill', b.tokens > 0 ? planColor : '#1e2230');
    rect.setAttribute('opacity', b.tokens > 0 ? '0.85' : '1');
    svg.appendChild(rect);

    // Hour label
    const txt=document.createElementNS(NS,'text');
    txt.setAttribute('x',(x+bw/2).toFixed(1));
    txt.setAttribute('y',H.toFixed(1));
    txt.setAttribute('text-anchor','middle');
    txt.setAttribute('font-size','7');
    txt.setAttribute('fill','#4b5568');
    txt.setAttribute('font-family','IBM Plex Mono,monospace');
    txt.textContent='h'+(b.hour+1);
    svg.appendChild(txt);
  });

  wrap.appendChild(svg);
  return wrap;
}

// ── Section label ──
function buildSection(text) {
  const w=document.createElement('div');w.className='section-lbl';
  const s=document.createElement('span');s.textContent=text;
  const l=document.createElement('div');l.className='section-line';
  w.appendChild(s);w.appendChild(l);return w;
}

// ================================================================
// MAIN RENDER
// ================================================================
function render(state) {
  const container = document.getElementById('main-content');
  if (!container) return;
  container.innerHTML = '';
  if (!state) { container.innerHTML='<div style="padding:20px;text-align:center;color:#4b5568">Loading…</div>'; return; }

  const plan = PLANS[state.plan] || PLANS.pro;
  const now  = Date.now();
  const hasW = !!state.windowStart && now < (state.windowEnd||0);
  const used = state.tokensUsed   || 0;
  const msgs = state.messagesUsed || 0;
  const tPct = Math.min(100,(used/plan.tok)*100);
  const mPct = Math.min(100,(msgs/plan.msg)*100);
  const left = Math.max(0,plan.tok-used);
  const msLeft = hasW ? Math.max(0,state.windowEnd-now) : 0;

  // Plan buttons
  document.querySelectorAll('.plan-btn').forEach(b=>b.classList.toggle('active',b.dataset.plan===state.plan));

  if (hasW) {
    const card=document.createElement('div');card.className='card';

    // Header
    const hdr=document.createElement('div');hdr.className='card-hdr';
    const lbl=document.createElement('span');lbl.className='card-lbl';lbl.textContent='Active Window';
    const sr=document.createElement('div');sr.className='status-row';
    const dot=document.createElement('div');dot.className='dot live';
    const live=document.createElement('span');live.style.cssText='font-size:10px;color:#22c55e';live.textContent='live';
    const badge=document.createElement('span');badge.className='badge est';badge.textContent='EST';
    sr.appendChild(dot);sr.appendChild(live);sr.appendChild(badge);
    hdr.appendChild(lbl);hdr.appendChild(sr);card.appendChild(hdr);

    // Gauge + stats
    const gr=document.createElement('div');gr.className='gauge-row';
    gr.appendChild(buildGauge(tPct,pctCol(tPct)));
    const sc=document.createElement('div');sc.className='stats';
    sc.appendChild(buildStat('Tokens used', fmtN(used), pctCol(tPct)));
    sc.appendChild(buildStat('Remaining',   fmtN(left)));
    sc.appendChild(buildStat('Messages',    msgs+' / '+plan.msg, mPct>=70?pctCol(mPct):undefined));
    sc.appendChild(buildStat('Limit',       fmtN(plan.tok), plan.color));
    if((state.cacheReadTotal||0)>0) sc.appendChild(buildStat('Cache hit',fmtN(state.cacheReadTotal),'#60a5fa'));
    gr.appendChild(sc);card.appendChild(gr);

    // Bars
    card.appendChild(buildBar(tPct,pctCol(tPct),'tokens'));
    card.appendChild(buildBar(mPct,plan.color+'99','messages'));

    // Window time
    const wt=document.createElement('div');wt.className='win-time';
    const wl=document.createElement('span');wl.textContent='Window';
    const wr=document.createElement('span');wr.textContent=fmtClock(state.windowStart)+' → '+fmtClock(state.windowEnd);
    wt.appendChild(wl);wt.appendChild(wr);card.appendChild(wt);
    container.appendChild(card);

    // Sparkline
    const spark = buildSparkline(state.hourlyBuckets, plan.color);
    if (spark) container.appendChild(spark);

  } else {
    const card=document.createElement('div');card.className='empty-card';
    card.innerHTML='<strong style="color:#f97316">No active window.</strong><br>Send a message on claude.ai or click <strong>▶ Start Window</strong>.';
    if(state.history&&state.history.length>0){
      const last=state.history[state.history.length-1];
      const h=document.createElement('div');h.style.marginTop='10px';
      h.appendChild(buildStat('Last session',fmtN(last.tokensUsed)+' tokens'));
      h.appendChild(buildStat('Messages',String(last.messagesUsed)));
      card.appendChild(h);
    }
    container.appendChild(card);
  }

  // Timer
  const tc=document.createElement('div');tc.className='timer-card';
  const tl=document.createElement('span');tl.className='timer-lbl';tl.textContent='⏱ Resets in';
  const tv=document.createElement('span');tv.id='timer-val';
  tv.className='timer-val'+(msLeft>0&&msLeft<600000?' urgent':'');
  tv.textContent=hasW?fmtMs(msLeft):'—:—:—';
  tc.appendChild(tl);tc.appendChild(tv);container.appendChild(tc);

  // Conversations
  const convEntries=Object.entries(state.convStats||{});
  if(convEntries.length>0){
    container.appendChild(buildSection('Conversations'));
    const list=document.createElement('div');list.className='conv-list';
    for(const [id,data] of convEntries){
      const short=id.length>14?id.slice(0,12)+'…':id;
      const inT=data.inputTotal||0, outT=data.outputTotal||0;
      const item=document.createElement('div');item.className='conv-item';
      const idS=document.createElement('span');idS.className='conv-id';idS.title=id;
      idS.textContent=short+' ('+(data.messages||0)+')';
      const toks=document.createElement('div');toks.className='conv-toks';
      const ti=document.createElement('span');ti.className='tok-in';ti.textContent='↑'+fmtN(inT);
      const to=document.createElement('span');to.className='tok-out';to.textContent='↓'+fmtN(outT);
      const tt=document.createElement('span');tt.className='tok-tot';tt.textContent=fmtN(inT+outT);
      toks.appendChild(ti);toks.appendChild(to);toks.appendChild(tt);
      item.appendChild(idS);item.appendChild(toks);list.appendChild(item);
    }
    container.appendChild(list);
  }

  // Method indicator
  const dbgEvts = state._debug || [];
  const lastDone = [...dbgEvts].reverse().find(d=>d.type==='done');
  if(lastDone){
    const mrow=document.createElement('div');mrow.className='method-row';
    const ok=lastDone.inputTokens>0;
    mrow.style.color=ok?'#4b5568':'#ef4444';
    mrow.textContent=(ok?'✓':'⚠') + ' input: '+lastDone.method
      +' | ↑'+fmtN(lastDone.inputTokens)+' ↓'+fmtN(lastDone.outputTokens)+' (BPE est)';
    container.appendChild(mrow);
  }
}

// ── Timer tick ──
let timerInterval=null, currentState=null;

function startTimer(){
  clearInterval(timerInterval);
  timerInterval=setInterval(()=>{
    const el=document.getElementById('timer-val');
    if(!el||!currentState?.windowEnd) return;
    const left=Math.max(0,currentState.windowEnd-Date.now());
    el.textContent=left>0?fmtMs(left):'00:00:00';
    el.className='timer-val'+(left>0&&left<600000?' urgent':'');
    if(left===0&&currentState.windowStart) loadState();
  },1000);
}

function loadState(){
  chrome.runtime.sendMessage({type:'GET_STATE'},res=>{
    if(chrome.runtime.lastError||!res?.ok) return;
    currentState=res.state;
    render(currentState);
    startTimer();
  });
}

// Push listener
chrome.runtime.onMessage.addListener(msg=>{
  if(msg.type==='PUSH_UPDATE') loadState();
});

// Plan buttons
document.querySelectorAll('.plan-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    chrome.runtime.sendMessage({type:'SET_PLAN',payload:{plan:btn.dataset.plan}},loadState);
  });
});

document.getElementById('btn-reset').addEventListener('click',()=>{
  if(confirm('Reset current window? Data will be archived.'))
    chrome.runtime.sendMessage({type:'MANUAL_RESET'},loadState);
});
document.getElementById('btn-start').addEventListener('click',()=>{
  chrome.runtime.sendMessage({type:'MANUAL_START_WINDOW'},loadState);
});

loadState();
