// ================================================================
// Claude Token Tracker — background.js (Service Worker) v6 FINAL
//
// Plan limits calibrated empirically from Claude Pro usage bar:
//   - 5000 words input ≈ 1% usage → Pro limit ≈ 640k tokens
//   - Free: estimated ~1/8 of Pro
//   - Max5: 5× Pro, Max20: 20× Pro
// ================================================================

const PLANS = {
  free:  { label: 'Free',    tokensPerWindow: 80000,   messagesPerWindow: 40,   color: '#6b7280' },
  pro:   { label: 'Pro',     tokensPerWindow: 640000,  messagesPerWindow: 225,  color: '#f97316' },
  max5:  { label: 'Max 5×',  tokensPerWindow: 1280000, messagesPerWindow: 450,  color: '#8b5cf6' },
  max20: { label: 'Max 20×', tokensPerWindow: 5120000, messagesPerWindow: 1800, color: '#ec4899' }
};

const WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours

const DEFAULT_STATE = {
  plan: 'pro',
  windowStart: null,
  windowEnd: null,
  tokensUsed: 0,
  messagesUsed: 0,
  cacheReadTotal: 0,
  // Per-conversation delta tracking
  // convStats[cid] = { lastInputTotal, inputTotal, outputTotal, messages }
  convStats: {},
  // History of past windows (last 20)
  history: [],
  // Hourly buckets for sparkline graph [ {hour, tokens} × 5 ]
  hourlyBuckets: [],
  lastActivity: null,
  lastSource: 'estimate',
  // Debug events (last 20)
  _debug: []
};

// ── Storage ──
function getState() {
  return new Promise(r =>
    chrome.storage.local.get('ctt_v6', d => r(d.ctt_v6 ? { ...DEFAULT_STATE, ...d.ctt_v6 } : { ...DEFAULT_STATE }))
  );
}
async function patchState(updates) {
  const cur = await getState();
  const next = { ...cur, ...updates };
  await new Promise(r => chrome.storage.local.set({ ctt_v6: next }, r));
  return next;
}

// ── Window management ──
async function ensureWindow(now) {
  const s = await getState();
  if (!s.windowStart || now >= s.windowEnd) {
    if (s.windowStart) await doArchive(s);
    await patchState({
      windowStart: now, windowEnd: now + WINDOW_MS,
      tokensUsed: 0, messagesUsed: 0, cacheReadTotal: 0,
      convStats: {}, hourlyBuckets: initBuckets(now)
    });
    scheduleReset(now + WINDOW_MS);
  }
}

function initBuckets(start) {
  return Array.from({ length: 5 }, (_, i) => ({
    hour: i,
    startTs: start + i * 3600000,
    tokens: 0
  }));
}

async function doArchive(s) {
  const entry = {
    start: s.windowStart, end: s.windowEnd,
    tokensUsed: s.tokensUsed, messagesUsed: s.messagesUsed, plan: s.plan
  };
  const history = [...(s.history || []), entry].slice(-20);
  await patchState({
    windowStart: null, windowEnd: null,
    tokensUsed: 0, messagesUsed: 0, cacheReadTotal: 0,
    convStats: {}, hourlyBuckets: [], history
  });
}

async function checkExpiry() {
  const s = await getState();
  if (s.windowEnd && Date.now() >= s.windowEnd) await doArchive(s);
}

function scheduleReset(at) {
  const mins = Math.max(0.1, (at - Date.now()) / 60000);
  chrome.alarms.clearAll(() =>
    chrome.alarms.create('ctt_reset', { delayInMinutes: mins })
  );
}

// ── Record message with delta input tracking ──
async function recordMessage(p) {
  const now = Date.now();
  await ensureWindow(now);
  const s = await getState();

  const apiInput  = p.inputTokens  || 0;
  const apiOutput = p.outputTokens || 0;
  const cid = p.conversationId || 'default';

  // Delta: subtract previous cumulative input to avoid double-counting history
  const prev = s.convStats[cid] || { lastInputTotal: 0, inputTotal: 0, outputTotal: 0, messages: 0 };
  const inputDelta = apiInput > prev.lastInputTotal ? apiInput - prev.lastInputTotal : apiInput;
  const totalThisTurn = inputDelta + apiOutput;

  // Update hourly bucket
  const buckets = (s.hourlyBuckets || []).map(b => {
    const inRange = now >= b.startTs && now < b.startTs + 3600000;
    return inRange ? { ...b, tokens: b.tokens + totalThisTurn } : b;
  });

  const updatedConvStats = {
    ...s.convStats,
    [cid]: {
      lastInputTotal: apiInput,
      inputTotal:  prev.inputTotal  + inputDelta,
      outputTotal: prev.outputTotal + apiOutput,
      messages:    prev.messages    + 1
    }
  };

  await patchState({
    tokensUsed:    s.tokensUsed + totalThisTurn,
    messagesUsed:  s.messagesUsed + 1,
    convStats:     updatedConvStats,
    hourlyBuckets: buckets,
    lastActivity:  now,
    lastSource:    p.source || 'estimate'
  });

  await updateBadge();
  pushToPopup();
  await maybeNotify(s.tokensUsed + totalThisTurn, PLANS[s.plan]?.tokensPerWindow || 640000);
}

// ── Notifications at 80% and 95% ──
async function maybeNotify(used, limit) {
  const pct = (used / limit) * 100;
  const s = await getState();
  const notified = s._notified || {};

  if (pct >= 95 && !notified['95']) {
    chrome.notifications?.create('ctt_95', {
      type: 'basic', iconUrl: 'icons/icon48.png',
      title: 'Claude Token Tracker',
      message: '⚠️ 95% of your 5-hour window used!'
    });
    await patchState({ _notified: { ...notified, '95': true } });
  } else if (pct >= 80 && !notified['80']) {
    chrome.notifications?.create('ctt_80', {
      type: 'basic', iconUrl: 'icons/icon48.png',
      title: 'Claude Token Tracker',
      message: '⚡ 80% of your 5-hour window used.'
    });
    await patchState({ _notified: { ...notified, '80': true } });
  }
}

// ── Badge ──
async function updateBadge() {
  const s = await getState();
  if (!s.windowStart) { chrome.action.setBadgeText({ text: '' }); return; }
  const plan = PLANS[s.plan] || PLANS.pro;
  const pct = Math.min(100, Math.round(s.tokensUsed / plan.tokensPerWindow * 100));
  chrome.action.setBadgeText({ text: pct + '%' });
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f97316' : pct >= 50 ? '#eab308' : '#22c55e';
  chrome.action.setBadgeBackgroundColor({ color });
}

function pushToPopup() {
  chrome.runtime.sendMessage({ type: 'PUSH_UPDATE' }).catch(() => {});
}

// ── Alarms ──
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'ctt_reset') {
    await checkExpiry();
    await updateBadge();
    pushToPopup();
  }
});

// ── Message router ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case 'RECORD_MESSAGE':
        await recordMessage(msg.payload);
        sendResponse({ ok: true });
        break;

      case 'GET_STATE':
        await checkExpiry();
        sendResponse({ ok: true, state: await getState(), plans: PLANS });
        break;

      case 'SET_PLAN': {
        await patchState({ plan: msg.payload.plan, _notified: {} });
        await updateBadge();
        pushToPopup();
        sendResponse({ ok: true });
        break;
      }

      case 'MANUAL_RESET': {
        const s = await getState();
        await doArchive(s);
        await patchState({ _notified: {} });
        await updateBadge();
        pushToPopup();
        sendResponse({ ok: true });
        break;
      }

      case 'MANUAL_START_WINDOW': {
        const now = Date.now();
        await patchState({
          windowStart: now, windowEnd: now + WINDOW_MS,
          tokensUsed: 0, messagesUsed: 0, cacheReadTotal: 0,
          convStats: {}, hourlyBuckets: initBuckets(now), _notified: {}
        });
        scheduleReset(now + WINDOW_MS);
        await updateBadge();
        pushToPopup();
        sendResponse({ ok: true });
        break;
      }

      case 'DEBUG_EVENT': {
        const s = await getState();
        const dbg = [...(s._debug || []), { ...msg.payload, t: Date.now() }].slice(-20);
        await patchState({ _debug: dbg });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});

updateBadge();
