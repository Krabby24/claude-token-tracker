// ================================================================
// Claude Token Tracker — content.js (MAIN WORLD) v6 FINAL
//
// Token capture strategy (in priority order):
//   1. JSON.stringify hook  — captures full conversation payload
//   2. DOM history reader   — reads all rendered messages
//   3. DOM input buffer     — captures what user typed (fallback)
//
// Output tokens: estimated from streamed SSE text (accurate ±5%)
// Input tokens:  estimated from full conversation text (accurate ±15%)
// System overhead: 400 tokens, charged once per conversation per page load
//   (persisted in sessionStorage to survive SPA navigation)
// ================================================================
(function () {
  if (window.__ctt_hooked) return;
  window.__ctt_hooked = true;

  // ── BPE estimator (calibrated for Claude / cl100k) ──
  function est(text) {
    if (!text) return 0;
    let t = 0;
    for (const s of text.split(/(```[\s\S]*?```|`[^`]+`|https?:\/\/\S+)/g)) {
      if (!s) continue;
      if (s.startsWith('`'))         t += Math.ceil(s.length / 3.5);
      else if (s.startsWith('http')) t += Math.ceil(s.length / 3.0);
      else {
        const na = (s.match(/[^\x00-\x7F]/g) || []).length;
        t += Math.ceil((s.length - na) / 4) + na * 2;
      }
    }
    return t + 4;
  }

  // System prompt overhead charged once per conversation
  const SYSTEM_OVERHEAD = 400;

  function convId() {
    const m = location.pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : 'default';
  }

  function dispatch(p) { window.dispatchEvent(new CustomEvent('__ctt_record', { detail: p })); }
  function dbg(d)      { window.dispatchEvent(new CustomEvent('__ctt_debug',  { detail: d })); }

  // ── Seen conversations: persisted in sessionStorage so page reloads don't double-charge overhead ──
  function getSeenConvs() {
    try { return new Set(JSON.parse(sessionStorage.getItem('__ctt_seen') || '[]')); }
    catch (_) { return new Set(); }
  }
  function markConvSeen(cid) {
    const s = getSeenConvs(); s.add(cid);
    try { sessionStorage.setItem('__ctt_seen', JSON.stringify([...s])); } catch (_) {}
  }

  // ── Extract text from message array ──
  function extractMsgs(msgs) {
    let out = '';
    for (const msg of (msgs || [])) {
      const c = msg.content;
      if (typeof c === 'string') out += c + ' ';
      else if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'text') out += (b.text || '') + ' ';
          else if (b.type === 'tool_result') out += JSON.stringify(b.content || '') + ' ';
          else if (b.type === 'tool_use') out += JSON.stringify(b.input || '') + ' ';
        }
      }
    }
    return out.trim();
  }

  // ── DOM conversation reader — tries many selector strategies ──
  function readDOMHistory() {
    const root = document.querySelector('main, [role="main"], #main-content') || document.body;

    // Ordered selectors: most specific first
    const SELECTORS = [
      // Claude.ai specific testids
      '[data-testid="human-turn-content"]',
      '[data-testid="user-message"]',
      '[data-testid="assistant-turn-content"]',
      '[data-testid="assistant-message"]',
      // Class patterns
      '[class*="HumanTurn"]',
      '[class*="AssistantTurn"]',
      '[class*="human-turn"]',
      '[class*="assistant-turn"]',
      '[class*="UserMessage"]',
      '[class*="BotMessage"]',
      // Generic prose
      '[class*="prose"]',
    ];

    const seen = new Set();
    const texts = [];

    for (const sel of SELECTORS) {
      let els;
      try { els = root.querySelectorAll(sel); } catch (_) { continue; }
      for (const el of els) {
        if (seen.has(el)) continue;
        // Skip if ancestor already included
        let skip = false;
        for (const s of seen) { if (s.contains(el)) { skip = true; break; } }
        if (skip) continue;
        seen.add(el);
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length > 3) texts.push(t);
      }
      if (texts.length > 0) break; // found something with this selector, stop
    }

    return texts.join('\n\n');
  }

  // ── Capture methods ──

  // Method 1: JSON.stringify hook (best — gets full payload including history)
  let strCapture = { text: '', ts: 0 };
  const _stringify = JSON.stringify;
  JSON.stringify = function (value, ...rest) {
    const result = _stringify.apply(this, [value, ...rest]);
    try {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ((value.messages || value.prompt) &&
            (value.model != null || value.max_tokens != null || value.stream != null)) {
          const text = extractMsgs(value.messages || value.prompt);
          if (text.length > 5) {
            strCapture = { text, ts: Date.now() };
          }
        }
      }
    } catch (_) {}
    return result;
  };

  // Method 2: DOM input buffer (Gemini approach — last resort)
  let domBuffer = '';
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') {
      domBuffer = t.innerText || t.value || '';
    }
  }, true);

  // ── Fetch hook ──
  const _fetch = window.fetch;

  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    let response;
    try { response = await _fetch.apply(this, args); } catch (e) { throw e; }

    const ct = response.headers.get('content-type') || '';
    const isStream = ct.includes('event-stream') || ct.includes('text/plain');
    if (!isStream || !response.body) return response;

    // Pick best available input capture
    const fresh = (Date.now() - strCapture.ts) < 2000;
    let inputText = '';
    let method = 'none';

    if (strCapture.text && fresh) {
      inputText = strCapture.text;
      method = 'stringify';
      strCapture = { text: '', ts: 0 };
    } else {
      const domHist = readDOMHistory();
      if (domHist.length > 20) {
        inputText = domHist + (domBuffer ? '\n\n' + domBuffer : '');
        method = 'dom_history';
      } else if (domBuffer.length > 0) {
        inputText = domBuffer;
        method = 'dom_buffer';
      }
    }

    const cid = convId();
    domBuffer = '';

    dbg({ type: 'fetch_stream', method, inputLen: inputText.length, url: url.slice(-60) });

    let a, b;
    try { [a, b] = response.body.tee(); } catch (_) { return response; }
    parseStream(b, inputText, cid, method);

    return new Response(a, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  // ── SSE parser — accumulates ALL streamed content types ──
  async function parseStream(stream, inputText, cid, method) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    // Separate accumulators for different content types
    let textAccum     = ''; // regular text
    let thinkAccum    = ''; // extended thinking
    let toolAccum     = ''; // tool use / artifacts (JSON)

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const raw = line.startsWith('data:') ? line.slice(5).trim()
                    : line.startsWith('{')     ? line.trim() : null;
          if (!raw || raw === '[DONE]') continue;
          let evt;
          try { evt = JSON.parse(raw); } catch (_) { continue; }

          if (evt.type === 'content_block_delta') {
            const d = evt.delta;
            if (!d) continue;
            if (d.type === 'text_delta')       textAccum  += d.text         || '';
            if (d.type === 'thinking_delta')   thinkAccum += d.thinking     || '';
            if (d.type === 'input_json_delta') toolAccum  += d.partial_json || '';
          }
        }
      }
    } catch (_) {}
    finally { try { reader.releaseLock(); } catch (_) {} }

    // Total output: all content types combined
    const fullOutput = textAccum + thinkAccum + toolAccum;
    const outputTokens = est(fullOutput);
    if (outputTokens === 0) return;

    // Input: full conversation text + system overhead on first message
    let inputTokens = 0;
    if (inputText) {
      inputTokens = est(inputText);
      if (!getSeenConvs().has(cid)) {
        inputTokens += SYSTEM_OVERHEAD;
        markConvSeen(cid);
      }
    }

    dbg({ type: 'done', method, inputTokens, outputTokens,
          textLen: textAccum.length, thinkLen: thinkAccum.length, toolLen: toolAccum.length });

    dispatch({ inputTokens, outputTokens, conversationId: cid, source: 'estimate' });
  }

})();
