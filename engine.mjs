// Taleforge engine. Copyright (c) 2026 Andres Wetzel. All rights reserved.
//
// SOURCE-AVAILABLE, NON-COMMERCIAL LICENSE — NOT OPEN-SOURCE.
// This source is published for transparency and personal play. You may
// read it, audit it, and run it in your browser to play stories hosted
// at taleforge.pages.dev. You may NOT redistribute, rehost, fork as a
// competing service, or use this code in any commercial product without
// prior written permission. The Taleforge Story Builder is a separate
// commercial product and is NOT covered by any rights granted here.
// See LICENSE for full terms. Commercial inquiries: bandurria.apps@gmail.com

import {
  generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, SimplePool, nip19, nip04
} from 'https://esm.sh/nostr-tools@2.7.2';

const FALLBACK_STORY = {
  "schema_version": "0.26",
  "meta": {
    "id": "engine-fallback",
    "title": "Engine Diagnostic",
    "author": "Taleforge engine",
    "version": "0.0.1",
    "language": "en",
    "tone": "diagnostic",
    "creative_license": "strict",
    "starting_location": "fallback_room",
    "starting_inventory": [],
    "starting_materials": {},
    "starting_gold": 0,
    "starting_sparks": 0,
    "starting_skills": [],
    "starting_life": 100,
    "life_max": 100,
    "life_decay_per_turn": 0,
    "carry_capacity": 40,
    "sparks_per_craft": 0,
    "turns_per_day": 96,
    "weather_pool": ["clear"],
    "tags": ["diagnostic"],
    "license": { "type": "cc-by", "free": true }
  },
  "rooms": {
    "fallback_room": {
      "name": "Engine Diagnostic Room",
      "summary": "No story files could be loaded. Check that manifest.json is reachable, that the JSON files alongside it parse, and that the network can reach this origin. Type \"reload engine\" to retry, or \"stories\" to open the picker (which may also be empty).",
      "tone_hints": ["diagnostic", "spare"],
      "exits": {},
      "items": [],
      "npcs": [],
      "tags": ["diagnostic"]
    }
  },
  "items": {},
  "npcs": {},
  "riddles": {},
  "skills": {},
  "recipes": {},
  "entities": {},
  "events": {},
  "quests": {}
};

const ACTIVE_STORY_KEY = 'nstadv:active_story_id';
const CUSTOM_STORY_PREFIX = 'nstadv:custom_story:';
const PAID_STORIES_KEY = 'nstadv:paid_stories';
const BUG_REPORT_EMAIL = 'bandurria.apps@gmail.com';
const ENGINE_VERSION_LABEL = 'v0.55.1';

function loadPaidStories() {
  try { return new Set(JSON.parse(localStorage.getItem(PAID_STORIES_KEY) || '[]')); }
  catch { return new Set(); }
}
function markStoryPaid(id) {
  const set = loadPaidStories();
  set.add(id);
  try { localStorage.setItem(PAID_STORIES_KEY, JSON.stringify([...set])); } catch {}
}
function canEnterTrialRoom(roomId) {
  const story = (typeof STORY !== 'undefined') ? STORY : null;
  if (!story?.meta) return true;
  const lic = story.meta.license || {};
  if (!lic.price_sats || lic.price_sats <= 0) return true;
  if (!Array.isArray(lic.trial_rooms) || lic.trial_rooms.length === 0) return true;
  if (lic.trial_rooms.includes(roomId)) return true;
  if (roomId === story.meta.starting_location) return true;
  if (isStoryPaid(story.meta.id)) return true;
  return false;
}
function isStoryPaid(id) {
  return loadPaidStories().has(id);
}

const MANIFEST_URL = './manifest.json';
const EXTRA_STORY_URLS = ['./whispering-forest.json', './hollow-forest.json', './saltbound.json'];

const BUILTIN_STORIES = {};

const marketplaceStories = new Map();

const STORY_SOURCE_URL = new Map();

async function loadExtraStoriesIntoBuiltin() {
  let urls = [];
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (res.ok) {
      const m = await res.json();
      if (m && Array.isArray(m.stories) && m.stories.length > 0) {
        urls = m.stories.filter(u => typeof u === 'string');
      }
    }
  } catch {  }
  if (urls.length === 0) urls = EXTRA_STORY_URLS;

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) continue;
      const story = await res.json();
      const id = story?.meta?.id;
      const start = story?.meta?.starting_location;
      if (!id || !story?.meta?.title || !start || !story?.rooms?.[start]) {
        console.warn(`[extra-story] ${url}: missing meta.id / meta.title / starting_location — skipped`);
        continue;
      }
      BUILTIN_STORIES[id] = story;
      STORY_SOURCE_URL.set(id, url);
    } catch (e) {
    }
  }
}

const ENGINE_UPDATE_DISMISS_KEY = 'taleforge:engine_update_dismissed';
// Engine v0.51.1 — Tier D18: short changelog digest, mapped per version.
// Shown once post-reload when the engine version changes from what the
// player last played. Keep entries punchy — 1-2 lines, what they'll
// notice from the player's seat.
const ENGINE_CHANGELOG = {
  'v0.55.1': 'Age-gate fires at picker click time (visible immediately, not after the overlay closes). Stored acks now expire after 30 days; raising a story\'s minimum_age also re-prompts. New `forgetage` command clears stored acks for testing. Copyright bumped to 2026.',
  'v0.55':   'Engine source extracted to engine.mjs (game.html is now a 20KB shell). Right-clicking the page no longer captures the engine. Builder type-sync + service worker updated to fetch the new path.',
  'v0.54':   'Endings completionist sidebar widget. Marketplace stories now respect picker filters/search. Map legend in zoom modal. Cross-device endings sync via Nostr (kind-30433, encrypted). Magic-link character handoff (`share` command, ?nsec=… URLs, QR codes). Builder gained AI region + AI quest-chain scaffolders.',
  'v0.53':   'WS reconnect with exponential backoff. Marketplace preview modal. Sidebar bounty tracker. Cold-backup character (`backup` / `restore`). `fight` auto-attack command. Hollow Forest now has 3 endings (HUMAN / VAMPIRE / WEREWOLF); Whispering Forest gained 4 (PILGRIM / MASTER_SMITH / FOREST_WARDEN / TRUSTED_MERCHANT). Builder learned to author endings via dedicated UI.',
  'v0.52':   'Quest-chain DAG with ending markers + renown gates. State events now gzip-compressed (smaller character-state payloads). New `whatsnew` / `changelog` command. Engine ↔ builder type-sync hint pill.',
  'v0.51':   'Picker filters + sort + story preview. Map zoom/pan modal (`mapview`). `inv <pattern>` and `recipes <pattern>` filters. Characters dialog from picker. Auto-fix buttons on validation errors.',
  'v0.50.1': 'Saltbound: weather pool now accepts `hot` and `storm` (storm behaves like rain for fires/yields).',
  'v0.50':   'Engine slimmed by 25% (dropped dormant DE i18n + stripped comments).',
  'v0.49':   'Font-size control. Time-of-day color tint. Service-worker reload handshake. First-time + count-based milestone toasts. Color-coded world feed.',
  'v0.48':   'Whispering Forest decoupled from the engine (fixes picker tags being stale).',
  'v0.47':   'Theme switcher (dark/light/sepia/contrast). Bulk ops in builder. Skill-tree visualization.',
  'v0.46':   'Quest-tracker click-to-open. Sidebar inactive-section collapse. Picker random "Surprise me" button.',
  'v0.45':   'Age-gate / content-warning ack screen on first play of a story with `minimum_age`.',
  'v0.44':   'Quick-equip shortcuts. Equipment-diff preview before swap. `who am i` / `profile` view. Picker content-warning labels.',
  'v0.43':   'Saltbound overhead-layer map fixed. Cross-layer exits now render as ⇡⇣⇢⇠ stair markers.',
  'v0.42':   'Achievement unlock celebration banner. Renown tier-up celebration. Combat HP bar in sidebar. Chat-feed channel filter.',
  'v0.41':   'Engine version detection (manifest.json declares engine_version; engine prompts reload on mismatch).',
  'v0.40':   'Ending detection + post-ending overlay + cross-run meta-progression.',
};
const LAST_PLAYED_ENGINE_KEY = 'taleforge:last_played_engine';

function showWhatsNewIfUpdated() {
  try {
    const last = localStorage.getItem(LAST_PLAYED_ENGINE_KEY);
    const current = ENGINE_VERSION_LABEL;
    if (!last) {
      // First-ever boot — silently set the marker.
      localStorage.setItem(LAST_PLAYED_ENGINE_KEY, current);
      return;
    }
    if (last === current) return;
    // Engine has changed — collect changelog entries between last and current.
    const versions = Object.keys(ENGINE_CHANGELOG);
    // Order in ENGINE_CHANGELOG is newest → oldest. Take everything strictly above `last`.
    const since = [];
    for (const v of versions) {
      if (v === last) break;
      since.push(v);
    }
    localStorage.setItem(LAST_PLAYED_ENGINE_KEY, current);
    if (since.length === 0) return;
    setTimeout(() => {
      try {
        write('');
        write(`=== Engine updated: ${last} → ${current} ===`, 'title');
        for (const v of since) {
          write(`  ${v}: ${ENGINE_CHANGELOG[v]}`, 'spark');
        }
        write(`(Type "whatsnew" any time to see this again.)`, 'echo');
      } catch {}
    }, 1500);
  } catch {}
}

function showWhatsNewCommand() {
  write('=== Engine changelog ===', 'title');
  const versions = Object.keys(ENGINE_CHANGELOG);
  for (const v of versions.slice(0, 12)) {
    write(`  ${v === ENGINE_VERSION_LABEL ? '★ ' : '  '}${v}: ${ENGINE_CHANGELOG[v]}`, v === ENGINE_VERSION_LABEL ? 'success' : 'system');
  }
  if (versions.length > 12) write(`  …and ${versions.length - 12} earlier versions.`, 'echo');
  write('── end ──', 'echo');
}

async function checkForEngineUpdate({ silentIfSame = true } = {}) {
  try {
    const res = await fetch('./manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const manifest = await res.json();
    const remote = manifest?.engine_version;
    if (!remote || typeof remote !== 'string') return;
    const local = ENGINE_VERSION_LABEL;
    if (remote === local) {
      if (!silentIfSame) write(`[Engine is on the latest: ${local}.]`, 'system');
      return;
    }
    const dismissed = sessionStorage.getItem(ENGINE_UPDATE_DISMISS_KEY);
    if (dismissed === remote) return;
    sessionStorage.setItem(ENGINE_UPDATE_DISMISS_KEY, remote);
    write('');
    write(`[Engine update available: ${remote} (you have ${local}). Type \`reload engine\` to fetch the new build.]`, 'spark');
    try {
      showToast(`Engine ${remote} is out — reload to update`, 'engine', {
        celebrate: false,
        tag: 'Update available',
        subtitle: `You have ${local}. Click here or type "reload engine".`
      });
      const stack = document.getElementById('toast-stack');
      const last = stack?.lastElementChild;
      if (last) last.addEventListener('click', () => { try { reloadEngine(); } catch {} }, { once: true });
    } catch {}
  } catch {  }
}
function reloadEngine() {
  write('Reloading engine — your character state is saved on Nostr and locally.', 'system');
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage('CLEAR_HTML_CACHE');
      navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
    }
  } catch {}
  setTimeout(() => {
    try { location.reload(); } catch {}
  }, 600);
}

async function checkForStoryUpdate({ silentIfSame = true } = {}) {
  if (typeof STORY === 'undefined' || !STORY?.meta?.id) return;
  const id = STORY.meta.id;
  const url = STORY_SOURCE_URL.get(id);
  if (!url) {
    if (!silentIfSame) write('[This story is bundled with the engine. Hard-refresh the page for engine + story updates.]', 'system');
    return;
  }
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return;
    const fresh = await res.json();
    if (!fresh?.meta?.version) return;
    const cur = STORY.meta.version || '?';
    const next = fresh.meta.version;
    if (cur === next) {
      if (!silentIfSame) write(`[You're on the latest: ${fresh.meta.title} v${cur}.]`, 'system');
      return;
    }
    write(`[Update available: ${fresh.meta.title} v${next} (you have v${cur}). Type \`reload story\` to apply.]`, 'spark');
  } catch {  }
}

async function reloadStory() {
  if (typeof STORY === 'undefined' || !STORY?.meta?.id) {
    write('No story loaded.', 'error');
    return;
  }
  const id = STORY.meta.id;
  const url = STORY_SOURCE_URL.get(id);
  if (!url) {
    write('This story is bundled with the engine — hard-refresh the page (Cmd/Ctrl+Shift+R) to get the latest engine + bundled story.', 'error');
    return;
  }
  write('Fetching latest…', 'system');
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fresh = await res.json();
    const err = validateStoryShape(fresh);
    if (err) throw new Error(err);
    const oldVersion = STORY.meta.version || '?';
    const newVersion = fresh.meta.version || '?';
    for (const k of Object.keys(STORY)) delete STORY[k];
    Object.assign(STORY, fresh);
    BUILTIN_STORIES[id] = fresh;
    if (!STORY.rooms?.[player.location]) {
      const fallback = STORY.meta?.starting_location;
      if (fallback && STORY.rooms?.[fallback]) {
        write(`[Note: your previous location no longer exists in the new version. Moved to ${STORY.rooms[fallback].name || fallback}.]`, 'system');
        player.location = fallback;
      }
    }
    write(`[Story reloaded: ${fresh.meta.title} v${oldVersion} → v${newVersion}.]`, 'success');
    if (typeof describeRoom === 'function') describeRoom();
  } catch (e) {
    write(`Failed to reload: ${e.message}`, 'error');
  }
}

function listAllStoryOptions() {
  const out = [];
  for (const [id, s] of Object.entries(BUILTIN_STORIES)) {
    out.push({ id, label: (s.meta?.title || id) + ' (built-in)', source: 'builtin', story: s });
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(CUSTOM_STORY_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        const s = JSON.parse(raw);
        if (s?.meta?.id) out.push({ id: s.meta.id, label: (s.meta.title || s.meta.id) + ' (yours)', source: 'custom', story: s });
      } catch {}
    }
  } catch {}
  const localIds = new Set(out.map(o => o.id));
  for (const [id, listing] of marketplaceStories) {
    if (localIds.has(id)) continue;
    out.push({
      id,
      label: (listing.title || id) + ' (marketplace)',
      source: 'marketplace',
      listing
    });
  }
  return out;
}

function loadStoryById(id) {
  if (!id) return null;
  if (BUILTIN_STORIES[id]) return BUILTIN_STORIES[id];
  try {
    const raw = localStorage.getItem(CUSTOM_STORY_PREFIX + id);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveCustomStory(story) {
  const id = story?.meta?.id;
  if (!id) throw new Error('story is missing meta.id');
  if (BUILTIN_STORIES[id]) throw new Error(`id "${id}" collides with a built-in story; rename it`);
  localStorage.setItem(CUSTOM_STORY_PREFIX + id, JSON.stringify(story));
  return id;
}

function validateStoryShape(s) {
  if (!s || typeof s !== 'object') return 'not an object';
  if (!s.meta || typeof s.meta !== 'object') return 'missing meta';
  if (!s.meta.id) return 'missing meta.id';
  if (!s.meta.title) return 'missing meta.title';
  if (!s.rooms || typeof s.rooms !== 'object') return 'missing rooms';
  if (!s.meta.starting_location) return 'missing meta.starting_location';
  if (!s.rooms[s.meta.starting_location]) return `meta.starting_location "${s.meta.starting_location}" is not a defined room`;
  return null;
}

const _storyCountsCache = { ts: 0, counts: null };
async function fetchStoryPlayerCounts() {
  const PICKER_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
  const KIND_ACTION_PICKER = 30420;
  const QUERY_TIMEOUT_PICKER = 4000;
  if (_storyCountsCache.counts && Date.now() - _storyCountsCache.ts < 5 * 60 * 1000) {
    return _storyCountsCache.counts;
  }
  const since = Math.floor((Date.now() - 30 * 86400000) / 1000);
  const perStory = new Map();
  function tally(ev) {
    const tTag = (ev.tags || []).find(x => x[0] === 't');
    if (!tTag || !tTag[1]) return;
    const m = String(tTag[1]).match(/^story:(.+)$/);
    if (!m) return;
    const storyId = m[1];
    if (!perStory.has(storyId)) perStory.set(storyId, new Set());
    perStory.get(storyId).add(ev.pubkey);
  }
  await Promise.all(PICKER_RELAYS.map(url => new Promise(resolve => {
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };
    let ws;
    try { ws = new WebSocket(url); } catch { return finish(); }
    const timer = setTimeout(() => { try { ws.close(); } catch {} finish(); }, QUERY_TIMEOUT_PICKER - 200);
    const sub = 'pc' + Math.random().toString(36).slice(2, 8);
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(['REQ', sub, { kinds: [KIND_ACTION_PICKER], since, limit: 5000 }]));
      } catch {}
    };
    ws.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data);
        if (d[0] === 'EVENT' && d[2]?.kind === KIND_ACTION_PICKER) tally(d[2]);
        else if (d[0] === 'EOSE') {
          try { ws.close(); } catch {}
          clearTimeout(timer);
          finish();
        }
      } catch {}
    };
    ws.onerror = () => { clearTimeout(timer); try { ws.close(); } catch {} finish(); };
    ws.onclose = () => { clearTimeout(timer); finish(); };
  })));
  const counts = {};
  for (const [storyId, set] of perStory) counts[storyId] = set.size;
  _storyCountsCache.ts = Date.now();
  _storyCountsCache.counts = counts;
  return counts;
}

function showStoryPicker(currentId = null) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;color:#e8e6e3;';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1815;border:1px solid #3a352e;border-radius:8px;max-width:640px;width:100%;max-height:90vh;overflow:auto;padding:24px;';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px;flex-wrap:wrap;">
        <div style="font-size:20px;font-weight:bold;">Pick a story</div>
        <div style="display:flex;gap:6px;">
          <button id="picker-chars" title="Switch between characters saved on this browser." style="background:#23201c;border:1px solid #3a352e;color:#bcb4a8;border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px;">👤 Characters</button>
          <button id="picker-random" title="Pick a random non-trial, non-age-gated story." style="background:#23201c;border:1px solid #3a352e;color:#f0b54a;border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px;">⚄ Surprise me</button>
        </div>
      </div>
      <div style="color:#9c9388;font-size:13px;margin-bottom:16px;">Each story is its own world with its own character. You can switch any time with the <code>switch story</code> command.</div>
      <div id="picker-continue" style="margin-bottom:14px;"></div>
      <div id="picker-controls" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;font-size:12px;color:#9c9388;">
        <input id="picker-search" type="text" placeholder="search title / author / tag…" style="flex:1;min-width:160px;background:#0c0e10;border:1px solid #3a352e;color:#e8e6e3;border-radius:4px;padding:5px 8px;font:inherit;font-size:12px;">
        <select id="picker-sort" title="Sort order" style="background:#0c0e10;border:1px solid #3a352e;color:#e8e6e3;border-radius:4px;padding:5px 7px;font:inherit;font-size:12px;">
          <option value="recent">Sort: most recent</option>
          <option value="endings">Sort: endings reached</option>
          <option value="alpha">Sort: A → Z</option>
          <option value="rooms">Sort: world size</option>
        </select>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input id="picker-hide-cw" type="checkbox" style="margin:0;"> hide age-gated</label>
      </div>
      <div id="picker-tagchips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;"></div>
      <div id="story-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;"></div>
      <div id="picker-msg" style="margin-top:10px;color:#f0b54a;font-size:13px;min-height:16px;"></div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Engine v0.55.1 — age-gate fires AT click time, inside the picker.
    // Previously the picker resolved first, then the gate fired afterward;
    // that hid the gate from users who were watching the picker for
    // confirmation. Now: clicking an age-gated card opens the gate over the
    // picker; declining keeps you in the picker (no flash).
    async function pick(id) {
      const story = loadStoryById(id);
      if (story && !hasAgeAck(story)) {
        const ok = await showAgeGateModal(story);
        if (!ok) return;  // stay in the picker
      }
      try { localStorage.setItem(ACTIVE_STORY_KEY, id); } catch {}
      overlay.remove();
      resolve(id);
    }

    // Tier B8: characters dialog from picker.
    const charsBtn = panel.querySelector('#picker-chars');
    if (charsBtn) {
      charsBtn.addEventListener('click', () => {
        showCharactersDialog();
      });
    }
    const randBtn = panel.querySelector('#picker-random');
    if (randBtn) {
      randBtn.addEventListener('click', () => {
        const all = listAllStoryOptions().filter(o => {
          if (o.id === currentId) return false;
          const m = o.story?.meta || {};
          if (m.minimum_age > 0 && !hasAgeAck(o.story)) return false;
          return true;
        });
        if (all.length === 0) {
          const msg = panel.querySelector('#picker-msg');
          if (msg) msg.textContent = 'No eligible stories to surprise you with right now.';
          return;
        }
        const choice = all[Math.floor(Math.random() * all.length)];
        pick(choice.id);
      });
    }

    try {
      const continueWrap = panel.querySelector('#picker-continue');
      const lastId = localStorage.getItem(ACTIVE_STORY_KEY);
      if (continueWrap && lastId && lastId !== currentId) {
        const lastStory = loadStoryById(lastId);
        if (lastStory) {
          const lastTitle = (typeof lastStory.meta?.title === 'string') ? lastStory.meta.title : (lastStory.meta?.title?.en || lastId);
          const cBtn = document.createElement('button');
          cBtn.style.cssText = 'width:100%;text-align:left;padding:12px 14px;background:#2a3528;border:2px solid #f0b54a;color:#e8e6e3;border-radius:4px;cursor:pointer;font:inherit;display:flex;align-items:center;gap:10px;';
          cBtn.innerHTML = `<span style="font-size:20px;color:#f0b54a;">▶</span><span><strong style="color:#f0b54a;">Continue</strong> <em style="color:#bcb4a8;">${escapeHtml(lastTitle)}</em><br><span style="font-size:11px;color:#9c9388;">last active story on this browser</span></span>`;
          cBtn.addEventListener('click', () => pick(lastId));
          continueWrap.appendChild(cBtn);
        }
      }
    } catch {}

    const listEl = panel.querySelector('#story-list');
    let _liveCounts = null;
    fetchStoryPlayerCounts().then(c => {
      _liveCounts = c;
      for (const row of listEl.querySelectorAll('[data-story-count-id]')) {
        const id = row.getAttribute('data-story-count-id');
        const n = (_liveCounts && _liveCounts[id]) || 0;
        if (n >= 5) {
          row.textContent = `${n} traveler${n === 1 ? '' : 's'} in this world (last 30d)`;
        }
      }
    }).catch(() => {  });
    // Tier A4: picker filter+sort state.
    const pickerState = {
      search: '',
      sort: 'recent',
      hideCW: false,
      tagFilter: null
    };
    try { pickerState.sort = localStorage.getItem('taleforge:picker:sort') || 'recent'; } catch {}
    try { pickerState.hideCW = localStorage.getItem('taleforge:picker:hideCW') === '1'; } catch {}
    const searchEl = panel.querySelector('#picker-search');
    const sortEl = panel.querySelector('#picker-sort');
    const hideCwEl = panel.querySelector('#picker-hide-cw');
    if (searchEl) searchEl.addEventListener('input', () => { pickerState.search = searchEl.value.toLowerCase(); renderList(); });
    if (sortEl) {
      sortEl.value = pickerState.sort;
      sortEl.addEventListener('change', () => { pickerState.sort = sortEl.value; try { localStorage.setItem('taleforge:picker:sort', sortEl.value); } catch {} renderList(); });
    }
    if (hideCwEl) {
      hideCwEl.checked = pickerState.hideCW;
      hideCwEl.addEventListener('change', () => { pickerState.hideCW = hideCwEl.checked; try { localStorage.setItem('taleforge:picker:hideCW', hideCwEl.checked ? '1' : '0'); } catch {} renderList(); });
    }
    function renderTagChips() {
      const wrap = panel.querySelector('#picker-tagchips');
      if (!wrap) return;
      wrap.innerHTML = '';
      const allOpts = listAllStoryOptions();
      const tagSet = new Set();
      for (const o of allOpts) {
        const tags = (o.source === 'marketplace') ? (o.listing?.tags || []) : (o.story?.meta?.tags || []);
        for (const t of tags) tagSet.add(t);
      }
      const tags = [...tagSet].sort();
      if (tags.length === 0) return;
      const allChip = document.createElement('span');
      allChip.textContent = 'all';
      const isAllActive = !pickerState.tagFilter;
      allChip.style.cssText = 'font-size:10px;padding:3px 9px;border-radius:9px;cursor:pointer;background:' + (isAllActive ? '#4a6a3a' : '#23201c') + ';color:' + (isAllActive ? '#e8e6e3' : '#9c9388') + ';border:1px solid #4a6a3a;text-transform:lowercase;';
      allChip.onclick = () => { pickerState.tagFilter = null; renderList(); };
      wrap.appendChild(allChip);
      for (const tg of tags) {
        const chip = document.createElement('span');
        chip.textContent = tg;
        const active = pickerState.tagFilter === tg;
        chip.style.cssText = 'font-size:10px;padding:3px 9px;border-radius:9px;cursor:pointer;background:' + (active ? '#4a6a3a' : '#2a3528') + ';color:' + (active ? '#e8e6e3' : '#a8c7a0') + ';border:1px solid #4a6a3a;text-transform:lowercase;';
        chip.onclick = () => { pickerState.tagFilter = active ? null : tg; renderList(); };
        wrap.appendChild(chip);
      }
    }

    // Tier A5: story preview modal — opened from the "preview" link on a card.
    function showStoryPreview(opt) {
      const m = opt.story?.meta || {};
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;color:#e8e6e3;';
      const pn = document.createElement('div');
      pn.style.cssText = 'background:#1a1815;border:1px solid #3a352e;border-radius:8px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:22px;';
      const title = (typeof m.title === 'string') ? m.title : (m.title?.en || opt.id);
      const tone = (typeof m.tone === 'string') ? m.tone : (m.tone?.en || '');
      const summary = m.summary ? ((typeof m.summary === 'string') ? m.summary : (m.summary?.en || '')) : '';
      const counts = {
        rooms: Object.keys(opt.story.rooms || {}).length,
        items: Object.keys(opt.story.items || {}).length,
        npcs: Object.keys(opt.story.npcs || {}).length,
        skills: Object.keys(opt.story.skills || {}).length,
        recipes: Object.keys(opt.story.recipes || {}).length,
        entities: Object.keys(opt.story.entities || {}).length,
        quests: Object.keys(opt.story.quests || {}).length,
        events: Object.keys(opt.story.events || {}).length
      };
      const profiles = m.character_profiles || {};
      const profileList = Object.entries(profiles).map(([pid, p]) => `${p.display || pid}`).join(', ');
      const tags = Array.isArray(m.tags) ? m.tags : [];
      const cws = Array.isArray(m.content_warnings) ? m.content_warnings : [];
      const ageStr = m.minimum_age ? `<div style="color:#c08070;font-size:12px;margin-bottom:8px;">⚠ minimum age: ${m.minimum_age}</div>` : '';
      const globalEndings = (typeof loadGlobalEndings === 'function') ? loadGlobalEndings() : {};
      const reachedList = (globalEndings[opt.id] || []);
      pn.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <div style="font-size:18px;font-weight:bold;">${escapeHtml(title)}</div>
          <button id="pv-close" style="background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;padding:4px 10px;font:inherit;font-size:13px;cursor:pointer;">×</button>
        </div>
        <div style="color:#9c9388;font-size:12px;margin-bottom:10px;">v${m.version || '?'} · author: ${escapeHtml(m.author || '—')} · license: ${m.creative_license || '—'}</div>
        ${ageStr}
        ${tone ? `<div style="font-style:italic;color:#bcb4a8;font-size:13px;margin-bottom:10px;">${escapeHtml(tone)}</div>` : ''}
        ${summary ? `<div style="margin-bottom:12px;font-size:13px;line-height:1.5;">${escapeHtml(summary)}</div>` : ''}
        <div style="margin-bottom:10px;font-size:12px;color:#bcb4a8;">
          <strong style="color:#e8e6e3;">World size:</strong> ${counts.rooms} rooms · ${counts.npcs} NPCs · ${counts.items} items · ${counts.entities} entities<br>
          ${counts.quests} quests · ${counts.skills} skills · ${counts.recipes} recipes · ${counts.events} events
        </div>
        ${profileList ? `<div style="margin-bottom:10px;font-size:12px;"><strong style="color:#e8e6e3;">Character profiles:</strong> <span style="color:#bcb4a8;">${escapeHtml(profileList)}</span></div>` : ''}
        ${tags.length ? `<div style="margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px;">${tags.map(t => `<span style="font-size:10px;padding:2px 7px;border-radius:9px;background:#2a3528;color:#a8c7a0;border:1px solid #4a6a3a;">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${cws.length ? `<div style="margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;"><span style="font-size:10px;color:#c08070;text-transform:uppercase;">⚠ content:</span>${cws.map(c => `<span style="font-size:10px;padding:2px 7px;border-radius:9px;background:#3a2520;color:#e0a890;border:1px solid #6a4a3a;">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
        ${reachedList.length ? `<div style="margin-top:10px;font-size:12px;color:#f0b54a;"><strong>★ Endings reached on this browser (${reachedList.length}):</strong> ${reachedList.map(e => escapeHtml(e)).join(', ')}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button id="pv-cancel" style="padding:6px 14px;background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;font:inherit;cursor:pointer;">Back</button>
          <button id="pv-pick" style="padding:6px 14px;background:#c79b3a;border:none;color:#1a1408;border-radius:4px;font:inherit;font-weight:600;cursor:pointer;">▶ Play this story</button>
        </div>
      `;
      ov.appendChild(pn);
      document.body.appendChild(ov);
      pn.querySelector('#pv-close').onclick = () => ov.remove();
      pn.querySelector('#pv-cancel').onclick = () => ov.remove();
      pn.querySelector('#pv-pick').onclick = () => { ov.remove(); pick(opt.id); };
      ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.remove(); });
    }

    // Tier A1: marketplace listing preview — shows the listing metadata
    // (title, author, version, license/price, description) before the
    // player commits to fetching the full JSON.
    function showMarketplacePreview(li) {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;color:#e8e6e3;';
      const pn = document.createElement('div');
      pn.style.cssText = 'background:#1a1815;border:1px solid #3a352e;border-radius:8px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:22px;';
      let shortNpub = '';
      try { const np = nip19.npubEncode(li.author_pubkey); shortNpub = np.slice(0, 14) + '…' + np.slice(-8); } catch {}
      const priceSats = li.license?.price_sats || 0;
      const verifiedBadge = li.verified ? '<span style="color:#6dc28d;font-size:12px;font-weight:normal;">✓ verified signature</span>' : '<span style="color:#9c9388;font-size:12px;font-weight:normal;">unsigned</span>';
      pn.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <div style="font-size:18px;font-weight:bold;">${escapeHtml(li.title || li.id)}</div>
          <button id="mv-close" style="background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;padding:4px 10px;font:inherit;font-size:13px;cursor:pointer;">×</button>
        </div>
        <div style="color:#9c9388;font-size:12px;margin-bottom:4px;">v${escapeHtml(li.version || '?')} · author: ${escapeHtml(li.author || 'anon')}</div>
        <div style="color:#bcb4a8;font-size:11px;margin-bottom:10px;font-family:monospace;">${escapeHtml(shortNpub)}</div>
        <div style="margin-bottom:10px;">${verifiedBadge}</div>
        <div style="margin-bottom:10px;font-size:13px;">License: ${priceSats > 0 ? `<strong style="color:#f0b54a;">${priceSats} sats</strong>` : '<strong style="color:#6dc28d;">free</strong>'}${li.license?.payment_url ? ` <span style="color:#9c9388;">(${escapeHtml(new URL(li.license.payment_url).host)})</span>` : ''}</div>
        ${li.description ? `<div style="font-size:13px;line-height:1.5;color:#bcb4a8;background:#0c0e10;padding:10px;border-radius:4px;border-left:3px solid #4a6a3a;margin-bottom:12px;">${escapeHtml(li.description)}</div>` : ''}
        <div style="font-size:11px;color:#7a7367;margin-bottom:12px;">Hosted at: <code style="color:#bcb4a8;font-size:11px;">${escapeHtml(li.url || '?')}</code></div>
        <div style="background:#23201c;padding:10px;border-radius:4px;margin-bottom:12px;font-size:12px;color:#9c9388;">
          <strong style="color:#bcb4a8;">⚠ Marketplace stories</strong> are user-contributed. The engine validates the JSON shape on import, but content is the author's responsibility. Verified signatures attest to authorship, not safety.
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="mv-cancel" style="padding:6px 14px;background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;font:inherit;cursor:pointer;">Back to list</button>
        </div>
      `;
      ov.appendChild(pn);
      document.body.appendChild(ov);
      pn.querySelector('#mv-close').onclick = () => ov.remove();
      pn.querySelector('#mv-cancel').onclick = () => ov.remove();
      ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.remove(); });
    }

    function renderList() {
      renderTagChips();
      listEl.innerHTML = '';
      const allOpts = listAllStoryOptions();
      // Apply search/tag/cw filters
      // Tier A2: marketplace listings respect the same filters as local stories.
      // Marketplace cards expose `o.listing` (no full story); read tags/title/author from there.
      function passes(o) {
        const isMarket = o.source === 'marketplace';
        const m = isMarket ? (o.listing || {}) : (o.story?.meta || {});
        const tags = Array.isArray(m.tags) ? m.tags : [];
        if (pickerState.hideCW && (m.minimum_age > 0 || (Array.isArray(m.content_warnings) && m.content_warnings.length > 0))) {
          // Marketplace listings may declare CWs without ages; treat both as gateable.
          if (!isMarket || m.minimum_age > 0) return false;
        }
        if (pickerState.tagFilter) {
          if (!tags.includes(pickerState.tagFilter)) return false;
        }
        if (pickerState.search) {
          const haystack = [
            (typeof m.title === 'string') ? m.title : (m.title?.en || ''),
            m.author || '',
            ...tags,
            o.id || '',
            isMarket ? (m.description || '') : ''
          ].join(' ').toLowerCase();
          if (!haystack.includes(pickerState.search)) return false;
        }
        return true;
      }
      // Sort comparator
      const globalEndings = (typeof loadGlobalEndings === 'function') ? loadGlobalEndings() : {};
      function sortKey(o) {
        const m = o.story?.meta || {};
        switch (pickerState.sort) {
          case 'alpha': return ((typeof m.title === 'string') ? m.title : (m.title?.en || '')).toLowerCase();
          case 'endings': return -(globalEndings[o.id]?.length || 0);
          case 'rooms': return -Object.keys(o.story.rooms || {}).length;
          case 'recent': default:
            // Prefer the active story id, then most-recent localStorage write timestamp if available.
            return o.id === currentId ? '0' : ('1_' + ((typeof m.title === 'string') ? m.title : (m.title?.en || '')).toLowerCase());
        }
      }
      let filtered = allOpts.filter(passes);
      filtered.sort((a, b) => {
        const ka = sortKey(a), kb = sortKey(b);
        if (typeof ka === 'number' && typeof kb === 'number') return ka - kb;
        return String(ka).localeCompare(String(kb));
      });
      const marketplace = filtered.filter(o => o.source === 'marketplace');
      const local = filtered.filter(o => o.source !== 'marketplace');
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:14px;color:#9c9388;font-size:13px;text-align:center;';
        empty.textContent = 'No stories match these filters.';
        listEl.appendChild(empty);
        return;
      }
      for (const opt of local) {
        const row = document.createElement('button');
        row.style.cssText = 'text-align:left;padding:12px 14px;background:' + (opt.id === currentId ? '#2a3528' : '#23201c') + ';border:1px solid ' + (opt.id === currentId ? '#4a6a3a' : '#3a352e') + ';color:#e8e6e3;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;gap:2px;font:inherit;';
        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = 'font-weight:bold;';
        const globalEndings = (typeof loadGlobalEndings === 'function') ? loadGlobalEndings() : {};
        const reachedCount = (globalEndings[opt.id] || []).length;
        const badgeStr = reachedCount > 0 ? `  ★${reachedCount}` : '';
        titleSpan.innerHTML = escapeHtml(opt.label)
          + (reachedCount > 0 ? ' <span style="color:#f0b54a;font-weight:600;" title="' + escapeHtml(`Endings reached on this browser: ${(globalEndings[opt.id] || []).join(', ')}`) + '">' + badgeStr + '</span>' : '')
          + (opt.id === currentId ? '  <span style="color:#6dc28d;">✓ (currently playing)</span>' : '');
        const sub = document.createElement('span');
        sub.style.cssText = 'font-size:12px;color:#9c9388;';
        sub.textContent = `${Object.keys(opt.story.rooms || {}).length} rooms · ${Object.keys(opt.story.entities || {}).length} entities · author: ${opt.story.meta?.author || '—'}`;
        const live = document.createElement('span');
        live.style.cssText = 'font-size:11px;color:#6f8a5a;font-style:italic;';
        live.setAttribute('data-story-count-id', opt.id);
        if (_liveCounts && _liveCounts[opt.id] >= 5) {
          const n = _liveCounts[opt.id];
          live.textContent = `${n} traveler${n === 1 ? '' : 's'} in this world (last 30d)`;
        }
        row.append(titleSpan, sub, live);
        const tags = Array.isArray(opt.story.meta?.tags) ? opt.story.meta.tags : [];
        const cws = Array.isArray(opt.story.meta?.content_warnings) ? opt.story.meta.content_warnings : [];
        if (tags.length) {
          const tagRow = document.createElement('div');
          tagRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;';
          for (const tg of tags) {
            const chip = document.createElement('span');
            chip.textContent = tg;
            chip.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:9px;background:#2a3528;color:#a8c7a0;border:1px solid #4a6a3a;text-transform:lowercase;letter-spacing:0.02em;';
            tagRow.appendChild(chip);
          }
          row.appendChild(tagRow);
        }
        if (cws.length) {
          const cwRow = document.createElement('div');
          cwRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;align-items:center;';
          const cwLbl = document.createElement('span');
          cwLbl.textContent = '⚠ content:';
          cwLbl.style.cssText = 'font-size:10px;color:#c08070;text-transform:uppercase;letter-spacing:0.04em;margin-right:2px;';
          cwRow.appendChild(cwLbl);
          for (const cw of cws) {
            const chip = document.createElement('span');
            chip.textContent = cw;
            chip.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:9px;background:#3a2520;color:#e0a890;border:1px solid #6a4a3a;text-transform:lowercase;letter-spacing:0.02em;';
            cwRow.appendChild(chip);
          }
          row.appendChild(cwRow);
        }
        // Tier A5: preview link
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:10px;margin-top:6px;align-items:center;';
        const preview = document.createElement('span');
        preview.textContent = '👁 preview';
        preview.style.cssText = 'color:#9c9388;font-size:11px;cursor:pointer;text-decoration:underline;';
        preview.onclick = (ev) => { ev.stopPropagation(); showStoryPreview(opt); };
        actions.appendChild(preview);
        if (opt.source === 'custom') {
          const del = document.createElement('span');
          del.textContent = 'remove';
          del.style.cssText = 'color:#c66;font-size:11px;cursor:pointer;text-decoration:underline;';
          del.onclick = (ev) => {
            ev.stopPropagation();
            if (!confirm(`Remove "${opt.story.meta?.title || opt.id}" from your library? Character state stays on the relays.`)) return;
            try { localStorage.removeItem(CUSTOM_STORY_PREFIX + opt.id); } catch {}
            renderList();
          };
          actions.appendChild(del);
        }
        row.appendChild(actions);
        row.onclick = () => pick(opt.id);
        listEl.appendChild(row);
      }
      if (marketplace.length > 0) {
        const sep = document.createElement('div');
        sep.style.cssText = 'margin-top:8px;padding:8px 0 4px;border-top:1px solid #3a352e;font-size:11px;color:#9c9388;text-transform:uppercase;letter-spacing:0.05em;';
        sep.textContent = `Marketplace (${marketplace.length} story${marketplace.length === 1 ? '' : ' · published by other players'})`;
        listEl.appendChild(sep);
        for (const opt of marketplace) {
          const li = opt.listing;
          const row = document.createElement('button');
          row.style.cssText = 'text-align:left;padding:12px 14px;background:#23201c;border:1px solid #3a352e;color:#e8e6e3;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;gap:2px;font:inherit;';
          const titleSpan = document.createElement('span');
          titleSpan.style.cssText = 'font-weight:bold;';
          let shortNpub = '';
          try { const np = nip19.npubEncode(li.author_pubkey); shortNpub = np.slice(0, 12) + '…' + np.slice(-6); } catch {}
          const verifiedBadge = li.verified ? ' <span style="color:#6dc28d;">✓ verified</span>' : '';
          titleSpan.innerHTML = (li.title || li.id) + verifiedBadge;
          const sub = document.createElement('span');
          sub.style.cssText = 'font-size:12px;color:#9c9388;';
          const priceTag = (li.license?.price_sats > 0) ? ` · ${li.license.price_sats}⚡` : ' · free';
          sub.textContent = `v${li.version} · ${li.author || 'anon'} (${shortNpub})${priceTag}`;
          row.append(titleSpan, sub);
          if (li.description) {
            const desc = document.createElement('span');
            desc.style.cssText = 'font-size:12px;color:#bcb4a8;margin-top:4px;';
            desc.textContent = li.description.slice(0, 200);
            row.append(desc);
          }
          // Tier A1: preview link on marketplace cards.
          const previewLink = document.createElement('span');
          previewLink.textContent = '👁 preview';
          previewLink.style.cssText = 'color:#9c9388;font-size:11px;cursor:pointer;text-decoration:underline;margin-top:4px;align-self:flex-start;';
          previewLink.onclick = (ev) => { ev.stopPropagation(); showMarketplacePreview(li); };
          row.append(previewLink);
          const priceSats = li.license?.price_sats || 0;
          const paymentUrl = li.license?.payment_url;
          const alreadyPaid = isStoryPaid(li.id);
          if (priceSats > 0 && !alreadyPaid) {
            const buyRow = document.createElement('div');
            buyRow.style.cssText = 'display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;';
            const payBtn = document.createElement('a');
            payBtn.style.cssText = 'padding:4px 10px;background:#f0b54a;color:#1a1408;border-radius:3px;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer;';
            payBtn.textContent = `⚡ Pay ${priceSats} sats`;
            if (paymentUrl) { payBtn.href = paymentUrl; payBtn.target = '_blank'; payBtn.rel = 'noopener'; }
            else { payBtn.href = '#'; payBtn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); alert(`This story is priced at ${priceSats} sats but the author hasn't provided a payment URL. Contact them directly.`); }; }
            const paidBtn = document.createElement('button');
            paidBtn.style.cssText = 'padding:4px 10px;background:#3a352e;color:#bcb4a8;border:1px solid #5a5044;border-radius:3px;font-size:12px;cursor:pointer;font:inherit;';
            paidBtn.textContent = `I've paid → import`;
            paidBtn.onclick = async (ev) => {
              ev.stopPropagation();
              msgEl.style.color = '#9c9388';
              msgEl.textContent = `Fetching ${li.title || li.id}…`;
              try {
                const res = await fetch(li.url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const story = await res.json();
                const err = validateStoryShape(story);
                if (err) { msgEl.textContent = 'Story rejected: ' + err; msgEl.style.color = '#c66'; return; }
                saveCustomStory(story);
                markStoryPaid(li.id);
                msgEl.style.color = '#6dc28d';
                msgEl.textContent = `Imported "${story.meta.title}". Click below to play.`;
                renderList();
              } catch (e) {
                msgEl.style.color = '#c66';
                msgEl.textContent = `Failed to fetch: ${e.message}`;
              }
            };
            buyRow.append(payBtn, paidBtn);
            row.append(buyRow);
            row.onclick = (ev) => {  };
          } else {
            row.onclick = async () => {
              msgEl.style.color = '#9c9388';
              msgEl.textContent = `Fetching ${li.title || li.id} from ${li.url}…`;
              try {
                const res = await fetch(li.url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const story = await res.json();
                const err = validateStoryShape(story);
                if (err) { msgEl.textContent = 'Story rejected: ' + err; msgEl.style.color = '#c66'; return; }
                saveCustomStory(story);
                msgEl.style.color = '#6dc28d';
                msgEl.textContent = `Imported "${story.meta.title}". Click below to play.`;
                renderList();
              } catch (e) {
                msgEl.style.color = '#c66';
                msgEl.textContent = `Failed to fetch: ${e.message}`;
              }
            };
          }
          listEl.appendChild(row);
        }
      }
    }
    renderList();

    const msgEl = panel.querySelector('#picker-msg');
  });
}

function showBugReporter() {
  const debug = {
    engine: ENGINE_VERSION_LABEL,
    story_id: (typeof STORY !== 'undefined' && STORY?.meta?.id) || '?',
    story_version: (typeof STORY !== 'undefined' && STORY?.meta?.version) || '?',
    room: (typeof player !== 'undefined' && player?.location) || '?',
    character: (typeof player !== 'undefined' && player?.name) || '?',
    pubkey_short: (typeof pk !== 'undefined' && pk) ? (pk.slice(0, 12) + '…' + pk.slice(-6)) : '?',
    platform: (navigator.userAgent || '').slice(0, 140),
    locale: navigator.language || '?',
    time: new Date().toISOString()
  };
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;color:#e8e6e3;';
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1815;border:1px solid #3a352e;border-radius:8px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:22px;';
  panel.innerHTML = `
    <div style="font-size:18px;font-weight:bold;margin-bottom:6px;">Report a bug</div>
    <div style="color:#9c9388;font-size:13px;margin-bottom:14px;">Describe what happened, what you expected, and what you saw instead. We'll attach version + room info automatically.</div>
    <textarea id="bug-desc" rows="6" placeholder="What went wrong? What were you doing?" style="width:100%;background:#0c0e10;border:1px solid #3a352e;color:#e8e6e3;border-radius:4px;padding:10px;font:inherit;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
    <div style="margin-top:12px;font-size:11px;color:#7a7367;text-transform:uppercase;letter-spacing:0.04em;">attached debug info</div>
    <pre id="bug-debug" style="margin:6px 0 0;background:#0c0e10;border:1px solid #2a2724;border-radius:4px;padding:10px;font-size:11px;color:#9c9388;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;"></pre>
    <div id="bug-msg" style="margin-top:10px;font-size:12px;min-height:14px;color:#6dc28d;"></div>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;flex-wrap:wrap;">
      <button id="bug-cancel" style="padding:8px 14px;background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;cursor:pointer;font:inherit;">Cancel</button>
      <button id="bug-copy" style="padding:8px 14px;background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;cursor:pointer;font:inherit;">Copy report</button>
      <button id="bug-send" style="padding:8px 14px;background:#c79b3a;border:none;color:#1a1408;border-radius:4px;cursor:pointer;font-weight:600;font:inherit;"></button>
    </div>
  `;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  panel.querySelector('#bug-debug').textContent = JSON.stringify(debug, null, 2);

  const sendBtn = panel.querySelector('#bug-send');
  if (BUG_REPORT_EMAIL) {
    sendBtn.textContent = 'Send via email';
  } else {
    sendBtn.textContent = 'No email configured';
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.4';
    sendBtn.style.cursor = 'default';
  }

  function buildBody(desc) {
    return `${desc.trim() || '(no description)'}\n\n---\nDebug info:\n${JSON.stringify(debug, null, 2)}`;
  }
  function close() { overlay.remove(); }

  panel.querySelector('#bug-cancel').onclick = close;
  panel.querySelector('#bug-copy').onclick = async () => {
    const desc = panel.querySelector('#bug-desc').value;
    const body = buildBody(desc);
    try {
      await navigator.clipboard.writeText(body);
      panel.querySelector('#bug-msg').textContent = 'Copied to clipboard. Paste it wherever you contact the author.';
    } catch {
      panel.querySelector('#bug-msg').style.color = '#c66';
      panel.querySelector('#bug-msg').textContent = 'Clipboard blocked by browser — select the text below and copy manually.';
    }
  };
  if (BUG_REPORT_EMAIL) {
    sendBtn.onclick = () => {
      const desc = panel.querySelector('#bug-desc').value;
      if (!desc.trim()) { panel.querySelector('#bug-msg').style.color = '#c66'; panel.querySelector('#bug-msg').textContent = 'Add a short description first.'; return; }
      const subj = '[TaleForge bug] ' + desc.slice(0, 60).replace(/[\r\n]+/g, ' ');
      const body = buildBody(desc);
      const url = `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
      window.location.href = url;
      panel.querySelector('#bug-msg').textContent = 'Email composer opened. Send it from your mail app.';
    };
  }

  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  setTimeout(() => panel.querySelector('#bug-desc').focus(), 50);
}

const AGE_ACK_KEY_PREFIX = 'taleforge:age_ack:';
// Engine v0.55.1: ack expires after 30 days, even without explicit
// reset-on-version. Industry-standard practice for content-warning gates,
// and ensures the gate is visibly active for testers / new sessions on a
// shared browser. Stories that set `age_gate_resets_on_version: true`
// additionally re-prompt on every version bump.
const AGE_ACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function ageAckKey(storyId) { return AGE_ACK_KEY_PREFIX + storyId; }
function hasAgeAck(story) {
  if (!story?.meta?.id) return true;
  if (!storyNeedsAgeGate(story)) return true;
  try {
    const stored = localStorage.getItem(ageAckKey(story.meta.id));
    if (!stored) return false;
    const obj = JSON.parse(stored);
    // Expire stale acks (30 days).
    const ackedAt = Number(obj?.acknowledged_at) || 0;
    if (!ackedAt || (Date.now() - ackedAt) > AGE_ACK_MAX_AGE_MS) return false;
    // Story-opt-in: re-prompt on every version bump.
    if (story.meta.age_gate_resets_on_version) {
      if (obj?.version !== story.meta.version) return false;
    }
    // If the story raised its minimum_age since the ack, re-prompt.
    const ackedMin = Number(obj?.min_age) || 0;
    const currentMin = Number(story.meta.minimum_age) || 0;
    if (currentMin > ackedMin) return false;
    return true;
  } catch { return false; }
}
// Tier "age-gate fix" — debug helper to clear stored acks so authors and
// testers can verify the gate fires.
function forgetAgeAcksCommand() {
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(AGE_ACK_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) { localStorage.removeItem(k); removed++; }
  } catch {}
  write(`Cleared ${removed} stored age-gate acknowledgement${removed === 1 ? '' : 's'}.`, 'success');
  write('Switch story or reload — the gate will fire again on the next play of any age-gated story.', 'system');
}
function storyNeedsAgeGate(story) {
  const m = story?.meta || {};
  const minAge = Number(m.minimum_age) || 0;
  return minAge > 0 || !!m.age_gate_message;
}
function recordAgeAck(story) {
  if (!story?.meta?.id) return;
  try {
    localStorage.setItem(ageAckKey(story.meta.id), JSON.stringify({
      acknowledged_at: Date.now(),
      version: story.meta.version || null,
      min_age: Number(story.meta.minimum_age) || 0
    }));
  } catch {}
}
function showAgeGateModal(story) {
  return new Promise(resolve => {
    const m = story.meta || {};
    const minAge = Number(m.minimum_age) || 0;
    const customMsg = (typeof m.age_gate_message === 'string') ? m.age_gate_message : (m.age_gate_message?.en || '');
    const cws = Array.isArray(m.content_warnings) ? m.content_warnings : [];
    const tags = Array.isArray(m.tags) ? m.tags : [];
    const title = (typeof m.title === 'string') ? m.title : (m.title?.en || m.id || 'this story');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(8,10,16,0.94);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;color:#e8e6e3;';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:540px;width:100%;background:#1a1815;border:1px solid #c08070;border-radius:8px;padding:24px;box-shadow:0 8px 40px rgba(192,128,112,0.3),0 0 0 1px #c08070 inset;';
    const tag = document.createElement('div');
    tag.style.cssText = 'color:#c08070;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;';
    tag.textContent = '⚠ Content notice';
    const h = document.createElement('h2');
    h.style.cssText = 'color:#f0b54a;margin:6px 0 10px;font-size:20px;';
    h.textContent = title;
    const intro = document.createElement('p');
    intro.style.cssText = 'color:#bcb4a8;font-size:13px;line-height:1.5;margin:0 0 14px;';
    intro.textContent = customMsg || `This story is intended for mature audiences. It contains themes that may not be appropriate for all readers.`;
    card.append(tag, h, intro);
    if (cws.length || tags.length) {
      const meta = document.createElement('div');
      meta.style.cssText = 'background:#23201c;border-left:3px solid #c08070;padding:10px 12px;border-radius:4px;font-size:12px;line-height:1.6;margin-bottom:14px;';
      if (tags.length) {
        const r = document.createElement('div');
        r.innerHTML = `<span style="color:#9c9388;">Genre:</span> <span style="color:#a8c7a0;">${tags.map(t => '<code>' + escapeHtml(t) + '</code>').join(', ')}</span>`;
        meta.appendChild(r);
      }
      if (cws.length) {
        const r = document.createElement('div');
        r.innerHTML = `<span style="color:#9c9388;">Content:</span> <span style="color:#e0a890;">${cws.map(c => '<code>' + escapeHtml(c) + '</code>').join(', ')}</span>`;
        meta.appendChild(r);
      }
      card.appendChild(meta);
    }
    if (minAge > 0) {
      const age = document.createElement('p');
      age.style.cssText = 'color:#e0a890;font-weight:600;font-size:13px;margin:0 0 16px;';
      age.textContent = `By entering, you confirm you are at least ${minAge} years old.`;
      card.appendChild(age);
    }
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    const btnEnter = document.createElement('button');
    btnEnter.style.cssText = 'padding:12px 16px;background:#2a3528;border:1px solid #f0b54a;color:#f0b54a;border-radius:4px;cursor:pointer;font:inherit;font-size:14px;font-weight:600;text-align:left;';
    btnEnter.textContent = minAge > 0
      ? `✓ I am at least ${minAge} — enter "${title}"`
      : `✓ Acknowledge — enter "${title}"`;
    btnEnter.addEventListener('click', () => { recordAgeAck(story); overlay.remove(); resolve(true); });
    const btnBack = document.createElement('button');
    btnBack.style.cssText = 'padding:10px 16px;background:#23201c;border:1px solid #3a352e;color:#9c9388;border-radius:4px;cursor:pointer;font:inherit;font-size:13px;text-align:left;';
    btnBack.textContent = '← Back to story picker';
    btnBack.addEventListener('click', () => { overlay.remove(); resolve(false); });
    actions.append(btnEnter, btnBack);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

function setBootStatus(msg) {
  try {
    const el = document.getElementById('boot-loading-text');
    if (el) el.textContent = msg;
  } catch {}
}

async function resolveActiveStory() {
  setBootStatus('Fetching story manifest…');
  await loadExtraStoriesIntoBuiltin();
  setBootStatus('Resolving active story…');
  let id = null;
  try { id = localStorage.getItem(ACTIVE_STORY_KEY); } catch {}
  let s = id ? loadStoryById(id) : null;
  if (s && !hasAgeAck(s)) {
    const ok = await showAgeGateModal(s);
    if (!ok) {
      try { localStorage.removeItem(ACTIVE_STORY_KEY); } catch {}
      s = null;
    }
  }
  if (s) return s;
  while (true) {
    const picked = await showStoryPicker(id);
    s = loadStoryById(picked);
    if (!s) {
      s = FALLBACK_STORY;
      try { localStorage.setItem(ACTIVE_STORY_KEY, s.meta.id); } catch {}
      return s;
    }
    if (hasAgeAck(s)) return s;
    const ok = await showAgeGateModal(s);
    if (ok) return s;
    try { localStorage.removeItem(ACTIVE_STORY_KEY); } catch {}
    id = null;
  }
}

const STORY = await resolveActiveStory();

const KIND_STORY_SIGNATURE = 30440;
function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifyStorySignature(story) {
  if (!story || !story.signature) return { ok: false, reason: 'unsigned' };
  const sig = story.signature;
  if (!sig.pubkey || !sig.sig || !sig.event_id || !sig.story_hash || sig.created_at == null)
    return { ok: false, reason: 'malformed' };
  const clean = { ...story }; delete clean.signature;
  const expectedHash = await sha256Hex(canonicalJSON(clean));
  if (expectedHash !== sig.story_hash)
    return { ok: false, reason: 'hash mismatch — story has been modified since signing' };
  const evt = {
    kind: KIND_STORY_SIGNATURE,
    pubkey: sig.pubkey,
    created_at: sig.created_at,
    tags: [
      ['d', `story:${story.meta.id}`],
      ['story_hash', sig.story_hash],
      ['version', story.meta.version || '1.0.0']
    ],
    content: sig.story_hash,
    id: sig.event_id,
    sig: sig.sig
  };
  try {
    if (!verifyEvent(evt)) return { ok: false, reason: 'invalid Schnorr signature' };
  } catch (e) {
    return { ok: false, reason: 'verify threw: ' + (e?.message || e) };
  }
  let npubShort = '';
  try { npubShort = nip19.npubEncode(sig.pubkey); npubShort = npubShort.slice(0, 12) + '…' + npubShort.slice(-6); } catch {}
  return { ok: true, pubkey: sig.pubkey, npub: npubShort, signed_at: sig.created_at };
}
let __storyVerification = null;
verifyStorySignature(STORY).then(r => {
  __storyVerification = r;
  if (typeof write === 'function' && document.readyState !== 'loading') {
    if (r.ok) write(`[story signed by ${r.npub}, signature verified ✓]`, 'success');
    else if (r.reason === 'unsigned') { }
    else write(`[⚠ story signature: ${r.reason}]`, 'error');
  }
});

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
const STORAGE_RELAYS = 'nstadv:custom_relays';
function loadCustomRelays() {
  try {
    const raw = localStorage.getItem(STORAGE_RELAYS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveCustomRelays(arr) {
  try { localStorage.setItem(STORAGE_RELAYS, JSON.stringify(arr)); } catch {}
}
function buildRelayList() {
  const custom = loadCustomRelays();
  const seen = new Set();
  const out = [];
  for (const r of [...custom, ...DEFAULT_RELAYS]) {
    const norm = r.replace(/\/+$/, '');
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(r);
  }
  return out;
}
let RELAYS = buildRelayList();
const KIND_ACTION   = 30420;
const KIND_LISTING  = 30421;
const KIND_PURCHASE = 30422;
const KIND_ITEMDROP = 30423;
const KIND_LOOT     = 30424;
const KIND_DM       = 30426;
const KIND_NOTICE   = 30427;
const KIND_GIFT_OFFER   = 30428;
const KIND_GIFT_ACCEPT  = 30429;
const KIND_GIFT_DECLINE = 30430;
const KIND_HEAL         = 30431;
const KIND_CARVE        = 30432;
const KIND_COMBAT       = 30435;
const KIND_BOUNTY       = 30437;
const KIND_BOUNTY_CLAIM = 30438;
const KIND_STORY_LISTING= 30441;
const KIND_PROGRESSION  = 30433;  // Tier C9 — encrypted cross-device endings sync
const TOPIC_LISTINGS    = 'nta:story-listings';
const TOPIC = 'story:' + STORY.meta.id;
const FIRE_DURATION_TURNS = 20;

const STORAGE_NSEC          = `nstadv:${STORY.meta.id}:nsec`;
const STORAGE_NSEC_CREATED  = `nstadv:${STORY.meta.id}:nsec_created_at`;
const STORAGE_STATE         = `nstadv:${STORY.meta.id}:state`;
const KIND_STATE            = 30425;

// Engine v0.53.1 — Tier D14: magic-link character import.
// Reads `?nsec=...` (or `#nsec=...`) from the URL and uses it to seed the
// active character on this browser. Behind a confirm so a malicious link
// can't silently swap the player's identity. After ingestion, the param
// is stripped from history. The hash form is preferred because it doesn't
// hit referer logs.
(function consumeMagicNsec() {
  try {
    let candidate = null;
    if (window.location.hash) {
      const m = /(?:^|[#&])nsec=(nsec1[a-z0-9]+)/i.exec(window.location.hash);
      if (m) candidate = m[1];
    }
    if (!candidate && window.location.search) {
      const m = /(?:^|[?&])nsec=(nsec1[a-z0-9]+)/i.exec(window.location.search);
      if (m) candidate = m[1];
    }
    if (!candidate) return;
    // Validate format
    try { nip19.decode(candidate); }
    catch { console.warn('[magic-link] malformed nsec; ignoring'); return; }
    const existing = localStorage.getItem(STORAGE_NSEC);
    if (existing === candidate) {
      // Already ours — silently strip the param.
      cleanUrl();
      return;
    }
    const ok = confirm(
      'Magic-link character import\n\n' +
      'This URL contains an nsec (private key) that wants to become this browser\'s active character for "' + (STORY.meta.title || STORY.meta.id) + '".\n\n' +
      'OK = import (your CURRENT character will be saved to "recent characters" so you can switch back).\n' +
      'Cancel = ignore the URL (recommended if you didn\'t generate this link yourself).'
    );
    if (!ok) { cleanUrl(); return; }
    // Save the current character to recents before swapping
    try {
      const prev = existing;
      if (prev) {
        const list = JSON.parse(localStorage.getItem('taleforge:recent_characters') || '[]');
        if (!list.find(e => e.nsec === prev)) {
          list.unshift({ nsec: prev, name: '?', npub_short: '?', last_used_at: Math.floor(Date.now() / 1000) });
          while (list.length > 8) list.pop();
          localStorage.setItem('taleforge:recent_characters', JSON.stringify(list));
        }
      }
    } catch {}
    localStorage.setItem(STORAGE_NSEC, candidate);
    localStorage.setItem(STORAGE_NSEC_CREATED, String(Date.now()));
    localStorage.removeItem(STORAGE_STATE);
    cleanUrl();
    function cleanUrl() {
      try {
        const url = new URL(window.location.href);
        url.search = url.search.replace(/(?:^|[?&])nsec=[^&]+/i, '').replace(/^&/, '?');
        if (url.search === '?' || url.search === '') url.search = '';
        url.hash = url.hash.replace(/(?:^|[#&])nsec=[^&]+/i, '').replace(/^&/, '#');
        if (url.hash === '#') url.hash = '';
        window.history.replaceState({}, document.title, url.toString());
      } catch {}
    }
  } catch (e) { console.warn('[magic-link] consume failed:', e); }
})();

const INACTIVE_LIMIT_MS = 10 * 60 * 1000;
const INACTIVE_WARN_MS  =  7 * 60 * 1000;

try {
  const stored = localStorage.getItem(STORAGE_NSEC);
  if (stored) {
    let savedActivated = false;
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_STATE) || 'null');
      savedActivated = !!(s && s.activated);
    } catch {}
    const created = parseInt(localStorage.getItem(STORAGE_NSEC_CREATED) || '0', 10) || 0;
    const ageMs = created ? (Date.now() - created) : 0;
    if (!savedActivated && created && ageMs > INACTIVE_LIMIT_MS) {
      const keysToKill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`nstadv:${STORY.meta.id}:`)) keysToKill.push(k);
      }
      for (const k of keysToKill) localStorage.removeItem(k);
    }
  }
} catch {}

let sk, isNewCharacter = false;
try {
  const stored = localStorage.getItem(STORAGE_NSEC);
  if (stored) {
    const decoded = nip19.decode(stored);
    if (decoded.type === 'nsec') sk = decoded.data;
  }
} catch {}
if (!sk) {
  sk = generateSecretKey();
  isNewCharacter = true;
  try {
    localStorage.setItem(STORAGE_NSEC, nip19.nsecEncode(sk));
    localStorage.setItem(STORAGE_NSEC_CREATED, String(Date.now()));
  } catch {}
}

const pk = getPublicKey(sk);
const npub = nip19.npubEncode(pk);
const nsec = nip19.nsecEncode(sk);
const npubShort = npub.slice(0, 12) + '…' + npub.slice(-6);
const pubkeyEl = document.getElementById('pubkey');
pubkeyEl.textContent = npubShort;
pubkeyEl.title = npub + '  (click to copy)';
pubkeyEl.style.cursor = 'pointer';
pubkeyEl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(npub);
    showToast('npub copied', 'identity');
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = npub; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      showToast('npub copied', 'identity');
    } catch { showToast('Copy failed — long-press to select manually', 'identity'); }
  }
});

const pool = new SimplePool();
let relayUp = false;
const knownPlayers = new Map();

const player = {
  location: STORY.meta.starting_location,
  inventory: [...STORY.meta.starting_inventory],
  materials: { ...STORY.meta.starting_materials },
  gold: STORY.meta.starting_gold,
  sparks: STORY.meta.starting_sparks,
  life: STORY.meta.starting_life,
  life_max: STORY.meta.life_max,
  base_capacity: STORY.meta.carry_capacity,
  skills: new Set(STORY.meta.starting_skills),
  riddles_solved: new Set(),
  resource_cooldowns: new Map(),
  drink_cooldowns: new Map(),
  fires: new Map(),
  combat_target: null,
  turn: 0,
  chests: new Map(),
  equipment: {},
  visited: new Set([STORY.meta.starting_location]),
  quests: {},
  edges: new Map(),
  flags: new Set(),
  companion: null,
  events_fired: new Set(),
  stats: {
    kills: {},
    gold_earned: 0,
    sparks_earned: 0,
    deaths: 0,
    quests_completed: 0,
    crafts: 0,
    riddles_solved: 0,
    crafts_per_recipe: {}
  },
  achievements: new Set(),
  outgoing_offers: new Map(),
  incoming_offers: new Map(),
  rooms: structuredClone(STORY.rooms),
  weather: null,
  weather_day: -1,
  name: null,
  login_streak: 0,
  last_login_date: null,
  total_logins: 0,
  carvings_left: 0,
  daily_quest_active: null,
  daily_quest_day: 0,
  daily_quests_completed: 0,
  combat_id: null,
  freshness: {},
  language: null,
  tutorial_done: false,
  tutorial_seen: new Set(),
  activated: false,
  created_at: 0,
  profile_id: null,
  dialog_session: null,
  transformed: null,
  transformed_at_day: 0,
  renown: 0,
  recent_kills: [],
  bounty_claims: new Set(),
  world_events_progress: {},
  world_events_seen: new Set(),
  endings_reached: new Set(),
  legacy_gold: 0,
  legacy_sparks: 0,
  ending_locked: null
};
let lastFightStartIdx = null;

function currentLang() {
  if (player.language) return player.language;
  const supported = STORY.meta.languages || [STORY.meta.language || 'en'];
  const browser = (navigator.language || 'en').toLowerCase().split('-')[0];
  if (supported.includes(browser)) return browser;
  return STORY.meta.language || supported[0] || 'en';
}
function t(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v;
  if (typeof v !== 'object') return String(v);
  const want = currentLang();
  if (v[want] != null) return v[want];
  if (v.en != null) return v.en;
  const def = STORY.meta.language;
  if (def && v[def] != null) return v[def];
  for (const k of Object.keys(v)) if (v[k] != null) return v[k];
  return '';
}
function tArr(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(t);
  if (typeof v === 'object') {
    const want = currentLang();
    if (Array.isArray(v[want])) return v[want].map(t);
    if (Array.isArray(v.en)) return v.en.map(t);
    for (const k of Object.keys(v)) if (Array.isArray(v[k])) return v[k].map(t);
  }
  return [];
}
function tDisp(kind, id) {
  const obj = STORY[kind]?.[id];
  if (!obj) return id;
  return t(obj.display) || id;
}

function cmdT(cmd) { return cmd; }

function T(en, ...args) {
  let s = en;
  if (args.length) s = s.replace(/\{(\d+)\}/g, (_, i) => {
    const v = args[Number(i)];
    return v == null ? '' : String(v);
  });
  return s;
}

function applyDomI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = T(key);
  });
}

function dirT(d) { return d; }
const DIR_INPUT_ALIASES = {};
const COMMAND_ALIASES = {};

const I18N_STRING_FIELDS = ['name','summary','display','article','description','prompt','on_solve_message','title','completion_message','tone'];
const I18N_ARRAY_FIELDS  = ['tone_hints','dialogue_seeds','example_descriptions','answers'];
function resolveStoryProse() {
  if (!STORY.__raw) {
    STORY.__raw = JSON.parse(JSON.stringify(STORY));
  }
  const RAW = STORY.__raw;
  function resolveObj(target, raw) {
    if (!target || !raw) return;
    for (const k of I18N_STRING_FIELDS) {
      if (raw[k] !== undefined) target[k] = t(raw[k]);
    }
    for (const k of I18N_ARRAY_FIELDS) {
      if (raw[k] !== undefined) target[k] = tArr(raw[k]);
    }
    if (Array.isArray(raw.conditional_dialogue)) {
      target.conditional_dialogue = raw.conditional_dialogue.map(blk => ({
        ...blk,
        lines: tArr(blk.lines)
      }));
    }
  }
  if (STORY.meta && RAW.meta) {
    if (RAW.meta.title !== undefined) STORY.meta.title = t(RAW.meta.title);
    if (RAW.meta.tone !== undefined) STORY.meta.tone = t(RAW.meta.tone);
  }
  for (const kind of ['rooms','items','npcs','riddles','skills','recipes','entities','quests','events']) {
    if (!STORY[kind] || !RAW[kind]) continue;
    for (const id of Object.keys(STORY[kind])) {
      resolveObj(STORY[kind][id], RAW[kind][id]);
    }
  }
}

const combatSessions = new Map();

for (const [qid, q] of Object.entries(STORY.quests || {})) {
  if (q.auto_accept && !player.quests[qid]) {
    player.quests[qid] = { state: 'active', kills: {}, visited: [...(player.visited || [])] };
  }
}
for (const ps of Object.values(player.quests || {})) {
  if (!Array.isArray(ps.visited)) ps.visited = [];
  if (!ps.kills || typeof ps.kills !== 'object') ps.kills = {};
}

const marketplace = { listings: new Map(), purchased: new Map() };
for (const [npcId, npc] of Object.entries(STORY.npcs)) {
  if (!npc.is_marketplace) continue;
  for (const stk of (npc.initial_stock || [])) {
    for (let i = 0; i < (stk.qty || 1); i++) {
      const lid = `system:${npcId}:${stk.item}:${i}`;
      marketplace.listings.set(lid, {
        merchant: npcId, item: stk.item, qty: 1,
        price_gold: stk.price_gold, seller_pubkey: 'system',
        listed_at: 0, source: 'system'
      });
    }
  }
}
const drops = new Map();
const looted = new Map();
const notices = new Map();
const carvings = new Map();
const dmInbox = [];
const bounties = new Map();

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function daysBetweenISO(a, b) {
  if (!a || !b) return null;
  const ma = new Date(a + 'T00:00:00Z').getTime();
  const mb = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((mb - ma) / 86400000);
}
function streakTitle(n) {
  if (n >= 365) return 'the Eternal';
  if (n >= 100) return 'the Unwavering';
  if (n >= 30)  return 'the Steadfast';
  if (n >= 14)  return 'the Faithful';
  if (n >= 7)   return 'the Persistent';
  if (n >= 3)   return 'the Returning';
  return null;
}
const RENOWN_GAINS = {
  kill: 1,
  kill_unique: 5,
  riddle: 5,
  quest: 10,
  sale: 1,
  bounty_claim: 5
};
function renownTier(r) {
  if (r >= 300) return { stars: 5, label: 'Legendary' };
  if (r >= 150) return { stars: 4, label: 'Famed' };
  if (r >= 70)  return { stars: 3, label: 'Renowned' };
  if (r >= 30)  return { stars: 2, label: 'Recognized' };
  if (r >= 10)  return { stars: 1, label: 'Known' };
  return { stars: 0, label: 'Unknown' };
}
function renownStars(r) {
  const n = renownTier(r ?? player.renown).stars;
  return n > 0 ? '★'.repeat(n) : '';
}
function gainRenown(kind, qty) {
  const before = player.renown;
  const amount = qty != null ? qty : (RENOWN_GAINS[kind] || 0);
  if (amount <= 0) return;
  player.renown = before + amount;
  const beforeTier = renownTier(before);
  const afterTier = renownTier(player.renown);
  if (afterTier.stars > beforeTier.stars) {
    write(T('>>> Your reputation grows: now {0} ({1}).', afterTier.label, '★'.repeat(afterTier.stars)), 'spark');
    try {
      showToast(`${afterTier.label} ${'★'.repeat(afterTier.stars)}`, 'renown', {
        celebrate: true,
        tag: 'Renown tier-up',
        subtitle: `Merchants notice. NPCs greet you by reputation now.`
      });
    } catch {}
  }
}
const BOUNTY_EXPIRY_SEC = 7 * 24 * 3600;
const BOUNTY_KILL_WINDOW_TURNS = 200;

function freshBountiesForEntity(entityId) {
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const [bid, b] of bounties) {
    if (b.entity !== entityId) continue;
    if (b.claimed_by) continue;
    if (b.expires_at && b.expires_at < now) continue;
    out.push({ bid, ...b });
  }
  return out.sort((a, b) => b.gold - a.gold);
}

function notifyBountyClaimable(entityId) {
  const fresh = freshBountiesForEntity(entityId);
  if (fresh.length === 0) return;
  for (const b of fresh) {
    if (player.bounty_claims.has(b.bid)) continue;
    write(T('>>> Bounty available: {0} gold for the {1} ({2}). Type "bounty claim {3}" to collect.',
      b.gold, STORY.entities[entityId]?.display || entityId, b.poster_name || '?', b.bid.slice(0, 8)), 'spark');
    showToast(`Bounty: ${b.gold}g for ${STORY.entities[entityId]?.display || entityId}. claim ${b.bid.slice(0, 8)}`, 'bounty');
  }
}

async function publishBounty(bountyId, payload) {
  const evt = finalizeEvent({
    kind: KIND_BOUNTY, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['bounty', bountyId], ['entity', payload.entity], ['d', `bounty:${bountyId}`]],
    content: JSON.stringify({ ...payload, poster_name: player.name })
  }, sk);
  tryPublish(evt);
  return evt;
}
async function publishBountyClaim(bountyId, entityId) {
  const evt = finalizeEvent({
    kind: KIND_BOUNTY_CLAIM, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['bounty', bountyId], ['entity', entityId]],
    content: JSON.stringify({ claimer: pk, claimer_name: player.name, entity: entityId })
  }, sk);
  tryPublish(evt);
  return evt;
}

function bountyCommand(argRaw) {
  const args = (argRaw || '').trim().split(/\s+/).filter(Boolean);
  const sub = (args[0] || '').toLowerCase();
  if (!sub || sub === 'list') return showBounties();
  if (sub === 'post')   return bountyPost(args.slice(1));
  if (sub === 'claim')  return bountyClaim(args[1]);
  if (sub === 'cancel') return bountyCancel(args[1]);
  write('Usage: bounty list / bounty post <entity> <gold> / bounty claim <id> / bounty cancel <id>', 'error');
}

function showBestiary() {
  const ents = STORY.entities || {};
  const ids = Object.keys(ents);
  if (ids.length === 0) { write('No bestiary entries.', 'system'); return; }
  const hostiles = ids.filter(id => ents[id].hostile);
  const others = ids.filter(id => !ents[id].hostile);
  hostiles.sort((a, b) => (ents[b].hp || 0) - (ents[a].hp || 0));
  others.sort();
  const allKills = ids.map(id => player.stats.kills?.[id] || 0);
  const maxKills = Math.max(1, ...allKills);
  function killBar(kills) {
    if (kills <= 0) return '';
    const filled = Math.min(8, Math.round((kills / maxKills) * 8));
    return ' ' + '▓'.repeat(filled) + '░'.repeat(8 - filled);
  }
  function entLine(id) {
    const e = ents[id];
    const kills = player.stats.kills?.[id] || 0;
    const tags = (e.tags || []).filter(t => t !== 'predator' && t !== 'prey').join(', ');
    const tagStr = tags ? ` [${tags}]` : '';
    const weakStr = e.weaknesses?.length ? ` weak: ${e.weaknesses.join('/')}` : '';
    const resistStr = e.resistances?.length ? ` resists: ${e.resistances.join('/')}` : '';
    const killStr = kills > 0 ? ` —${killBar(kills)} ${kills} killed` : (e.tags?.includes('unique') ? ' — never seen' : '');
    write(`  ${id}  —  ${t(e.display) || id}${tagStr}${weakStr}${resistStr}${killStr}`, kills > 0 ? 'success' : 'system');
    const summary = t(e.summary);
    if (summary) write(`    ${summary.slice(0, 140)}${summary.length > 140 ? '…' : ''}`, 'system');
  }
  writeBlock('=== Bestiary ===', () => {
    if (hostiles.length) {
      write('-- hostile creatures --', 'system');
      write(`  HP-sorted; bar shows kills relative to your most-hunted (max ${maxKills}).`, 'system');
      hostiles.forEach(entLine);
    }
    if (others.length) {
      write('-- passive creatures --', 'system');
      others.forEach(entLine);
    }
    write('Use "bounty post <entity_id> <gold>" to post a bounty on a hostile.', 'system');
  }, '── end of bestiary ──');
}

function showBounties() {
  const now = Math.floor(Date.now() / 1000);
  const active = [];
  for (const [bid, b] of bounties) {
    if (b.claimed_by) continue;
    if (b.expires_at && b.expires_at < now) continue;
    active.push({ bid, ...b });
  }
  if (active.length === 0) { write('No active bounties.', 'system'); return; }
  active.sort((a, b) => b.gold - a.gold);
  write(`-- Active bounties (${active.length}) --`, 'system');
  for (const b of active) {
    const ent = STORY.entities[b.entity];
    const remHrs = Math.max(0, Math.round(((b.expires_at || 0) - now) / 3600));
    const mine = b.poster_pubkey === pk ? '  (yours)' : '';
    write(`  [${b.bid.slice(0, 8)}]  ${b.gold}g for ${ent?.display || b.entity}  by ${b.poster_name || '?'} · ${remHrs}h left${mine}`, 'gold');
  }
  write('Use: bounty post <entity> <gold> · bounty claim <id> · bounty cancel <id>', 'system');
}

function bountyPost(args) {
  if (combatBlock('bounty post')) return;
  if (transformBlock('bounty post')) return;
  if (!args[0] || !args[1]) { write('Usage: bounty post <entity> <gold>', 'error'); return; }
  const entityId = args[0].toLowerCase();
  const gold = parseInt(args[1], 10);
  if (!STORY.entities[entityId]) { write(`No such entity "${entityId}". See "bestiary" or watch the world.`, 'error'); return; }
  if (!STORY.entities[entityId].hostile) { write(`Bounties are for hostile entities only.`, 'error'); return; }
  if (!Number.isInteger(gold) || gold < 1) { write('Gold amount must be ≥ 1.', 'error'); return; }
  if (player.gold < gold) { write(`Not enough gold (need ${gold}, have ${player.gold}).`, 'error'); return; }
  player.gold -= gold;
  const bountyId = uuid();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    entity: entityId,
    gold,
    poster_pubkey: pk,
    posted_at: now,
    expires_at: now + BOUNTY_EXPIRY_SEC
  };
  bounties.set(bountyId, { ...payload, poster_name: player.name });
  write(`📜 You post a ${gold}g bounty on the ${STORY.entities[entityId].display}. (Expires in 7 days. Gold escrowed.)`, 'success');
  publishBounty(bountyId, payload);
  refreshSidebar();
}

function bountyClaim(idPrefix) {
  if (combatBlock('bounty claim')) return;
  if (transformBlock('bounty claim')) return;
  if (!idPrefix) { write('Usage: bounty claim <id>', 'error'); return; }
  let bid = null;
  for (const id of bounties.keys()) {
    if (id === idPrefix || id.startsWith(idPrefix)) { bid = id; break; }
  }
  if (!bid) { write(`No bounty matching "${idPrefix}". Type "bounties".`, 'error'); return; }
  const b = bounties.get(bid);
  if (b.claimed_by) { write('That bounty was already claimed.', 'error'); return; }
  if (player.bounty_claims.has(bid)) { write('You already claimed that bounty.', 'error'); return; }
  const now = Math.floor(Date.now() / 1000);
  if (b.expires_at && b.expires_at < now) { write('That bounty has expired.', 'error'); return; }
  const recent = (player.recent_kills || []).slice().reverse();
  const matchingKill = recent.find(k => k.entity === b.entity && (player.turn - k.turn) <= BOUNTY_KILL_WINDOW_TURNS);
  if (!matchingKill) {
    write(`You have no recent kill of ${STORY.entities[b.entity]?.display || b.entity}. The bounty wants proof.`, 'error'); return;
  }
  b.claimed_by = pk;
  player.bounty_claims.add(bid);
  player.gold += b.gold;
  player.stats.gold_earned += b.gold;
  gainRenown('bounty_claim');
  write(`💰 You claim the ${b.gold}g bounty on the ${STORY.entities[b.entity].display}. (+${RENOWN_GAINS.bounty_claim} renown)`, 'spark');
  publishBountyClaim(bid, b.entity);
  refreshSidebar();
}

function bountyCancel(idPrefix) {
  if (!idPrefix) { write('Usage: bounty cancel <id>', 'error'); return; }
  let bid = null;
  for (const id of bounties.keys()) if (id === idPrefix || id.startsWith(idPrefix)) { bid = id; break; }
  if (!bid) { write(`No bounty matching "${idPrefix}".`, 'error'); return; }
  const b = bounties.get(bid);
  if (b.poster_pubkey !== pk) { write('You can only cancel your own bounties.', 'error'); return; }
  if (b.claimed_by) { write('That bounty was already claimed — too late.', 'error'); return; }
  player.gold += b.gold;
  bounties.delete(bid);
  write(`Bounty cancelled. ${b.gold} gold refunded.`, 'system');
  refreshSidebar();
}
function playerTitle() {
  return streakTitle(player.login_streak);
}
function playerDisplayName() {
  const t = playerTitle();
  if (!player.name) return '—';
  return t ? `${player.name} ${t}` : player.name;
}
function rollLoginStreak() {
  const today = todayISO();
  if (player.last_login_date === today) {
    return { firstToday: false, streak: player.login_streak, title: playerTitle() };
  }
  const gap = daysBetweenISO(player.last_login_date, today);
  let firstToday = true;
  if (gap === 1) {
    player.login_streak = (player.login_streak || 0) + 1;
  } else {
    player.login_streak = 1;
  }
  player.last_login_date = today;
  player.total_logins = (player.total_logins || 0) + 1;
  return { firstToday, streak: player.login_streak, title: playerTitle() };
}

function serializeState() {
  return {
    location: player.location,
    inventory: [...player.inventory],
    materials: { ...player.materials },
    gold: player.gold,
    sparks: player.sparks,
    life: player.life,
    skills: [...player.skills],
    riddles_solved: [...player.riddles_solved],
    fires: [...player.fires],
    chests: [...player.chests].map(([k, v]) => [k, { items: [...v.items], materials: { ...v.materials } }]),
    equipment: { ...player.equipment },
    visited: [...player.visited],
    quests: Object.fromEntries(Object.entries(player.quests).map(([k, v]) => [k, { state: v.state, kills: { ...v.kills }, visited: [...v.visited] }])),
    edges: [...player.edges],
    flags: [...player.flags],
    companion: player.companion ? { ...player.companion } : null,
    events_fired: [...player.events_fired],
    stats: { ...player.stats, kills: { ...player.stats.kills }, crafts_per_recipe: { ...(player.stats.crafts_per_recipe || {}) } },
    achievements: [...player.achievements],
    name: player.name,
    outgoing_offers: [...player.outgoing_offers],
    incoming_offers: [...player.incoming_offers],
    weather: player.weather,
    weather_day: player.weather_day,
    turn: player.turn,
    login_streak: player.login_streak,
    last_login_date: player.last_login_date,
    total_logins: player.total_logins,
    carvings_left: player.carvings_left,
    daily_quest_active: player.daily_quest_active,
    daily_quest_day: player.daily_quest_day,
    daily_quests_completed: player.daily_quests_completed,
    combat_id: player.combat_id,
    language: player.language,
    tutorial_done: !!player.tutorial_done,
    tutorial_seen: [...(player.tutorial_seen || [])],
    activated: !!player.activated,
    created_at: player.created_at || 0,
    profile_id: player.profile_id || null,
    transformed: player.transformed || null,
    transformed_at_day: player.transformed_at_day || 0,
    renown: player.renown || 0,
    recent_kills: [...(player.recent_kills || [])].slice(-10),
    bounty_claims: [...(player.bounty_claims || [])],
    world_events_progress: JSON.parse(JSON.stringify(player.world_events_progress || {})),
    world_events_seen: [...(player.world_events_seen || [])],
    freshness: Object.fromEntries(Object.entries(player.freshness || {}).map(([k, batches]) => [k, batches.map(b => ({ turn: b.turn, qty: b.qty }))])),
    rooms_state: Object.fromEntries(Object.entries(player.rooms).map(([k, r]) => [k, { items: [...(r.items || [])] }])),
    endings_reached: [...(player.endings_reached || [])],
    legacy_gold: player.legacy_gold || 0,
    legacy_sparks: player.legacy_sparks || 0,
    ending_locked: player.ending_locked || null
  };
}
function applyState(s) {
  if (!s) return;
  player.location = s.location;
  player.inventory = [...(s.inventory || [])];
  player.materials = { ...(s.materials || {}) };
  player.gold = s.gold ?? 0;
  player.sparks = s.sparks ?? 0;
  player.life = s.life ?? player.life_max;
  player.skills = new Set(s.skills || []);
  player.riddles_solved = new Set(s.riddles_solved || []);
  player.fires = new Map(s.fires || []);
  player.chests = new Map(s.chests || []);
  player.equipment = { ...(s.equipment || {}) };
  player.visited = new Set(s.visited || [player.location]);
  player.quests = {};
  for (const [k, v] of Object.entries(s.quests || {})) {
    player.quests[k] = { state: v.state, kills: { ...(v.kills || {}) }, visited: [...(v.visited || [])] };
  }
  player.edges = new Map(s.edges || []);
  player.flags = new Set(s.flags || []);
  player.companion = s.companion || null;
  player.events_fired = new Set(s.events_fired || []);
  player.stats = Object.assign({ kills: {}, gold_earned: 0, sparks_earned: 0, deaths: 0, quests_completed: 0, crafts: 0, riddles_solved: 0, crafts_per_recipe: {} }, s.stats || {});
  if (!player.stats.crafts_per_recipe) player.stats.crafts_per_recipe = {};
  player.stats.kills = { ...(s.stats?.kills || {}) };
  player.stats.crafts_per_recipe = { ...(s.stats?.crafts_per_recipe || {}) };
  player.achievements = new Set(s.achievements || []);
  if (s.name) player.name = s.name;
  player.outgoing_offers = new Map(s.outgoing_offers || []);
  player.incoming_offers = new Map(s.incoming_offers || []);
  if (s.weather !== undefined) player.weather = s.weather;
  if (s.weather_day !== undefined) player.weather_day = s.weather_day;
  player.turn = s.turn ?? 0;
  player.login_streak = s.login_streak ?? 0;
  player.last_login_date = s.last_login_date ?? null;
  player.total_logins = s.total_logins ?? 0;
  player.carvings_left = s.carvings_left ?? 0;
  player.daily_quest_active = s.daily_quest_active ?? null;
  player.daily_quest_day = s.daily_quest_day ?? 0;
  player.daily_quests_completed = s.daily_quests_completed ?? 0;
  player.combat_id = s.combat_id ?? null;
  if (s.language) player.language = s.language;
  player.tutorial_done = !!s.tutorial_done;
  player.tutorial_seen = new Set(s.tutorial_seen || []);
  player.activated = !!s.activated;
  player.created_at = s.created_at || 0;
  player.profile_id = s.profile_id || null;
  player.dialog_session = null;
  player.transformed = s.transformed || null;
  player.transformed_at_day = s.transformed_at_day || 0;
  if (player.transformed === 'wolf') player.flags.add('is_wolf');
  else if (player.transformed === 'bat') player.flags.add('is_bat');
  player.renown = s.renown || 0;
  player.recent_kills = Array.isArray(s.recent_kills) ? [...s.recent_kills] : [];
  player.bounty_claims = new Set(s.bounty_claims || []);
  player.world_events_progress = (s.world_events_progress && typeof s.world_events_progress === 'object') ? JSON.parse(JSON.stringify(s.world_events_progress)) : {};
  player.world_events_seen = new Set(s.world_events_seen || []);
  player.freshness = {};
  for (const [k, batches] of Object.entries(s.freshness || {})) {
    if (Array.isArray(batches)) player.freshness[k] = batches.map(b => ({ turn: b.turn, qty: b.qty }));
  }
  if (s.rooms_state) {
    for (const [rid, rs] of Object.entries(s.rooms_state)) {
      if (player.rooms[rid] && rs.items) player.rooms[rid].items = [...rs.items];
    }
  }
  player.endings_reached = new Set(s.endings_reached || []);
  player.legacy_gold = s.legacy_gold || 0;
  player.legacy_sparks = s.legacy_sparks || 0;
  player.ending_locked = s.ending_locked || null;
  if (player.ending_locked) {
    requestAnimationFrame(() => { try { showEndingOverlay(player.ending_locked); } catch {} });
  }
}
let __saveLocalWarned = false;
function saveLocal() {
  try {
    localStorage.setItem(STORAGE_STATE, JSON.stringify(serializeState()));
  } catch (e) {
    if (!__saveLocalWarned) {
      __saveLocalWarned = true;
      const msg = (e && e.name === 'QuotaExceededError')
        ? 'Local storage is full — your progress is no longer being saved on this browser. Copy your nsec ("soul") immediately, then clear other site data and reload.'
        : 'Could not save state to local storage: ' + (e?.message || e) + '. Copy your nsec ("soul") to keep this character.';
      try { write(msg, 'error'); } catch {}
    }
  }
}
// Engine v0.51.1 — Tier C14: state-event payload compression. Browser
// CompressionStream (gzip) is widely supported. We compress the JSON
// and prefix the resulting base64 with "Z|" so decode can detect it.
// Older clients (without compression) read via the legacy fallback below.
async function compressJson(jsonStr) {
  try {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    let bin = '';
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return 'Z|' + btoa(bin);
  } catch { return null; }
}
async function decompressIfNeeded(payload) {
  if (typeof payload !== 'string') return payload;
  if (!payload.startsWith('Z|')) return payload;
  try {
    if (typeof DecompressionStream === 'undefined') return payload;
    const bin = atob(payload.slice(2));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const stream = new Blob([arr]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return text;
  } catch (e) {
    console.warn('state decompress failed; falling through', e);
    return payload;
  }
}

let lastPublishedTurn = -10;
async function maybePublishState(force = false) {
  if (!force && player.turn - lastPublishedTurn < 5) return;
  lastPublishedTurn = player.turn;
  try {
    const json = JSON.stringify(serializeState());
    // Try compression — fall back to plain JSON if unavailable. Plain JSON
    // never starts with "Z|" so the decoder branch is unambiguous.
    const compressed = await compressJson(json);
    const payload = compressed && compressed.length < json.length ? compressed : json;
    const ciphertext = await nip04.encrypt(sk, pk, payload);
    const evt = finalizeEvent({
      kind: KIND_STATE, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', `character:${STORY.meta.id}`]],
      content: ciphertext
    }, sk);
    tryPublish(evt);
  } catch (e) { console.warn('publish state failed', e); }
}
function migrateNewRoomContent() {
  const held = new Set();
  for (const it of player.inventory) held.add(it);
  for (const [it, qty] of Object.entries(player.materials || {})) if ((qty || 0) > 0) held.add(it);
  for (const it of Object.values(player.equipment || {})) held.add(it);
  for (const r of Object.values(player.rooms || {})) {
    for (const it of (r.items || [])) held.add(it);
  }
  for (const drop of drops.values()) {
    for (const d of (drop.items || [])) held.add(d.item);
  }
  let added = 0;
  for (const [rid, room] of Object.entries(STORY.rooms || {})) {
    const here = player.rooms[rid];
    if (!here) continue;
    for (const it of (room.items || [])) {
      if (held.has(it)) continue;
      if (!Array.isArray(here.items)) here.items = [];
      if (!here.items.includes(it)) {
        here.items.push(it);
        held.add(it);
        added++;
      }
    }
  }
  if (added > 0) write(`[content updated: ${added} new item${added===1?'':'s'} restocked in the world]`, 'system');
}

async function fetchAndRestoreState(timeoutMs = 5000) {
  return new Promise(resolve => {
    let resolved = false;
    const finish = (v) => { if (!resolved) { resolved = true; resolve(v); } };
    pool.subscribeMany(RELAYS, [
      { kinds: [KIND_STATE], authors: [pk], '#d': [`character:${STORY.meta.id}`], limit: 1 }
    ], {
      async onevent(event) {
        try {
          const plain = await nip04.decrypt(sk, pk, event.content);
          // Tier C14: state-event payload may be gzip-compressed (Z| prefix).
          const decoded = await decompressIfNeeded(plain);
          finish(JSON.parse(decoded));
        } catch {}
      },
      oneose() { setTimeout(() => finish(null), 500); }
    });
    setTimeout(() => finish(null), timeoutMs);
  });
}

const out = document.getElementById('output');
// Engine v0.50.2 — Tier B9: optional capture target. When __writeCapture is
// non-null, write() pushes lines onto it instead of the DOM. Used by the
// `mapview` command to render the same map text into a zoomable modal.
let __writeCapture = null;
function write(text='', cls='') {
  if (__writeCapture) {
    __writeCapture.push({ text: String(text), cls });
    return;
  }
  const boot = document.getElementById('boot-loading');
  if (boot) boot.remove();
  const div = document.createElement('div');
  div.className = 'line ' + cls;
  if (typeof text === 'string' && (/<(?:img|svg)\s/.test(text) || /&(?:amp|lt|gt|quot|#\d+);/.test(text))) {
    div.innerHTML = text;
  } else {
    div.textContent = text;
  }
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

const TOAST_TTL = 5000;
const TOAST_CELEBRATE_TTL = 8000;
function showToast(text, kind = '', opts = {}) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const card = document.createElement('div');
  const isCelebrate = !!opts.celebrate;
  const cls = ['toast'];
  if (kind) cls.push(kind);
  if (isCelebrate) cls.push('celebrate');
  card.className = cls.join(' ');
  const tagText = opts.tag || kind || '';
  if (tagText) {
    const tag = document.createElement('div');
    tag.className = 'toast-tag';
    tag.textContent = isCelebrate ? tagText.toUpperCase() : tagText;
    card.appendChild(tag);
  }
  const body = document.createElement('div');
  body.textContent = String(text);
  card.appendChild(body);
  if (opts.subtitle) {
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:12px;color:var(--muted);margin-top:4px;';
    sub.textContent = opts.subtitle;
    card.appendChild(sub);
  }
  function dismiss() {
    if (!card.parentNode) return;
    card.classList.add('fading');
    setTimeout(() => { try { card.remove(); } catch {} }, 400);
  }
  card.addEventListener('click', dismiss);
  stack.appendChild(card);
  setTimeout(dismiss, isCelebrate ? TOAST_CELEBRATE_TTL : TOAST_TTL);
  while (stack.children.length > 5) {
    try { stack.children[0].remove(); } catch { break; }
  }
}

function refreshSidebar() {
  const cap = computeMaxCapacity();
  const wt  = Math.round(computeWeight() * 10) / 10;
  const maxLife = computeMaxLife();
  const lifeEl = document.getElementById('life');
  lifeEl.textContent = `${Math.max(0, Math.floor(player.life))}/${maxLife}`;
  const lifeRatio = Math.max(0, player.life) / Math.max(1, maxLife);
  if (lifeRatio < 0.25) {
    lifeEl.style.color = 'var(--red)';
    lifeEl.style.fontWeight = '700';
    lifeEl.style.animation = 'tf-pulse 1.4s ease-in-out infinite';
    lifeEl.title = 'Low life — eat, drink, rest, or sleep somewhere safe.';
  } else if (lifeRatio < 0.5) {
    lifeEl.style.color = 'var(--accent)';
    lifeEl.style.fontWeight = '600';
    lifeEl.style.animation = '';
    lifeEl.title = 'Half life — top up before your next fight.';
  } else {
    lifeEl.style.color = '';
    lifeEl.style.fontWeight = '';
    lifeEl.style.animation = '';
    lifeEl.title = '';
  }
  document.getElementById('gold').textContent = player.gold;
  document.getElementById('sparks').textContent = player.sparks;
  document.getElementById('load').textContent = `${wt}/${cap}`;
  document.getElementById('turn').textContent = player.turn;
  const dp = dayPart();
  document.getElementById('time').textContent = T('Day {0}, {1} ({2}h)', dp.day, T(dp.period), String(dp.hour).padStart(2,'0'));
  const wEl = document.getElementById('weather');
  if (wEl) {
    const w = player.weather || 'clear';
    const icon = { clear: '☀️', rain: '🌧️', fog: '🌫️', snow: '❄️' }[w] || '';
    wEl.textContent = `${icon} ${T(w)}`;
  }
  document.getElementById('mh-life').textContent = Math.max(0, Math.floor(player.life));
  document.getElementById('mh-gold').textContent = player.gold;
  document.getElementById('mh-sparks').textContent = player.sparks;
  document.getElementById('mh-load').textContent = `${wt}/${cap}`;
  document.getElementById('mh-room').textContent = t(player.rooms[player.location].name);
  const nameEl = document.getElementById('player-name');
  if (nameEl) {
    const t = playerTitle();
    nameEl.textContent = t ? `${player.name || '—'} ${t}` : (player.name || '—');
    nameEl.title = player.login_streak >= 1
      ? `Streak: ${player.login_streak} day${player.login_streak === 1 ? '' : 's'} · ${player.total_logins} total logins`
      : '';
  }
  const eqEl = document.getElementById('equipment');
  const eqSec = document.getElementById('equipmentSection');
  if (eqEl) {
    eqEl.innerHTML = '';
    const slots = Object.entries(player.equipment);
    if (slots.length === 0) {
      if (eqSec) eqSec.style.display = 'none';
    } else {
      if (eqSec) eqSec.style.display = '';
      for (const [slot, item] of slots) {
        const row = document.createElement('div'); row.className = 'eq-row';
        row.innerHTML = `<span style="color:var(--muted);">${T(slot)}:</span> <span>${itemDisplay(item)}</span>`;
        eqEl.appendChild(row);
      }
    }
  }

  const trackerSec = document.getElementById('questTrackerSection');
  const trackerEl = document.getElementById('questTracker');
  if (trackerSec && trackerEl) {
    const active = [];
    for (const [qid, ps] of Object.entries(player.quests || {})) {
      if (ps?.state !== 'active') continue;
      const q = STORY.quests[qid]; if (!q) continue;
      active.push({ qid, q, ps });
    }
    if (active.length === 0) {
      trackerSec.style.display = 'none';
    } else {
      let best = null, bestFrac = -1;
      for (const a of active) {
        const prog = questProgress(a.qid);
        if (!prog.length) continue;
        let frac = 0;
        for (const p of prog) frac += Math.min(1, (p.cur || 0) / Math.max(1, p.target));
        frac /= prog.length;
        if (frac > bestFrac) { bestFrac = frac; best = a; }
      }
      if (!best) best = active[0];
      trackerSec.style.display = '';
      trackerEl.innerHTML = '';
      trackerSec.style.cursor = 'pointer';
      trackerSec.title = 'Click to open the full quests view.';
      trackerSec.onclick = () => { try { showQuests(); } catch {} };
      const title = document.createElement('div');
      title.className = 'row';
      const tag = best.q.recurrence === 'daily' ? ' [daily]' : '';
      title.innerHTML = `<span style="color:var(--accent);">${escapeHtml(t(best.q.title))}${tag}</span>`;
      trackerEl.appendChild(title);
      for (const p of questProgress(best.qid)) {
        const cur = Math.min(p.cur, p.target);
        const filled = Math.min(8, Math.round((cur / Math.max(1, p.target)) * 8));
        const bar = '▓'.repeat(filled) + '░'.repeat(8 - filled);
        const mark = p.done ? '✓' : '·';
        const row = document.createElement('div');
        row.className = 'row';
        row.style.fontSize = '11px';
        row.innerHTML = `<span style="color:var(--muted);">[${mark}] ${escapeHtml(p.label)}</span><span class="qty" style="color:var(--accent);">${bar} ${cur}/${p.target}</span>`;
        trackerEl.appendChild(row);
      }
    }
  }
  // Engine v0.52.1 — Tier A4: sidebar bounty tracker.
  // Show open bounties in the room or globally, so the player has a passive
  // hint of what targets are worth gold. Click → "bounty list" command.
  const bountySec = document.getElementById('bountyTrackerSection');
  const bountyEl = document.getElementById('bountyTracker');
  if (bountySec && bountyEl) {
    const list = [];
    try {
      for (const [bid, b] of (typeof bounties !== 'undefined' ? bounties : new Map())) {
        if (player.bounty_claims && player.bounty_claims.has(bid)) continue;
        list.push(b);
      }
    } catch {}
    if (list.length === 0) {
      bountySec.style.display = 'none';
    } else {
      bountySec.style.display = '';
      bountySec.style.cursor = 'pointer';
      bountySec.onclick = () => { try { bountyCommand(''); } catch {} };
      bountyEl.innerHTML = '';
      // Show top 3 by gold
      list.sort((a, b) => (b.gold || 0) - (a.gold || 0));
      for (const b of list.slice(0, 3)) {
        const ent = STORY.entities[b.entity];
        const row = document.createElement('div');
        row.className = 'row';
        row.style.fontSize = '11px';
        row.innerHTML = `<span style="color:var(--muted);">${escapeHtml(ent?.display || b.entity)}</span><span class="qty" style="color:var(--gold);">${b.gold || 0}g</span>`;
        bountyEl.appendChild(row);
      }
      if (list.length > 3) {
        const more = document.createElement('div');
        more.className = 'row';
        more.style.cssText = 'font-size:10px;color:var(--muted);font-style:italic;';
        more.textContent = `…and ${list.length - 3} more (click to view all)`;
        bountyEl.appendChild(more);
      }
    }
  }

  // Engine v0.53.1 — Tier A1: endings completionist widget.
  // Show ★ N/M endings reached on this story (this browser).
  const endingsSec = document.getElementById('endingsTrackerSection');
  const endingsEl = document.getElementById('endingsTracker');
  if (endingsSec && endingsEl) {
    const all = listStoryEndings();
    if (all.length === 0) {
      endingsSec.style.display = 'none';
    } else {
      const reached = (typeof loadGlobalEndings === 'function') ? (loadGlobalEndings()[STORY.meta.id] || []) : [];
      const reachedSet = new Set(reached);
      endingsSec.style.display = '';
      endingsSec.style.cursor = 'pointer';
      endingsSec.onclick = () => { try { showEndings(); } catch {} };
      endingsEl.innerHTML = '';
      const summary = document.createElement('div');
      summary.className = 'row';
      summary.style.fontSize = '11px';
      summary.innerHTML = `<span style="color:var(--muted);">★ reached</span><span class="qty" style="color:var(--gold);">${reachedSet.size} / ${all.length}</span>`;
      endingsEl.appendChild(summary);
      // Tag chips for the visible endings
      const chipsRow = document.createElement('div');
      chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;';
      for (const e of all) {
        const chip = document.createElement('span');
        const got = reachedSet.has(e.tag);
        chip.textContent = e.tag;
        chip.title = `${got ? '★ Reached' : 'Not yet reached'}: ${e.title}`;
        chip.style.cssText = `font-size:9px;padding:1px 5px;border-radius:7px;letter-spacing:0.02em;${got
          ? 'background:#3a4a2a;color:#e0c876;border:1px solid #5a6a3a;'
          : 'background:#2a2724;color:#7a7367;border:1px solid #3a352e;'}`;
        chipsRow.appendChild(chip);
      }
      endingsEl.appendChild(chipsRow);
    }
  }

  const combatSec = document.getElementById('combatTrackerSection');
  const combatEl = document.getElementById('combatTracker');
  if (combatSec && combatEl) {
    if (player.combat_target) {
      const ct = player.combat_target;
      const ent = STORY.entities[ct.id] || ct;
      const maxHp = Math.max(1, ent.hp || ct.hp || 1);
      const cur = Math.max(0, ct.hp);
      const filled = Math.min(12, Math.round((cur / maxHp) * 12));
      const bar = '▓'.repeat(filled) + '░'.repeat(12 - filled);
      const ratio = cur / maxHp;
      const color = ratio > 0.66 ? 'var(--green)' : (ratio > 0.33 ? 'var(--accent)' : 'var(--red)');
      combatEl.innerHTML = '';
      const r1 = document.createElement('div'); r1.className = 'row';
      r1.innerHTML = `<span style="color:var(--red);">${escapeHtml(ent.display || ct.id)}</span><span class="qty" style="color:${color};">${cur}/${maxHp}</span>`;
      combatEl.appendChild(r1);
      const r2 = document.createElement('div'); r2.className = 'row';
      r2.innerHTML = `<span style="color:${color};font-family:monospace;letter-spacing:1px;">${bar}</span>`;
      combatEl.appendChild(r2);
      combatSec.style.display = '';
    } else {
      combatSec.style.display = 'none';
    }
  }
  const compSec = document.getElementById('companionSection');
  const compEl = document.getElementById('companionPanel');
  if (compSec && compEl) {
    if (player.companion) {
      const c = player.companion;
      const ent = STORY.entities[c.entity];
      const tpd = STORY.meta.turns_per_day || 96;
      const daysSinceFed = (player.turn - c.last_fed_turn) / tpd;
      let mood, color;
      if (daysSinceFed >= HUNGER_DAYS) { mood = T('hungry — feed it!'); color = 'var(--err, #c66)'; }
      else if (daysSinceFed >= HUNGER_DAYS * 0.66) { mood = T('getting hungry'); color = '#f0b54a'; }
      else { mood = T('content'); color = 'var(--ok, #6c6)'; }
      compEl.innerHTML = '';
      const r1 = document.createElement('div'); r1.className = 'row';
      r1.innerHTML = `<span>${ent?.display || c.entity}</span><span class="qty">${c.hp}/${c.max_hp} hp</span>`;
      compEl.appendChild(r1);
      const r2 = document.createElement('div'); r2.className = 'row';
      r2.innerHTML = `<span style="color:${color};">${mood}</span><span class="qty" style="color:var(--muted);">${T('fed {0}d ago', daysSinceFed.toFixed(1))}</span>`;
      compEl.appendChild(r2);
      compSec.style.display = '';
    } else {
      compSec.style.display = 'none';
    }
  }

  const matEl = document.getElementById('materials');
  const matEntries = Object.entries(player.materials).filter(([_, q]) => q > 0);
  matEl.innerHTML = '';
  if (matEntries.length === 0) matEl.innerHTML = `<div class="empty">${T('no materials')}</div>`;
  else for (const [item, qty] of matEntries) {
    const row = document.createElement('div'); row.className = 'row';
    const left = freshnessRemaining(item);
    let qtyHtml = `×${qty}`;
    if (left != null) {
      const color = left <= 10 ? '#c66' : (left <= 25 ? '#f0b54a' : 'var(--muted)');
      qtyHtml += ` <span style="color:${color};font-size:11px;" title="rots in ${left} turn${left === 1 ? '' : 's'}">·${left}t</span>`;
    }
    row.innerHTML = `<span>${itemDisplay(item)}</span><span class="qty">${qtyHtml}</span>`;
    matEl.appendChild(row);
  }

  const sklEl = document.getElementById('skillsKnown');
  sklEl.innerHTML = '';
  if (player.skills.size === 0) sklEl.innerHTML = '<div class="empty">type "skills" to see what\'s available</div>';
  else for (const sid of player.skills) {
    const sk = STORY.skills[sid];
    const row = document.createElement('div'); row.className = 'skl';
    row.innerHTML = `<span class="name">${sk.display}</span><span class="cost">${T('tier {0}', sk.tier)}</span>`;
    sklEl.appendChild(row);
  }
}

function computeWeight() {
  let total = 0;
  for (const it of player.inventory) total += STORY.items[it]?.weight ?? 1;
  for (const [it, qty] of Object.entries(player.materials)) total += (STORY.items[it]?.weight ?? 1) * qty;
  for (const it of Object.values(player.equipment)) total += STORY.items[it]?.weight ?? 1;
  return total;
}
function computeMaxCapacity() {
  let cap = player.base_capacity;
  for (const it of player.inventory) cap += STORY.items[it]?.effects?.carry_capacity_bonus ?? 0;
  for (const it of Object.values(player.equipment)) cap += STORY.items[it]?.effects?.carry_capacity_bonus ?? 0;
  cap += profileBonus('carry_capacity_bonus');
  cap += Math.floor(profileAttribute('str') / 2);
  if (player.transformed) cap = Math.floor(cap / 2);
  return cap;
}
function computeMaxLife() {
  let max = player.life_max;
  for (const it of Object.values(player.equipment)) max += STORY.items[it]?.effects?.life_max_bonus ?? 0;
  max += profileBonus('life_max_bonus');
  return max;
}
function canCarry(itemId, qty = 1) {
  const w = (STORY.items[itemId]?.weight ?? 1) * qty;
  return computeWeight() + w <= computeMaxCapacity();
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
}
function markRelayUp() {
  if (!relayUp) {
    relayUp = true;
    document.getElementById('relayDot').classList.add('on');
  }
  // Tier D17: relay back up — clear backoff state.
  cancelReconnect();
  refreshRelayLabel();
}
function markRelayDown() {
  if (relayUp) {
    relayUp = false;
    document.getElementById('relayDot').classList.remove('on');
  }
  refreshRelayLabel();
}
function refreshRelayLabel() {
  const el = document.getElementById('relays');
  if (!el) return;
  const queued = loadOutbox().length;
  if (relayUp) {
    el.textContent = queued
      ? T('{0} relays · live · {1} queued', RELAYS.length, queued)
      : T('{0} relays · live', RELAYS.length);
  } else if (navigator.onLine === false) {
    el.textContent = queued ? T('offline · {0} queued', queued) : T('offline');
  } else if (__reconnectAt > 0) {
    // Tier D17: countdown during exponential backoff.
    const secs = Math.max(0, Math.ceil((__reconnectAt - Date.now()) / 1000));
    el.textContent = queued ? `reconnecting in ${secs}s · ${queued} queued` : `reconnecting in ${secs}s`;
  } else {
    el.textContent = queued ? T('connecting… · {0} queued', queued) : T('connecting…');
  }
}
// Tier D17: 1Hz refresh while a reconnect is pending so the countdown updates.
setInterval(() => { if (__reconnectAt > 0) refreshRelayLabel(); }, 1000);

const STORAGE_OUTBOX = `nstadv:${STORY.meta.id}:outbox`;
function loadOutbox() {
  try { return JSON.parse(localStorage.getItem(STORAGE_OUTBOX) || '[]'); } catch { return []; }
}
function saveOutbox(arr) {
  try { localStorage.setItem(STORAGE_OUTBOX, JSON.stringify(arr)); } catch {}
}
function queueOutbox(evt) {
  if (!evt) return;
  const out = loadOutbox();
  if (out.some(e => e && e.id === evt.id)) return;
  out.push(evt);
  saveOutbox(out);
  refreshRelayLabel();
}
async function drainOutbox(silent = false) {
  const out = loadOutbox();
  if (out.length === 0) return;
  const remaining = [];
  let sent = 0;
  for (const evt of out) {
    try {
      await Promise.any(pool.publish(RELAYS, evt));
      sent++;
    } catch {
      remaining.push(evt);
    }
  }
  saveOutbox(remaining);
  if (sent > 0) {
    markRelayUp();
    if (!silent) write(`[synced ${sent} queued event${sent === 1 ? '' : 's'}]`, 'system');
    try { showToast(`Synced ${sent} queued event${sent === 1 ? '' : 's'} — back online.`, 'sync'); } catch {}
  }
  refreshRelayLabel();
}
function tryPublish(evt) {
  if (!evt) return;
  try {
    Promise.any(pool.publish(RELAYS, evt))
      .then(markRelayUp)
      .catch(() => { queueOutbox(evt); scheduleReconnect(); });
  } catch {
    queueOutbox(evt);
    scheduleReconnect();
  }
}

// Engine v0.52.1 — Tier D17/B6: WS reconnect with exponential backoff.
// When a publish fails (relays unreachable), schedule a retry with a
// growing delay and jitter, capped at 30s. Each tick tries draining the
// outbox; on success, reset the backoff. Status label shows the countdown.
let __reconnectAttempt = 0;
let __reconnectTimer = null;
let __reconnectAt = 0;
function scheduleReconnect() {
  if (__reconnectTimer) return;
  if (navigator.onLine === false) return;  // OS will fire 'online' — no point spinning
  __reconnectAttempt = Math.min(__reconnectAttempt + 1, 6);
  // 1s, 2s, 4s, 8s, 16s, 30s (capped)
  const baseDelays = [1000, 2000, 4000, 8000, 16000, 30000];
  const base = baseDelays[__reconnectAttempt - 1] || 30000;
  // ±20% jitter
  const jitter = Math.floor((Math.random() - 0.5) * base * 0.4);
  const delay = base + jitter;
  __reconnectAt = Date.now() + delay;
  refreshRelayLabel();
  __reconnectTimer = setTimeout(async () => {
    __reconnectTimer = null;
    __reconnectAt = 0;
    if (loadOutbox().length === 0) {
      __reconnectAttempt = 0;
      refreshRelayLabel();
      return;
    }
    const before = loadOutbox().length;
    await drainOutbox(true);
    const after = loadOutbox().length;
    if (after < before) {
      __reconnectAttempt = 0;
      refreshRelayLabel();
    } else if (after > 0) {
      scheduleReconnect();
    }
  }, delay);
}
function cancelReconnect() {
  if (__reconnectTimer) { clearTimeout(__reconnectTimer); __reconnectTimer = null; }
  __reconnectAttempt = 0;
  __reconnectAt = 0;
}
async function publishAction(actionType, payload) {
  const evt = finalizeEvent({
    kind: KIND_ACTION, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['action', actionType], ['d', `${actionType}-${Date.now()}`]],
    content: JSON.stringify({ ...payload, name: player.name, title: playerTitle(), profile: player.profile_id || undefined, renown: renownTier(player.renown).stars || undefined })
  }, sk);
  addToFeed('myEvents', `${actionType}: ${formatActionSummary(actionType, payload)}`, evt.id.slice(0, 8));
  tryPublish(evt);
  return evt;
}
async function publishListing(merchant, item, qty, price_gold) {
  const lid = uuid();
  const evt = finalizeEvent({
    kind: KIND_LISTING, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['merchant', merchant], ['listing', lid]],
    content: JSON.stringify({ item, qty, price_gold, seller: pk, listed_at: new Date().toISOString() })
  }, sk);
  marketplace.listings.set(lid, { merchant, item, qty, price_gold, seller_pubkey: pk, listed_at: Date.now(), source: 'self', event: evt });
  addToFeed('myEvents', `list ${item} @ ${price_gold}g`, evt.id.slice(0, 8));
  tryPublish(evt);
  return lid;
}
async function publishPurchase(lid, listing) {
  const evt = finalizeEvent({
    kind: KIND_PURCHASE, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['merchant', listing.merchant], ['listing', lid]],
    content: JSON.stringify({ buyer: pk, paid_gold: listing.price_gold, purchased_at: new Date().toISOString() })
  }, sk);
  addToFeed('myEvents', `buy listing ${lid.slice(0, 6)}…`, evt.id.slice(0, 8));
  tryPublish(evt);
  return evt;
}
async function publishItemDrop(items, cause = 'death') {
  const did = uuid();
  const evt = finalizeEvent({
    kind: KIND_ITEMDROP, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['room', player.location], ['drop', did]],
    content: JSON.stringify({ dropper: pk, items, dropped_at: new Date().toISOString(), cause })
  }, sk);
  drops.set(did, { roomId: player.location, dropper: pk, items, dropped_at: Date.now(), source: 'self' });
  addToFeed('myEvents', `dropped ${items.length} items (${cause})`, evt.id.slice(0, 8));
  tryPublish(evt);
  return did;
}
async function publishLoot(did) {
  const evt = finalizeEvent({
    kind: KIND_LOOT, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['drop', did]],
    content: JSON.stringify({ looter: pk, looted_at: new Date().toISOString() })
  }, sk);
  addToFeed('myEvents', `loot ${did.slice(0, 8)}…`, evt.id.slice(0, 8));
  tryPublish(evt);
  return evt;
}

async function publishDM(recipient_pubkey, text) {
  try {
    const ciphertext = await nip04.encrypt(sk, recipient_pubkey, JSON.stringify({ from_name: player.name, text }));
    const evt = finalizeEvent({
      kind: KIND_DM, created_at: Math.floor(Date.now() / 1000),
      tags: [['t', TOPIC], ['p', recipient_pubkey]],
      content: ciphertext
    }, sk);
    addToFeed('myEvents', `dm to ${recipient_pubkey.slice(0,8)}…`, evt.id.slice(0, 8));
    tryPublish(evt);
    return evt;
  } catch (e) { console.warn('dm failed', e); }
}

async function publishGiftOffer(recipient_pubkey, item, qty, message) {
  const offer_id = uuid();
  const evt = finalizeEvent({
    kind: KIND_GIFT_OFFER, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['p', recipient_pubkey], ['offer', offer_id]],
    content: JSON.stringify({ from_name: player.name, item, qty, message: message || '' })
  }, sk);
  player.outgoing_offers.set(offer_id, { item, qty, recipient_pubkey, recipient_name: knownPlayers.get(recipient_pubkey)?.name, offered_at: Date.now() });
  addToFeed('myEvents', `gift ${item} → ${recipient_pubkey.slice(0,8)}…`, evt.id.slice(0, 8));
  tryPublish(evt);
  return offer_id;
}

async function publishGiftAccept(offer_id, sender_pubkey) {
  const evt = finalizeEvent({
    kind: KIND_GIFT_ACCEPT, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['p', sender_pubkey], ['offer', offer_id]],
    content: JSON.stringify({ accepter_name: player.name })
  }, sk);
  tryPublish(evt);
  return evt;
}

async function publishGiftDecline(offer_id, sender_pubkey) {
  const evt = finalizeEvent({
    kind: KIND_GIFT_DECLINE, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['p', sender_pubkey], ['offer', offer_id]],
    content: JSON.stringify({ decliner_name: player.name })
  }, sk);
  tryPublish(evt);
  return evt;
}

async function publishHeal(recipient_pubkey, restore) {
  const heal_id = uuid();
  const evt = finalizeEvent({
    kind: KIND_HEAL, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['p', recipient_pubkey], ['heal', heal_id]],
    content: JSON.stringify({ from_name: player.name, restore, item: 'healing_salve' })
  }, sk);
  tryPublish(evt);
  return evt;
}

async function publishNotice(text) {
  const notice_id = uuid();
  const evt = finalizeEvent({
    kind: KIND_NOTICE, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['room', player.location], ['notice', notice_id]],
    content: JSON.stringify({ name: player.name, text, room: player.location })
  }, sk);
  notices.set(notice_id, { roomId: player.location, author: pk, name: player.name, text, posted_at: Date.now() });
  addToFeed('myEvents', `pin notice in ${player.location}`, evt.id.slice(0, 8));
  tryPublish(evt);
  return notice_id;
}

async function publishCombat(phase, payload) {
  const evt = finalizeEvent({
    kind: KIND_COMBAT, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['phase', phase], ['combat', payload.combat_id]],
    content: JSON.stringify(payload)
  }, sk);
  tryPublish(evt);
  return evt;
}

async function publishCarve(text) {
  const carving_id = uuid();
  const evt = finalizeEvent({
    kind: KIND_CARVE, created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TOPIC], ['room', player.location], ['carving', carving_id]],
    content: JSON.stringify({ name: player.name, title: playerTitle(), text, room: player.location })
  }, sk);
  carvings.set(carving_id, {
    roomId: player.location, author: pk, name: player.name, title: playerTitle(),
    text, posted_at: Date.now()
  });
  player.carvings_left = (player.carvings_left || 0) + 1;
  addToFeed('myEvents', `carve "${text.slice(0, 24)}${text.length > 24 ? '…' : ''}" in ${player.location}`, evt.id.slice(0, 8));
  tryPublish(evt);
  return carving_id;
}

function subscribe() {
  pool.subscribeMany(RELAYS, [
    { kinds: [KIND_ACTION],   '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - 60 },
    { kinds: [KIND_LISTING],  '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - 24 * 3600 },
    { kinds: [KIND_PURCHASE], '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - 24 * 3600 },
    { kinds: [KIND_ITEMDROP], '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - 24 * 3600 },
    { kinds: [KIND_LOOT],     '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - 24 * 3600 },
    { kinds: [KIND_NOTICE],   '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - 30 * 24 * 3600 },
    { kinds: [KIND_CARVE],    '#t': [TOPIC] },
    { kinds: [KIND_COMBAT],   '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - 600 },
    { kinds: [KIND_DM],       '#p': [pk],    since: Math.floor(Date.now() / 1000) - 7 * 24 * 3600 },
    { kinds: [KIND_GIFT_OFFER, KIND_GIFT_ACCEPT, KIND_GIFT_DECLINE, KIND_HEAL], '#p': [pk], since: Math.floor(Date.now() / 1000) - 7 * 24 * 3600 },
    { kinds: [KIND_BOUNTY, KIND_BOUNTY_CLAIM], '#t': [TOPIC], since: Math.floor(Date.now() / 1000) - BOUNTY_EXPIRY_SEC },
    { kinds: [KIND_STORY_LISTING], '#t': [TOPIC_LISTINGS], since: Math.floor(Date.now() / 1000) - 90 * 24 * 3600 }
  ], {
    onevent(event) {
      if (event.pubkey === pk && event.kind === KIND_ACTION) return;
      if (event.kind === KIND_ACTION)   handleRemoteAction(event);
      if (event.kind === KIND_LISTING)  handleRemoteListing(event);
      if (event.kind === KIND_PURCHASE) handleRemotePurchase(event);
      if (event.kind === KIND_ITEMDROP) handleRemoteItemDrop(event);
      if (event.kind === KIND_LOOT)     handleRemoteLoot(event);
      if (event.kind === KIND_NOTICE)   handleRemoteNotice(event);
      if (event.kind === KIND_CARVE)    handleRemoteCarve(event);
      if (event.kind === KIND_COMBAT)   handleRemoteCombat(event);
      if (event.kind === KIND_DM)       handleRemoteDM(event);
      if (event.kind === KIND_GIFT_OFFER)   handleRemoteGiftOffer(event);
      if (event.kind === KIND_GIFT_ACCEPT)  handleRemoteGiftAccept(event);
      if (event.kind === KIND_GIFT_DECLINE) handleRemoteGiftDecline(event);
      if (event.kind === KIND_HEAL)         handleRemoteHeal(event);
      if (event.kind === KIND_BOUNTY)       handleRemoteBounty(event);
      if (event.kind === KIND_BOUNTY_CLAIM) handleRemoteBountyClaim(event);
      if (event.kind === KIND_STORY_LISTING) handleRemoteStoryListing(event);
    }
  });
}

function handleRemoteStoryListing(event) {
  let valid = false;
  try { valid = verifyEvent(event); } catch {}
  if (!valid) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  if (!p.id || !p.title || !p.url) return;
  const existing = marketplaceStories.get(p.id);
  if (existing && existing.published_at >= (p.published_at || event.created_at)) return;
  marketplaceStories.set(p.id, {
    id: p.id,
    title: p.title,
    author: p.author || '',
    author_pubkey: event.pubkey,
    claimed_author_pubkey: p.author_pubkey || event.pubkey,
    description: p.description || '',
    url: p.url,
    story_hash: p.story_hash || null,
    version: p.version || '?',
    language: p.language || 'en',
    schema_version: p.schema_version || '?',
    license: p.license || null,
    rooms: p.rooms || null,
    published_at: p.published_at || event.created_at,
    listing_event_id: event.id,
    verified: (p.author_pubkey || event.pubkey) === event.pubkey
  });
}

function handleRemoteBounty(event) {
  const bid = event.tags.find(t => t[0] === 'bounty')?.[1];
  if (!bid) return;
  if (bounties.has(bid)) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  if (!p.entity || !p.gold) return;
  bounties.set(bid, {
    entity: p.entity,
    gold: p.gold,
    poster_pubkey: p.poster_pubkey || event.pubkey,
    poster_name: p.poster_name || (event.pubkey?.slice(0, 8) + '…'),
    posted_at: p.posted_at || event.created_at,
    expires_at: p.expires_at || (event.created_at + BOUNTY_EXPIRY_SEC),
    claimed_by: null
  });
  if (event.pubkey !== pk) {
    write(`📜 [bounty board] ${p.poster_name || '?'} posts ${p.gold}g for ${STORY.entities[p.entity]?.display || p.entity}.`, 'gold');
  }
}
function handleRemoteBountyClaim(event) {
  const bid = event.tags.find(t => t[0] === 'bounty')?.[1];
  if (!bid) return;
  const b = bounties.get(bid);
  if (!b) return;
  if (b.claimed_by && b.claimed_by === pk && event.pubkey !== pk) {
    let other = {}; try { other = JSON.parse(event.content); } catch {}
    if (event.created_at < (b.claim_event_created_at || Infinity)) {
      player.gold = Math.max(0, player.gold - b.gold);
      player.bounty_claims.delete(bid);
      write(`⚠ Bounty ${bid.slice(0, 8)} was claimed by ${other.claimer_name || event.pubkey.slice(0, 8)} before your claim landed. ${b.gold} gold rolled back.`, 'error');
      b.claimed_by = event.pubkey;
      b.claim_event_created_at = event.created_at;
    }
    return;
  }
  if (b.claimed_by) return;
  b.claimed_by = event.pubkey;
  b.claim_event_created_at = event.created_at;
  if (b.poster_pubkey === pk && event.pubkey !== pk) {
    let other = {}; try { other = JSON.parse(event.content); } catch {}
    write(`📜 ${other.claimer_name || event.pubkey.slice(0, 8)} claimed your ${b.gold}g bounty on the ${STORY.entities[b.entity]?.display || b.entity}.`, 'system');
  }
}

function handleRemoteGiftOffer(event) {
  const offer_id = event.tags.find(t => t[0] === 'offer')?.[1];
  const meTag = event.tags.find(t => t[0] === 'p' && t[1] === pk);
  if (!offer_id || !meTag || event.pubkey === pk) return;
  if (player.incoming_offers.has(offer_id)) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  player.incoming_offers.set(offer_id, {
    item: p.item, qty: p.qty || 1,
    sender_pubkey: event.pubkey, sender_name: p.from_name || event.pubkey.slice(0,8) + '…',
    message: p.message || '', offered_at: event.created_at * 1000
  });
  write('');
  write(`📦 ${p.from_name || event.pubkey.slice(0,8) + '…'} offers you ${p.qty || 1} ${itemDisplay(p.item)}.`, 'spark');
  if (p.message) write(`   "${p.message}"`, 'whisper');
  write(`   (claim ${offer_id.slice(0,8)} / decline ${offer_id.slice(0,8)})`, 'system');
  showToast(`${p.from_name || 'Someone'} offers ${p.qty || 1}× ${STORY.items[p.item]?.display || p.item}. claim ${offer_id.slice(0,8)}`, 'gift');
}

function handleRemoteGiftAccept(event) {
  const offer_id = event.tags.find(t => t[0] === 'offer')?.[1];
  const meTag = event.tags.find(t => t[0] === 'p' && t[1] === pk);
  if (!offer_id || !meTag) return;
  const offer = player.outgoing_offers.get(offer_id);
  if (!offer) return;
  let p = {}; try { p = JSON.parse(event.content); } catch {}
  player.outgoing_offers.delete(offer_id);
  write(`📦 ${p.accepter_name || event.pubkey.slice(0,8) + '…'} accepted your gift of ${itemDisplay(offer.item)}.`, 'success');
}

function handleRemoteGiftDecline(event) {
  const offer_id = event.tags.find(t => t[0] === 'offer')?.[1];
  const meTag = event.tags.find(t => t[0] === 'p' && t[1] === pk);
  if (!offer_id || !meTag) return;
  const offer = player.outgoing_offers.get(offer_id);
  if (!offer) return;
  let p = {}; try { p = JSON.parse(event.content); } catch {}
  addItem(offer.item, offer.qty || 1);
  player.outgoing_offers.delete(offer_id);
  write(`${p.decliner_name || event.pubkey.slice(0,8) + '…'} declined your gift. ${itemDisplay(offer.item, true)} returned to your inventory.`, 'system');
  refreshSidebar();
}

function handleRemoteHeal(event) {
  const meTag = event.tags.find(t => t[0] === 'p' && t[1] === pk);
  if (!meTag || event.pubkey === pk) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  const restore = Number(p.restore) || 0;
  if (restore <= 0) return;
  const before = player.life;
  player.life = Math.min(computeMaxLife(), player.life + restore);
  const actual = Math.floor(player.life - before);
  write(`💚 ${p.from_name || event.pubkey.slice(0,8) + '…'} heals you. (+${actual} life)`, 'success');
  showToast(`${p.from_name || 'Someone'} healed you (+${actual} life)`, 'heal');
  refreshSidebar();
}

function handleRemoteNotice(event) {
  const notice_id = event.tags.find(t => t[0] === 'notice')?.[1];
  const room_id = event.tags.find(t => t[0] === 'room')?.[1];
  if (!notice_id || notices.has(notice_id)) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  notices.set(notice_id, { roomId: room_id, author: event.pubkey, name: p.name, text: p.text, posted_at: event.created_at * 1000 });
  if (event.pubkey !== pk && room_id === player.location) {
    write(`[notice] ${p.name || event.pubkey.slice(0,8) + '…'} pinned a note here. ("notices" to read)`, 'system');
  }
}

function handleRemoteCarve(event) {
  const carving_id = event.tags.find(t => t[0] === 'carving')?.[1];
  const room_id = event.tags.find(t => t[0] === 'room')?.[1];
  if (!carving_id || carvings.has(carving_id)) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  carvings.set(carving_id, {
    roomId: room_id, author: event.pubkey,
    name: p.name, title: p.title || null, text: p.text,
    posted_at: event.created_at * 1000
  });
}

const COMBAT_STALE_MS = 10 * 60 * 1000;
function freshCombatsForRoom(roomId, excludeSelf = false) {
  const now = Date.now();
  const live = [];
  for (const s of combatSessions.values()) {
    if (s.ended) continue;
    if (s.room_id !== roomId) continue;
    if (excludeSelf && s.opener_pubkey === pk) continue;
    if ((s.hp ?? 1) <= 0) continue;
    const lastActivity = s.last_activity_at || s.started_at || 0;
    if (now - lastActivity > COMBAT_STALE_MS) continue;
    live.push(s);
  }
  const byOpener = new Map();
  for (const s of live) {
    const key = s.opener_pubkey;
    const cur = byOpener.get(key);
    if (!cur || (s.last_activity_at || s.started_at || 0) > (cur.last_activity_at || cur.started_at || 0)) {
      byOpener.set(key, s);
    }
  }
  return [...byOpener.values()].sort((a, b) =>
    (b.last_activity_at || b.started_at || 0) - (a.last_activity_at || a.started_at || 0)
  );
}

function handleRemoteCombat(event) {
  const phase = event.tags.find(t => t[0] === 'phase')?.[1];
  const combat_id = event.tags.find(t => t[0] === 'combat')?.[1];
  if (!phase || !combat_id) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }

  if (phase === 'open') {
    if (combatSessions.has(combat_id)) return;
    for (const [otherId, otherSess] of combatSessions) {
      if (otherId === combat_id) continue;
      if (otherSess.ended) continue;
      if (otherSess.opener_pubkey === event.pubkey) {
        otherSess.ended = true;
      }
    }
    const sess = {
      entity_id: p.entity_id,
      room_id: p.room_id,
      hp: p.hp, max_hp: p.max_hp,
      opener_pubkey: event.pubkey,
      opener_name: p.opener_name || '',
      participants: new Set([event.pubkey]),
      started_at: event.created_at * 1000,
      last_activity_at: event.created_at * 1000,
      ended: false
    };
    combatSessions.set(combat_id, sess);
    if (sess.room_id === player.location && event.pubkey !== pk) {
      const ent = STORY.entities[sess.entity_id];
      const name = sess.opener_name || event.pubkey.slice(0, 8) + '…';
      write(T('[{0} engages a {1} here. "assist" to join.]', name, ent?.display || sess.entity_id), 'combat');
    }
  } else if (phase === 'damage') {
    let sess = combatSessions.get(combat_id);
    if (!sess) {
      sess = {
        entity_id: p.entity_id || null, room_id: p.room_id || null,
        hp: p.hp_after, max_hp: p.hp_after,
        opener_pubkey: event.pubkey, opener_name: '',
        participants: new Set([event.pubkey]),
        started_at: event.created_at * 1000,
        last_activity_at: event.created_at * 1000,
        ended: false
      };
      combatSessions.set(combat_id, sess);
    }
    sess.last_activity_at = Math.max(sess.last_activity_at || 0, event.created_at * 1000);
    sess.hp = Math.min(sess.hp, p.hp_after ?? sess.hp);
    sess.participants.add(event.pubkey);
    if (player.combat_id === combat_id && player.combat_target) {
      player.combat_target.hp = sess.hp;
      if (event.pubkey !== pk) {
        const dispEnt = STORY.entities[sess.entity_id]?.display || 'creature';
        write(`[${p.attacker_name || event.pubkey.slice(0, 8) + '…'} hits the ${dispEnt} for ${p.dmg || '?'}. (${Math.max(0, sess.hp)} HP left)]`, 'combat');
      }
    }
  } else if (phase === 'end') {
    const sess = combatSessions.get(combat_id);
    if (!sess || sess.ended) return;
    sess.ended = true;
    if (player.combat_id === combat_id && p.killer_pubkey !== pk) {
      const ent_id = sess.entity_id || p.entity_id;
      const ent = STORY.entities[ent_id];
      if (ent_id) {
        player.stats.kills[ent_id] = (player.stats.kills[ent_id] || 0) + 1;
        for (const ps of Object.values(player.quests)) {
          if (ps.state === 'active') ps.kills[ent_id] = (ps.kills[ent_id] || 0) + 1;
        }
        fireEvents('on_kill', { entity: ent_id });
      }
      const killerName = p.killer_name || p.killer_pubkey?.slice(0, 8) + '…' || 'someone';
      write(`[${killerName} lands the killing blow on the ${ent?.display || 'creature'}. You assisted — kill credit yours, drops to the killer.]`, 'success');
      player.combat_target = null;
      player.combat_id = null;
      refreshSidebar();
    }
  }
}

function carvingsAt(roomId) {
  return [...carvings.values()].filter(c => c.roomId === roomId).sort((a,b) => a.posted_at - b.posted_at);
}
function describeCarvingsHere() {
  const here = carvingsAt(player.location);
  if (here.length === 0) return false;
  if (here.length === 1) {
    write(`There is a carving here: "${here[0].text}" — ${here[0].name || here[0].author.slice(0,8)+'…'}${here[0].title ? ' ' + here[0].title : ''}`, 'system');
  } else {
    write(`Carvings on the walls and stones here (${here.length}). Type "carvings" to read.`, 'system');
  }
  return true;
}

async function handleRemoteDM(event) {
  const meTag = event.tags.find(t => t[0] === 'p' && t[1] === pk);
  if (!meTag) return;
  if (event.pubkey === pk) return;
  try {
    const plain = await nip04.decrypt(sk, event.pubkey, event.content);
    const p = JSON.parse(plain);
    const fromName = p.from_name || event.pubkey.slice(0,8) + '…';
    dmInbox.unshift({ from_pubkey: event.pubkey, from_name: fromName, text: p.text, received_at: event.created_at * 1000 });
    while (dmInbox.length > 50) dmInbox.pop();
    write(`[dm from ${fromName}] ${p.text}`, 'whisper');
    showToast(`${fromName}: ${p.text.slice(0, 100)}${p.text.length > 100 ? '…' : ''}`, 'dm');
  } catch {}
}

function displayName(pubkey, fromPayload) {
  if (fromPayload?.name) return fromPayload.name;
  const known = knownPlayers.get(pubkey);
  if (known?.name) return known.name;
  return pubkey.slice(0, 8) + '…';
}

function handleRemoteAction(event) {
  const action = event.tags.find(t => t[0] === 'action')?.[1] || '?';
  let p = {}; try { p = JSON.parse(event.content); } catch {}
  const known = knownPlayers.get(event.pubkey);
  if (!known) {
    knownPlayers.set(event.pubkey, { firstSeen: Date.now(), location: p.to || p.location, name: p.name });
    write(`[network] New traveler appears: ${p.name || event.pubkey.slice(0, 8) + '…'}`, 'system');
  } else {
    if (action === 'move') known.location = p.to;
    if (p.name) known.name = p.name;
  }
  const who = displayName(event.pubkey, p);
  addToFeed('worldFeed', `${who}  ${formatActionSummary(action, p)}`, event.id.slice(0, 8));
  if (action === 'move' && p.to === player.location)
    write(T('[network] {0} enters {1}.', who, t(player.rooms[p.to].name)), 'system');
  if (action === 'whisper' && p.location === player.location)
    write(`[${who}] "${p.text}"`, 'whisper');
  if (action === 'died' && p.location === player.location)
    write(T('[network] {0} died here. Look for their corpse with "corpses".', who), 'system');
}
function handleRemoteListing(event) {
  const lid = event.tags.find(t => t[0] === 'listing')?.[1];
  const merchant = event.tags.find(t => t[0] === 'merchant')?.[1];
  if (!lid || marketplace.listings.has(lid)) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  marketplace.listings.set(lid, {
    merchant, item: p.item, qty: p.qty, price_gold: p.price_gold,
    seller_pubkey: event.pubkey, listed_at: event.created_at * 1000,
    source: event.pubkey === pk ? 'self' : 'remote', event
  });
  if (event.pubkey !== pk)
    addToFeed('worldFeed', `${displayName(event.pubkey, p)} listed ${p.item} @ ${p.price_gold}g`, event.id.slice(0, 8));
}
function handleRemotePurchase(event) {
  const lid = event.tags.find(t => t[0] === 'listing')?.[1];
  if (!lid) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  const existing = marketplace.purchased.get(lid);
  if (existing && existing.purchased_at <= event.created_at) return;
  if (existing && existing.buyer_pubkey === pk && event.pubkey !== pk && event.created_at < existing.purchased_at) {
    const listing = marketplace.listings.get(lid);
    if (listing) {
      player.gold += listing.price_gold;
      removeFromInventoryOrMaterials(listing.item);
      write(`[market] Conflict: ${displayName(event.pubkey, p)} bought first. Refunded ${listing.price_gold} gold.`, 'error');
      refreshSidebar();
    }
  }
  marketplace.purchased.set(lid, { buyer_pubkey: event.pubkey, paid_gold: p.paid_gold, purchased_at: event.created_at });
  if (event.pubkey !== pk)
    addToFeed('worldFeed', `${displayName(event.pubkey, p)} bought listing ${lid.slice(0,6)}…`, event.id.slice(0, 8));
}
function handleRemoteItemDrop(event) {
  const did = event.tags.find(t => t[0] === 'drop')?.[1];
  const room_id = event.tags.find(t => t[0] === 'room')?.[1];
  if (!did || drops.has(did)) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  drops.set(did, {
    roomId: room_id, dropper: event.pubkey,
    items: p.items, dropped_at: event.created_at * 1000,
    source: event.pubkey === pk ? 'self' : 'remote'
  });
  if (event.pubkey !== pk && room_id === player.location)
    write(`[network] You see signs of ${displayName(event.pubkey, p)}'s ${p.cause || 'drop'}. ("corpses")`, 'system');
}
function handleRemoteLoot(event) {
  const did = event.tags.find(t => t[0] === 'drop')?.[1];
  if (!did) return;
  let p = {}; try { p = JSON.parse(event.content); } catch { return; }
  const existing = looted.get(did);
  if (existing && existing.looted_at <= event.created_at) return;
  if (existing && existing.looter === pk && event.pubkey !== pk && event.created_at < existing.looted_at) {
    const drop = drops.get(did);
    if (drop) {
      for (const di of drop.items) removeFromInventoryOrMaterials(di.item);
      write(`[loot] Conflict: ${displayName(event.pubkey, p)} looted that drop first.`, 'error');
      refreshSidebar();
    }
  }
  looted.set(did, { looter: event.pubkey, looted_at: event.created_at });
  if (event.pubkey !== pk)
    addToFeed('worldFeed', `${displayName(event.pubkey, p)} looted drop ${did.slice(0,6)}…`, event.id.slice(0, 8));
}

function formatActionSummary(action, p) {
  switch (action) {
    case 'move':           return `move ${p.from || '?'} → ${p.to || '?'}`;
    case 'take':           return `take ${p.item}`;
    case 'drop':           return `drop ${p.item}`;
    case 'gather':         return `${p.verb} ${p.item} ×${p.qty}`;
    case 'craft':          return `craft ${p.qty && p.qty > 1 ? p.qty + '× ' : ''}${p.recipe}`;
    case 'learn':          return `learn ${p.skill}`;
    case 'talk':           return `talk to ${p.npc}`;
    case 'whisper':        return `whisper "${(p.text || '').slice(0, 32)}"`;
    case 'riddle_solved':  return `solved riddle (+${p.gained} sparks)`;
    case 'killed':         return `killed ${p.entity}`;
    case 'died':           return `died at ${p.location}`;
    case 'lit_fire':       return `lit fire in ${p.location}`;
    case 'placed_chest':   return `placed chest in ${p.location}`;
    case 'eat':            return `ate ${p.item}`;
    case 'drink':          return `drank from ${p.source || p.location}`;
    case 'look':           return `look at ${p.location}`;
    default:               return action;
  }
}

function feedCategoryClass(msg) {
  const m = String(msg || '').toLowerCase();
  if (/\b(killed|hunt|hunted|attacked)\b/.test(m)) return 'cat-combat';
  if (/\b(crafted|crafts|smelted|tanned|baked)\b/.test(m)) return 'cat-craft';
  if (/\b(dm|whispered|shouted|whisper|messag)/.test(m)) return 'cat-chat';
  if (/\b(healed|gifted|listed|bought|sold|loot)\b/.test(m)) return 'cat-trade';
  if (/\b(carved|pinned|notice)\b/.test(m)) return 'cat-mark';
  if (/\b(died|death|fell)\b/.test(m)) return 'cat-death';
  if (/\b(bounty|claim|posted)\b/.test(m)) return 'cat-bounty';
  if (/\b(world event|stir|moon|caravan|invasion)\b/.test(m)) return 'cat-event';
  return '';
}
function addToFeed(id, msg, sigPrefix) {
  const feed = document.getElementById(id);
  feed.querySelector('.empty')?.remove();
  const cat = feedCategoryClass(msg);
  const div = document.createElement('div'); div.className = 'feed-item' + (cat ? ' ' + cat : '');
  const sigEl = document.createElement('span'); sigEl.className = 'sig'; sigEl.textContent = sigPrefix;
  const msgEl = document.createElement('span'); msgEl.className = 'msg'; msgEl.textContent = msg;
  div.append(sigEl, msgEl);
  feed.insertBefore(div, feed.firstChild);
  while (feed.childElementCount > 25) feed.lastChild.remove();
}

function isShortGlyph(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 4 && !/^https?:|^data:/i.test(s);
}
function isImageUrl(s) {
  return typeof s === 'string' && /^(https?:|data:image\/)/i.test(s);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function itemDisplay(id, withArticle = false) {
  const it = STORY.items[id];
  if (!it) return escapeHtml(id);
  const disp = escapeHtml(t(it.display));
  const art = escapeHtml(t(it.article));
  let glyph = '';
  if (typeof it.image === 'string') {
    if (isShortGlyph(it.image)) {
      glyph = escapeHtml(it.image) + ' ';
    } else if (isImageUrl(it.image)) {
      glyph = `<img src="${escapeHtml(it.image)}" class="item-icon" alt="" loading="lazy" decoding="async"> `;
    }
  }
  return withArticle ? `${art} ${glyph}${disp}` : `${glyph}${disp}`;
}
function findItemIn(list, query) {
  return list.findIndex(i => {
    const it = STORY.items[i];
    if (!it) return i === query;
    const disp = t(it.display);
    return i === query || disp.includes(query) || disp.split(' ').includes(query);
  });
}
function findMaterialKey(query) {
  for (const [id, qty] of Object.entries(player.materials)) {
    if (qty <= 0) continue;
    const it = STORY.items[id];
    if (id === query || it?.display.includes(query)) return id;
  }
  return null;
}
function removeFromInventoryOrMaterials(itemId, qty = 1) {
  for (let i = 0; i < qty; i++) {
    const idx = player.inventory.indexOf(itemId);
    if (idx !== -1) { player.inventory.splice(idx, 1); continue; }
    if (player.materials[itemId] > 0) { player.materials[itemId]--; continue; }
    return false;
  }
  consumeFreshness(itemId, qty);
  return true;
}
function addItem(itemId, qty = 1) {
  const it = STORY.items[itemId];
  if (!it) return false;
  if (!canCarry(itemId, qty)) return false;
  if (it.stackable) player.materials[itemId] = (player.materials[itemId] || 0) + qty;
  else for (let i = 0; i < qty; i++) player.inventory.push(itemId);
  addFreshness(itemId, qty);
  if (typeof tickWorldEventProgress === 'function') tickWorldEventProgress('have_check', { item: itemId });
  return true;
}

function addFreshness(item, qty) {
  const it = STORY.items[item];
  if (!it?.decay_turns || qty <= 0) return;
  if (!player.freshness) player.freshness = {};
  if (!player.freshness[item]) player.freshness[item] = [];
  const last = player.freshness[item][player.freshness[item].length - 1];
  if (last && last.turn === player.turn) last.qty += qty;
  else player.freshness[item].push({ turn: player.turn, qty });
}
function consumeFreshness(item, qty) {
  if (!player.freshness?.[item]) return;
  let remaining = qty;
  while (remaining > 0 && player.freshness[item].length > 0) {
    const batch = player.freshness[item][0];
    if (batch.qty <= remaining) {
      remaining -= batch.qty;
      player.freshness[item].shift();
    } else {
      batch.qty -= remaining;
      remaining = 0;
    }
  }
  if (player.freshness[item].length === 0) delete player.freshness[item];
}
function tickRot() {
  if (!player.freshness || Object.keys(player.freshness).length === 0) return;
  for (const [item, batches] of Object.entries(player.freshness)) {
    const decay = STORY.items[item]?.decay_turns;
    if (!decay) continue;
    const have = (player.materials[item] || 0) + player.inventory.filter(i => i === item).length;
    let totalFresh = batches.reduce((s, b) => s + (b.qty || 0), 0);
    if (totalFresh > have) {
      let excess = totalFresh - have;
      while (excess > 0 && batches.length > 0) {
        const b = batches[0];
        if (b.qty <= excess) { excess -= b.qty; batches.shift(); }
        else { b.qty -= excess; excess = 0; }
      }
    }
    let rotted = 0;
    while (batches.length > 0 && (player.turn - batches[0].turn) >= decay) {
      rotted += batches[0].qty;
      batches.shift();
    }
    if (rotted > 0) {
      const newHave = Math.max(0, have - rotted);
      if (player.materials[item] != null) {
        if (newHave === 0) delete player.materials[item];
        else player.materials[item] = newHave;
      }
      const it = STORY.items[item];
      const display = it?.display || item;
      write(`[${rotted} ${display} rotted away. Cure or smoke before they spoil.]`, 'error');
    }
    if (batches.length === 0) delete player.freshness[item];
  }
}
function freshnessRemaining(item) {
  if (!player.freshness?.[item]?.length) return null;
  const decay = STORY.items[item]?.decay_turns;
  if (!decay) return null;
  let minLeft = Infinity;
  for (const b of player.freshness[item]) {
    const left = decay - (player.turn - b.turn);
    if (left < minLeft) minLeft = left;
  }
  return minLeft === Infinity ? null : Math.max(0, minLeft);
}
function getActiveListings(merchantId) {
  const list = [];
  for (const [lid, l] of marketplace.listings) {
    if (l.merchant !== merchantId) continue;
    if (marketplace.purchased.has(lid)) continue;
    list.push({ id: lid, ...l });
  }
  list.sort((a, b) => a.listed_at - b.listed_at);
  return list;
}
function getDropsInRoom(roomId) {
  const list = [];
  for (const [did, d] of drops) {
    if (d.roomId !== roomId) continue;
    if (looted.has(did)) continue;
    list.push({ id: did, ...d });
  }
  list.sort((a, b) => a.dropped_at - b.dropped_at);
  return list;
}
function fireActive(roomId) {
  const exp = player.fires.get(roomId);
  return exp != null && player.turn < exp;
}
function bestWeaponBonus() {
  const wielded = player.equipment.hand;
  let bonus = wielded ? (STORY.items[wielded]?.effects?.attack_bonus ?? 0) : 0;
  bonus += profileBonus('attack_bonus');
  bonus += Math.floor(profileAttribute('str') / 4);
  return bonus;
}
function totalDefenseBonus() {
  let d = 0;
  for (const slot of Object.keys(player.equipment || {})) {
    const itemId = player.equipment[slot];
    if (!itemId) continue;
    const ef = STORY.items[itemId]?.effects || {};
    if (typeof ef.defense_bonus === 'number') d += ef.defense_bonus;
  }
  return d;
}
function applyDefense(rawDmg) {
  const reduced = Math.max(1, rawDmg - totalDefenseBonus());
  return reduced;
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const WEATHER_LABELS = { clear: 'clear', rain: 'rain', fog: 'fog', snow: 'snow', hot: 'hot', storm: 'storm' };
// === ENGINE_TYPES_BEGIN ===
// Tier C16 single source of truth for builder validator sync.
// Builder fetches game.html, extracts this block, parses the JSON below,
// and warns when its own allowlists drift from these values.
// {
//   "weather": ["clear","rain","fog","snow","hot","storm"],
//   "npc_dialogue_conditions": ["quest_completed","quest_active","has_flag","!has_flag","has_skill","has_item","renown_gte","renown_lt"],
//   "npc_hours_close_max": 24,
//   "npc_hours_open_max": 23,
//   "directions": ["north","south","east","west","up","down","in","out"]
// }
// === ENGINE_TYPES_END ===
const DEFAULT_WEATHER_POOL = ['clear', 'clear', 'clear', 'clear', 'rain', 'rain', 'fog'];
function rollDailyWeather() {
  const pool = (STORY.meta.weather_pool && STORY.meta.weather_pool.length) ? STORY.meta.weather_pool : DEFAULT_WEATHER_POOL;
  player.weather = pool[Math.floor(Math.random() * pool.length)];
}
function dayPart() {
  const tpd = STORY.meta.turns_per_day || 96;
  const fraction = (player.turn % tpd) / tpd;
  const hour = Math.floor(fraction * 24);
  const day = Math.floor(player.turn / tpd) + 1;
  let period;
  if (hour < 5) period = 'night';
  else if (hour < 7) period = 'dawn';
  else if (hour < 11) period = 'morning';
  else if (hour < 13) period = 'noon';
  else if (hour < 17) period = 'afternoon';
  else if (hour < 19) period = 'dusk';
  else if (hour < 22) period = 'evening';
  else period = 'night';
  return { hour, day, period, isNight: period === 'night' || period === 'dusk' };
}
function pickWeighted(table) {
  const total = table.reduce((s, e) => s + (e.weight || 1), 0);
  let r = Math.random() * total;
  for (const e of table) { r -= (e.weight || 1); if (r <= 0) return e; }
  return table[table.length - 1];
}

const dynamicVerbs = new Map();
for (const room of Object.values(STORY.rooms)) {
  for (const res of (room.resources || [])) dynamicVerbs.set(res.verb, 'gather');
}

function tickTurn() {
  const prevPeriod = dayPart().period;
  const prevDay = dayPart().day;
  player.turn++;
  const newDay = dayPart().day;
  if (newDay !== prevDay && newDay !== player.weather_day) {
    rollDailyWeather();
    player.weather_day = newDay;
    if (player.weather && player.weather !== 'clear') {
      const desc = { rain: 'Rain begins to fall.', fog: 'A thick fog rolls in.', snow: 'Snow drifts down silently.', hot: 'The air turns hot and still.', storm: 'A storm rolls in with thunder and driving rain.' }[player.weather] || `Weather: ${player.weather}.`;
      write(`[${desc}]`, 'system');
    }
  }
  if (newDay !== prevDay) advanceDailyQuest(newDay);
  if (newDay !== prevDay) advanceWorldEvents(newDay);
  if (newDay !== prevDay) {
    try {
      checkCountMilestones('days', newDay, [5, 10, 30, 100],
        n => `🌅 Day ${n}`,
        n => 'Time keeps. So do you.');
    } catch {}
  }
  if (player.weather === 'snow') player.life -= 0.3;
  player.life -= STORY.meta.life_decay_per_turn;
  tickRot();
  const newPeriod = dayPart().period;
  if (newPeriod !== prevPeriod) {
    const transitions = {
      'dawn': 'Dawn breaks. The world brightens slowly.',
      'morning': 'Morning settles in.',
      'noon': 'The sun reaches its height.',
      'afternoon': 'Afternoon shadows lengthen.',
      'dusk': 'Dusk falls. Long shadows reach across the ground.',
      'evening': 'Evening gathers. Lights come on in the village.',
      'night': 'Night falls. Take care.'
    };
    if (transitions[newPeriod]) write(`[${transitions[newPeriod]}]`, 'system');
    try { applyTimeOfDayTint(newPeriod); } catch {}
  }
  const room = player.rooms[player.location];
  if (!player.combat_target && room.hazards?.wolves) {
    const w = room.hazards.wolves;
    const nightBoost = dayPart().isNight ? 1.5 : 1.0;
    const fogBoost = (player.weather === 'fog') ? 1.5 : 1.0;
    if (Math.random() < w.encounter_chance * nightBoost * fogBoost) {
      const ent = STORY.entities[w.entity];
      player.combat_target = { id: w.entity, ...structuredClone(ent) };
      lastFightStartIdx = out.children.length;
      write('');
      write(`A ${ent.display} appears, ears back, lips curling.`, 'combat');
      write('Type "attack" to fight, "flee" to escape (you take a parting bite).', 'combat');
    }
  }
  checkCompanionHunger();
  if (player.transformed && dayPart().day > player.transformed_at_day) {
    const wasForm = player.transformed;
    player.flags.delete('is_' + wasForm);
    player.transformed = null;
    write('');
    write(wasForm === 'wolf'
      ? '[Dawn light catches you. Bone shifts back without your asking.]'
      : '[The first light burns. You snap back into yourself before the dawn finishes you.]',
      wasForm === 'wolf' ? 'spark' : 'error');
  }
  if (player.skills.has('vampirism')) {
    const period = dayPart().period;
    const isDay = period === 'morning' || period === 'noon' || period === 'afternoon';
    const room2 = STORY.rooms[player.location];
    const isOutdoor = (room2?.tags || []).includes('outdoor');
    if (isDay && isOutdoor) {
      player.life -= 2;
      if (Math.random() < 0.25) write('[The sun bites your skin where it touches.]', 'error');
      if (player.life <= 0) { handleDeath('sunlight'); return; }
    }
  }
  fireEvents('on_turn', {});
  syncAutoAcceptQuests();
  autoCompleteReadyQuests();
  if (player.life <= 0) handleDeath('starvation');
  refreshSidebar();
}

function completeQuestCommand(argRaw) {
  if (combatBlock('complete')) return;
  try { syncAutoAcceptQuests(); } catch {}
  let qid = (argRaw || '').trim().toLowerCase();
  if (!qid) {
    for (const [id, ps] of Object.entries(player.quests || {})) {
      if (ps?.state !== 'active') continue;
      const q = STORY.quests[id]; if (!q) continue;
      if (q.giver) continue;
      if (q.recurrence === 'daily') continue;
      if (questComplete(id)) { qid = id; break; }
    }
    if (!qid) {
      write('Usage: complete <quest_id>  (without an id, completes the first ready null-giver quest)', 'error');
      write('No null-giver quest currently has all objectives met. Type "quests" to see progress.', 'system');
      return;
    }
  }
  const q = STORY.quests[qid];
  const ps = player.quests[qid];
  if (!q || !ps) { write(`No such quest "${qid}". Type "quests" to see what you have.`, 'error'); return; }
  if (ps.state !== 'active') { write(`Quest "${qid}" is already ${ps.state}.`, 'error'); return; }
  if (q.giver) { write(`"${qid}" needs to be turned in at ${STORY.npcs[q.giver]?.display || q.giver}. Use "turn in ${qid}".`, 'error'); return; }
  if (!questComplete(qid)) {
    write(`Objectives for "${qid}" are not yet met:`, 'error');
    for (const p of questProgress(qid)) {
      const mark = p.done ? '✓' : '·';
      write(`  [${mark}] ${p.label}: ${Math.min(p.cur, p.target)}/${p.target}`, p.done ? 'success' : 'system');
    }
    return;
  }
  turnInQuest(qid);
}

function autoCompleteReadyQuests() {
  if (typeof STORY === 'undefined' || !STORY.quests) return;
  for (const [qid, ps] of Object.entries(player.quests || {})) {
    if (ps?.state !== 'active') continue;
    const q = STORY.quests[qid];
    if (!q) continue;
    if (q.giver) continue;
    if (q.recurrence === 'daily') continue;
    if (!questComplete(qid)) continue;
    turnInQuest(qid);
  }
}

function syncAutoAcceptQuests() {
  if (typeof STORY === 'undefined' || !STORY.quests) return;
  if (!player.quests) player.quests = {};
  for (const [qid, q] of Object.entries(STORY.quests)) {
    if (!q.auto_accept) continue;
    if (!player.quests[qid]) {
      if (q.recurrence === 'daily') continue;
      const reqsMet = !q.requires || q.requires.every(r => player.quests[r]?.state === 'completed');
      if (!reqsMet) continue;
      player.quests[qid] = {
        state: 'active',
        kills: {},
        visited: [...(player.visited || [])]
      };
    }
  }
  const allVisited = [...(player.visited || [])];
  for (const ps of Object.values(player.quests)) {
    if (!ps || ps.state !== 'active') continue;
    if (!Array.isArray(ps.visited)) ps.visited = [];
    for (const r of allVisited) {
      if (!ps.visited.includes(r)) ps.visited.push(r);
    }
  }
}

function showEndings() {
  const set = player.endings_reached || new Set();
  if (set.size === 0) {
    write('No endings reached yet. Story endings unlock when you finish one.', 'system');
    write(`Legacy carry-over so far: ${player.legacy_gold || 0} gold, ${player.legacy_sparks || 0} sparks.`, 'system');
    return;
  }
  writeBlock('=== Endings reached ===', () => {
    const byStory = new Map();
    for (const key of set) {
      const [sid, tag] = key.split(':');
      if (!byStory.has(sid)) byStory.set(sid, []);
      byStory.get(sid).push(tag);
    }
    for (const [sid, tags] of byStory) {
      write(`  ${sid}`, 'system');
      for (const t of tags) write(`    ★ ${t}`, 'success');
    }
    write('');
    write(`Legacy carry-over: ${player.legacy_gold || 0} gold, ${player.legacy_sparks || 0} sparks.`, 'spark');
    write(`(Applied as starting padding on every fresh run of any story.)`, 'system');
  }, '── end of endings ──');
}

function showLegacy() {
  write('-- Legacy carry-over --', 'system');
  write(`  Gold: ${player.legacy_gold || 0}`, 'gold');
  write(`  Sparks: ${player.legacy_sparks || 0}`, 'spark');
  write(`  Endings reached: ${(player.endings_reached || new Set()).size}`, 'system');
  write(`Earned by completing story endings. Pads the start of every fresh run.`, 'system');
}

function restartCommand() {
  if (player.ending_locked) {
    restartCurrentStory();
    return;
  }
  if (combatBlock('restart')) return;
  const ok = confirm('Restart this story?\n\nThis WIPES per-run state for this character — inventory, equipment, location, life, gold, sparks, quests, riddles, fires.\nKept: name, achievements, login streak, endings reached, legacy carry-over.\nYou\'ll spawn at the starting location with story-default + legacy gold/sparks.');
  if (!ok) { write('Cancelled.', 'system'); return; }
  restartCurrentStory();
}

// Engine v0.53.1 — Tier A1: enumerate every ending declared by the story
// (parses `>>> ENDING: TAG <<<` markers out of every quest's
// completion_message). Used by the sidebar tracker + picker cards.
function listStoryEndings(story = STORY) {
  const out = [];
  if (!story || !story.quests) return out;
  for (const [qid, q] of Object.entries(story.quests)) {
    const cm = (typeof q.completion_message === 'string') ? q.completion_message : (q.completion_message?.en || '');
    const m = />>>\s*ENDING:\s*([\w-]+)\s*<<</.exec(cm);
    if (m) out.push({ tag: m[1].toUpperCase(), quest: qid, title: (typeof q.title === 'string') ? q.title : (q.title?.en || qid) });
  }
  return out;
}

const GLOBAL_ENDINGS_KEY = 'taleforge:endings_global';
function loadGlobalEndings() {
  try { return JSON.parse(localStorage.getItem(GLOBAL_ENDINGS_KEY) || '{}') || {}; }
  catch { return {}; }
}
function recordGlobalEnding(storyId, tag) {
  if (!storyId || !tag) return;
  try {
    const all = loadGlobalEndings();
    if (!all[storyId]) all[storyId] = [];
    if (!all[storyId].includes(tag)) all[storyId].push(tag);
    localStorage.setItem(GLOBAL_ENDINGS_KEY, JSON.stringify(all));
  } catch {}
  // Tier C9: cross-device sync. Fire-and-forget publish.
  try { publishProgression(); } catch {}
}

// Engine v0.53.1 — Tier C9: cross-device achievements + endings sync.
// Publish a private (nip04-encrypted, self-recipient) kind-30433 event
// containing the player's full GLOBAL_ENDINGS map. On a new browser, after
// the player imports their nsec (via magic-link / restore / characters
// dialog), fetchAndMergeProgression() pulls the latest event and merges
// into local — so the picker shows their past endings even on a clean
// browser. Replaceable kind, single d-tag, so storage stays bounded.
async function publishProgression() {
  try {
    if (typeof sk === 'undefined' || !sk) return;
    const payload = {
      v: 1,
      generated_at: Date.now(),
      endings: loadGlobalEndings()
    };
    const ciphertext = await nip04.encrypt(sk, pk, JSON.stringify(payload));
    const evt = finalizeEvent({
      kind: KIND_PROGRESSION,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'progression']],
      content: ciphertext
    }, sk);
    tryPublish(evt);
  } catch (e) { console.warn('publishProgression failed:', e); }
}

async function fetchAndMergeProgression(timeoutMs = 4000) {
  if (typeof pool === 'undefined' || !pool || !pk) return;
  return new Promise(resolve => {
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };
    try {
      pool.subscribeMany(RELAYS, [
        { kinds: [KIND_PROGRESSION], authors: [pk], '#d': ['progression'], limit: 1 }
      ], {
        async onevent(event) {
          try {
            const plain = await nip04.decrypt(sk, pk, event.content);
            const payload = JSON.parse(plain);
            const remote = payload?.endings || {};
            const local = loadGlobalEndings();
            // Merge: union of tags per story.
            let added = 0;
            for (const [storyId, tags] of Object.entries(remote)) {
              if (!local[storyId]) local[storyId] = [];
              for (const t of (tags || [])) {
                if (!local[storyId].includes(t)) { local[storyId].push(t); added++; }
              }
            }
            if (added > 0) {
              try { localStorage.setItem(GLOBAL_ENDINGS_KEY, JSON.stringify(local)); } catch {}
              try { write(`[synced ${added} cross-device ending${added === 1 ? '' : 's'} from your other devices]`, 'spark'); } catch {}
            }
          } catch (e) { /* malformed or wrong key — ignore */ }
          finish();
        },
        oneose() { setTimeout(finish, 200); }
      });
    } catch { finish(); }
    setTimeout(finish, timeoutMs);
  });
}

function triggerStoryEnding(tag) {
  const storyId = STORY?.meta?.id || 'unknown';
  const storyTitle = (typeof STORY?.meta?.title === 'string') ? STORY.meta.title : (STORY?.meta?.title?.en || storyId);
  const key = `${storyId}:${tag}`;
  if (!player.endings_reached) player.endings_reached = new Set();
  const firstTime = !player.endings_reached.has(key);
  player.endings_reached.add(key);
  recordGlobalEnding(storyId, tag);
  const goldRollover = Math.floor((player.gold || 0) * 0.10);
  const sparksRollover = Math.floor((player.sparks || 0) * 0.05);
  const firstTimeBonus = firstTime ? 50 : 10;
  player.legacy_gold = (player.legacy_gold || 0) + goldRollover + firstTimeBonus;
  player.legacy_sparks = (player.legacy_sparks || 0) + sparksRollover;
  player.ending_locked = {
    story_id: storyId,
    story_title: storyTitle,
    tag,
    first_time: firstTime,
    completed_at: Date.now(),
    gold_at_end: player.gold || 0,
    sparks_at_end: player.sparks || 0,
    rooms_explored: (player.visited && typeof player.visited.size === 'number') ? player.visited.size : 0,
    kills: Object.values(player.stats?.kills || {}).reduce((a, b) => a + b, 0),
    skills_learned: (player.skills && typeof player.skills.size === 'number') ? player.skills.size : 0,
    days_alive: Math.floor((player.turn || 0) / (STORY.meta.turns_per_day || 96)),
    legacy_gold_awarded: goldRollover + firstTimeBonus,
    legacy_sparks_awarded: sparksRollover
  };
  publishAction('ending', { story: storyId, tag, first_time: firstTime });
  saveLocal();
  maybePublishState(true);
  setTimeout(() => { try { showEndingOverlay(player.ending_locked); } catch {} }, 1200);
}

function showEndingOverlay(info) {
  if (!info) return;
  const existing = document.getElementById('ending-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ending-overlay';
  const card = document.createElement('div');
  card.className = 'ending-card';
  const tagEl = document.createElement('div'); tagEl.className = 'ending-tag';
  tagEl.textContent = `Ending — ${info.tag}` + (info.first_time ? ' · first time!' : ' · revisited');
  const h = document.createElement('h2'); h.textContent = info.story_title;
  const sub = document.createElement('div'); sub.className = 'ending-title';
  sub.textContent = info.first_time ? 'A new chapter closes for this character.' : 'You\'ve walked this road before.';
  const stats = document.createElement('div'); stats.className = 'ending-stats';
  const rows = [
    ['Days alive', String(info.days_alive)],
    ['Rooms explored', String(info.rooms_explored)],
    ['Kills', String(info.kills)],
    ['Skills learned', String(info.skills_learned)],
    ['Gold at end', String(info.gold_at_end)],
    ['Sparks at end', String(info.sparks_at_end)]
  ];
  for (const [k, v] of rows) {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span style="color:var(--muted);">${k}</span><span>${v}</span>`;
    stats.appendChild(r);
  }
  const legacy = document.createElement('div'); legacy.className = 'ending-legacy';
  legacy.innerHTML = `★ Legacy awarded to your character: <strong>+${info.legacy_gold_awarded}</strong> legacy gold, <strong>+${info.legacy_sparks_awarded}</strong> legacy sparks.<br><span style="color:var(--muted);">Total carried forward — gold: ${player.legacy_gold || 0}, sparks: ${player.legacy_sparks || 0}.</span>`;
  const actions = document.createElement('div'); actions.className = 'ending-actions';
  const btnRestart = document.createElement('button'); btnRestart.className = 'primary';
  btnRestart.innerHTML = `↻ Start a new run of "${info.story_title}"<span class="sub">Resets inventory, location, life, sparks, gold, quests, riddles. Keeps name, achievements, login streak, endings reached, legacy carry-over.</span>`;
  btnRestart.addEventListener('click', () => { try { overlay.remove(); } catch {} restartCurrentStory(); });
  const btnPick = document.createElement('button');
  btnPick.innerHTML = `≡ Pick a different story<span class="sub">Open the story picker. Your character keeps everything; the lock applies only to this story until you restart it.</span>`;
  btnPick.addEventListener('click', () => {
    try { overlay.remove(); } catch {}
    try { showStoryPicker(STORY?.meta?.id || null); } catch {}
  });
  const btnDismiss = document.createElement('button');
  btnDismiss.innerHTML = `× Stay and re-read<span class="sub">Close this dialog. Most commands will refuse with a hint until you restart or switch.</span>`;
  btnDismiss.addEventListener('click', () => { try { overlay.remove(); } catch {} });
  actions.append(btnRestart, btnPick, btnDismiss);
  card.append(tagEl, h, sub, stats, legacy, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function restartCurrentStory() {
  const meta = STORY?.meta || {};
  player.inventory = [];
  player.materials = {};
  player.equipment = {};
  player.skills = new Set(meta.starting_skills || []);
  player.riddles_solved = new Set();
  player.fires = new Map();
  player.chests = new Map();
  player.quests = {};
  player.edges = new Map();
  player.flags = new Set();
  player.companion = null;
  player.events_fired = new Set();
  player.location = meta.starting_location;
  player.visited = new Set([meta.starting_location]);
  player.life = meta.starting_life || meta.life_max || 100;
  player.life_max = meta.life_max || 100;
  player.gold = (meta.starting_gold || 0) + (player.legacy_gold || 0);
  player.sparks = (meta.starting_sparks || 0) + (player.legacy_sparks || 0);
  player.turn = 0;
  player.weather_day = 0;
  player.daily_quest_active = null;
  player.daily_quest_day = 0;
  player.combat_target = null;
  player.combat_id = null;
  player.transformed = null;
  player.dialog_session = null;
  player.world_events_progress = {};
  player.world_events_seen = new Set();
  player.freshness = {};
  for (const [rid, r] of Object.entries(STORY.rooms || {})) {
    if (player.rooms[rid]) player.rooms[rid].items = [...(r.items || [])];
  }
  if (!player.stats) player.stats = { kills: {}, gold_earned: 0, sparks_earned: 0, deaths: 0, quests_completed: 0, crafts: 0, riddles_solved: 0, crafts_per_recipe: {} };
  player.ending_locked = null;
  out.innerHTML = '';
  write(`=== A new run of ${t(meta.title) || meta.id || 'this story'} ===`, 'title');
  if (player.legacy_gold || player.legacy_sparks) {
    write(`★ Legacy carry-over applied: +${player.legacy_gold} gold, +${player.legacy_sparks} sparks.`, 'spark');
  }
  describeRoom();
  refreshSidebar();
  saveLocal();
  maybePublishState(true);
}

let __dying = false;
function handleDeath(cause) {
  if (__dying) return;
  __dying = true;
  write('');
  write(`=== You have died (${cause}). ===`, 'error');
  try {
    const turnsAlive = player.turn || 0;
    const tpd = STORY.meta.turns_per_day || 96;
    const daysAlive = Math.floor(turnsAlive / tpd);
    const roomsExplored = (player.visited && typeof player.visited.size === 'number') ? player.visited.size : (Array.isArray(player.visited) ? player.visited.length : 0);
    const totalK = Object.values(player.stats?.kills || {}).reduce((a, b) => a + b, 0);
    const skillsLearned = (player.skills && typeof player.skills.size === 'number') ? player.skills.size : 0;
    const goldEarned = player.stats?.gold_earned || 0;
    const sparksEarned = player.stats?.sparks_earned || 0;
    const riddlesSolved = player.stats?.riddles_solved || 0;
    const crafts = player.stats?.crafts || 0;
    const questsDone = player.stats?.quests_completed || 0;
    write('');
    write('Your run:', 'system');
    write(`  · ${daysAlive} day${daysAlive === 1 ? '' : 's'} alive (${turnsAlive} turns)`, 'system');
    write(`  · ${roomsExplored} room${roomsExplored === 1 ? '' : 's'} explored`, 'system');
    write(`  · ${totalK} kill${totalK === 1 ? '' : 's'}`, 'system');
    write(`  · ${skillsLearned} skill${skillsLearned === 1 ? '' : 's'} learned`, 'system');
    write(`  · ${goldEarned} gold · ${sparksEarned} sparks earned`, 'system');
    if (riddlesSolved) write(`  · ${riddlesSolved} riddle${riddlesSolved === 1 ? '' : 's'} solved`, 'system');
    if (crafts)        write(`  · ${crafts} craft${crafts === 1 ? '' : 's'}`, 'system');
    if (questsDone)    write(`  · ${questsDone} quest${questsDone === 1 ? '' : 's'} completed`, 'system');
    write('');
  } catch {}
  const droppedItems = [];
  for (const it of player.inventory) droppedItems.push({ item: it, qty: 1 });
  for (const [it, qty] of Object.entries(player.materials)) if (qty > 0) droppedItems.push({ item: it, qty });
  for (const it of Object.values(player.equipment)) droppedItems.push({ item: it, qty: 1 });
  if (droppedItems.length) {
    publishItemDrop(droppedItems, cause);
    write(T('Your possessions remain in {0}.', t(player.rooms[player.location].name)), 'error');
  }
  publishAction('died', { location: player.location, cause });
  player.stats.deaths++;
  player.inventory = [];
  player.materials = {};
  player.equipment = {};
  player.combat_target = null;

  document.body.classList.add('dying');
  const cmdEl = document.getElementById('cmd');
  if (cmdEl) cmdEl.disabled = true;

  setTimeout(() => write('...darkness presses in.', 'error'),                                700);
  setTimeout(() => write('...the world fades. The forest holds its breath.', 'system'),    1600);
  setTimeout(() => write('...time passes. You drift somewhere beyond the trees.', 'system'),2600);

  setTimeout(() => {
    player.life = Math.floor(player.life_max / 2);
    player.location = STORY.meta.starting_location;
    document.body.classList.remove('dying');
    if (cmdEl) { cmdEl.disabled = false; try { cmdEl.focus(); } catch {} }
    write('');
    write('...you wake.', 'success');
    write(T('You wake at {0}, lighter and aching. ({1}/{2} life)', t(player.rooms[player.location].name), player.life, player.life_max), 'system');
    describeRoom();
    refreshSidebar();
    saveLocal();
    __dying = false;
  }, 3800);
}

function describeRoom() {
  const room = player.rooms[player.location];
  write('');
  const adornments = (fireActive(player.location) ? '  🔥' : '') + (room.hazards?.wolves ? '  ⚠' : '') + (player.chests.has(player.location) ? '  📦' : '');
  const roomGlyph = isShortGlyph(room.image) ? room.image + ' ' : '';
  write(roomGlyph + t(room.name) + adornments, 'room-name');
  write(t(room.summary), 'room-desc');
  if (room.items?.length) {
    const seen = new Map();
    for (const i of room.items) seen.set(i, (seen.get(i) || 0) + 1);
    const parts = [];
    for (const [id, n] of seen) parts.push(n > 1 ? `${itemDisplay(id, true)} ×${n}` : itemDisplay(id, true));
    write(T('You see: {0}', parts.join(', ')), 'items');
  }
  const presentNpcs = npcsHere(player.location);
  if (presentNpcs.length)
    write(T('Here: {0}', presentNpcs.map(n => t(STORY.npcs[n].display)).join(', ')), 'items');
  if (room.resources?.length) {
    const verbs = room.resources.map(r => `${cmdT(r.verb)} (${itemDisplay(r.id)})`).join(', ');
    write(T('Gatherable: {0}', verbs), 'items');
  }
  if (room.spawn_table?.length)
    write(T('Tracks here suggest {0}. Try "hunt".', room.spawn_table.map(s => STORY.entities[s.entity]?.display).filter(Boolean).join(', ')), 'items');
  if (room.riddle && STORY.riddles[room.riddle]) {
    const rd = STORY.riddles[room.riddle];
    if (!player.riddles_solved.has(room.riddle) || rd.repeatable) {
      write(T('A voice asks: "{0}"', rd.prompt), 'spark');
      write(T('(Try "answer <text>" if you know it.)'), 'system');
    } else {
      write(T('(You have already solved the riddle here.)'), 'system');
    }
  }
  if (room.drink_source) write(T('Fresh water here. Try "drink".'), 'items');
  if (player.chests.has(player.location)) write(T('Your chest sits here. Try "chest", "store <x>", "retrieve <x>".'), 'items');
  if (player.companion) {
    const ent = STORY.entities[player.companion.entity];
    write(T('Your {0} pads alongside you ({1}/{2} hp).', ent?.display || player.companion.entity, player.companion.hp, player.companion.max_hp), 'success');
  }
  const others = [...knownPlayers.entries()].filter(([_, v]) => v.location === player.location);
  if (others.length) write(T('Other travelers: {0}', others.map(([pkOther, info]) => info.name || pkOther.slice(0,8) + '…').join(', ')), 'system');
  const localDrops = getDropsInRoom(player.location);
  if (localDrops.length) write(T('Dropped here: {0} cache{1}. Use "corpses".', localDrops.length, localDrops.length > 1 ? 's' : ''), 'system');
  let noticeCount = 0;
  for (const n of notices.values()) if (n.roomId === player.location) noticeCount++;
  if (noticeCount > 0) write(T('A bulletin board holds {0} note{1}. Use "notices".', noticeCount, noticeCount === 1 ? '' : 's'), 'system');
  describeCarvingsHere();
  const activeCombatsHere = freshCombatsForRoom(player.location,  true);
  if (activeCombatsHere.length) {
    for (const s of activeCombatsHere) {
      const ent = STORY.entities[s.entity_id];
      const name = s.opener_name || s.opener_pubkey.slice(0, 8) + '…';
      write(T('>>> {0} is fighting a {1} here. Type "assist" to join.', name, ent?.display || s.entity_id), 'combat');
    }
  }
  try {
    for (const [qid, ps] of Object.entries(player.quests || {})) {
      if (ps?.state !== 'active') continue;
      const q = STORY.quests[qid]; if (!q) continue;
      if (q.giver) continue;
      if (q.recurrence === 'daily') continue;
      if (!questComplete(qid)) continue;
      write(T('>>> Ready to finish: {0}. Type "complete {1}" or "turn in {1}".', t(q.title), qid), 'spark');
    }
  } catch {}
  const exitLabels = Object.entries(room.exits).map(([dir, raw]) => {
    const r = resolveExit(raw);
    if (!r || !r.gate) return dirT(dir);
    return checkExitGate(r.gate).ok ? dirT(dir) : `${dirT(dir)} 🔒`;
  });
  write(T('Exits: {0}', exitLabels.join(', ')), 'exits');
}

function inCombat() { return player.combat_target != null; }

// Engine v0.52.1 — Tier B8: fight-to-the-death helper.
// Repeats `attack` until either the target falls or the player drops below
// 25% life (auto-flee threshold). Pacing: one attack per ~80ms render frame
// so the player still sees each line. Spawns a cancel hook on Esc.
function fightToTheDeath() {
  if (!player.combat_target) {
    write('Nothing here to fight. Type "hunt" or "attack" to start a combat.', 'error');
    return;
  }
  if (window.__autoFightActive) {
    write('Already auto-fighting. Press Esc to break out.', 'system');
    return;
  }
  const maxLife = computeMaxLife();
  const fleeAt = Math.max(1, Math.floor(maxLife * 0.25));
  write(`>>> Auto-fight engaged. Press Esc or "flee" to break out. (Will auto-flee under ${fleeAt} life.)`, 'combat');
  window.__autoFightActive = true;
  let rounds = 0;
  function escHandler(e) { if (e.key === 'Escape') { window.__autoFightActive = false; write('>>> Auto-fight cancelled.', 'system'); } }
  document.addEventListener('keydown', escHandler);
  const tickFight = () => {
    if (!window.__autoFightActive) {
      document.removeEventListener('keydown', escHandler);
      return;
    }
    if (!player.combat_target) {
      window.__autoFightActive = false;
      document.removeEventListener('keydown', escHandler);
      write(`>>> Auto-fight: target down after ${rounds} round${rounds === 1 ? '' : 's'}.`, 'success');
      return;
    }
    if (player.life <= fleeAt) {
      window.__autoFightActive = false;
      document.removeEventListener('keydown', escHandler);
      write(`>>> Auto-fight: life under threshold (${Math.floor(player.life)}/${maxLife}). Auto-fleeing.`, 'error');
      try { flee(); } catch {}
      return;
    }
    rounds++;
    if (rounds > 60) {
      window.__autoFightActive = false;
      document.removeEventListener('keydown', escHandler);
      write('>>> Auto-fight: 60-round safety stop. Type "fight" again to continue or "flee".', 'system');
      return;
    }
    try { attack(); tickTurn(); } catch (e) { window.__autoFightActive = false; return; }
    setTimeout(tickFight, 120);
  };
  setTimeout(tickFight, 50);
}
function combatBlock(action) {
  if (!inCombat()) return false;
  const allowed = ['attack','flee','look','l','status','stats','inv','inventory','i','help','?','clear','eat','use','map','m'];
  if (allowed.includes(action)) return false;
  write(`The ${player.combat_target.display} blocks the path. Attack or flee.`, 'combat');
  return true;
}
function endingBlock(action) {
  if (!player.ending_locked) return false;
  if (player.ending_locked.story_id !== STORY?.meta?.id) {
    player.ending_locked = null;
    return false;
  }
  const allowed = new Set([
    'look','l','help','?','clear','status','stats','inv','inventory','i',
    'achievements','ach','soul','characters','switch','stories','rename','lang','tutorial',
    'feed','recap','last','quests','q','endings','restart','legacy','map','m','bestiary'
  ]);
  if (allowed.has(action)) return false;
  write(`>>> You\'ve completed this story (${player.ending_locked.tag}). Most actions are paused until you restart or switch.`, 'error');
  write(`Type "restart" to begin a new run, "stories" to pick a different world, or "endings" to see your record.`, 'system');
  return true;
}

function resolveExit(rawExit) {
  if (rawExit == null) return null;
  if (typeof rawExit === 'string') return { target: rawExit, gate: null };
  if (typeof rawExit === 'object' && rawExit.target) return { target: rawExit.target, gate: rawExit };
  return null;
}
function checkExitGate(gate) {
  if (!gate) return { ok: true };
  if (gate.requires_flag && !player.flags.has(gate.requires_flag))
    return { ok: false, why: gate.message || `The way is barred. (need flag: ${gate.requires_flag})` };
  if (gate.requires_skill && !player.skills.has(gate.requires_skill))
    return { ok: false, why: gate.message || `You lack the skill (${t(STORY.skills[gate.requires_skill]?.display || gate.requires_skill)}) to pass.` };
  if (gate.requires_quest_completed && player.quests[gate.requires_quest_completed]?.state !== 'completed')
    return { ok: false, why: gate.message || `You're not ready to pass yet.` };
  if (gate.requires_item) {
    const has = player.inventory.includes(gate.requires_item) || (player.materials[gate.requires_item] || 0) > 0;
    if (!has) return { ok: false, why: gate.message || `You need ${itemDisplay(gate.requires_item, true)} to pass.` };
  }
  return { ok: true };
}
function move(dir) {
  if (combatBlock('move')) return;
  if (player.dialog_session) { write('Finish or end your conversation first.', 'error'); return; }
  const room = player.rooms[player.location];
  const resolved = resolveExit(room.exits?.[dir]);
  if (!resolved) { write("You can't go that way.", 'error'); return; }
  const { target, gate } = resolved;
  const gateCheck = checkExitGate(gate);
  if (!gateCheck.ok) { write(gateCheck.why, 'error'); return; }
  if (!canEnterTrialRoom(target)) {
    const lic = STORY.meta?.license || {};
    const price = lic.price_sats ? `${lic.price_sats} sats` : 'a fee';
    write(`[This room is past the free trial. Pay ${price} to unlock the rest of ${t(STORY.meta.title)}.]`, 'error');
    if (lic.payment_url) write(`[Payment: ${lic.payment_url}  — once paid, return to the picker and click "I've paid → import" again.]`, 'system');
    return;
  }
  if (gate?.consume_item) {
    const idx = player.inventory.indexOf(gate.consume_item);
    if (idx !== -1) player.inventory.splice(idx, 1);
    else if ((player.materials[gate.consume_item] || 0) > 0) player.materials[gate.consume_item]--;
    write(T('({0} consumed)', itemDisplay(gate.consume_item)), 'system');
  }
  const from = player.location; player.location = target;
  const newRoom = !player.visited.has(target);
  player.visited.add(target);
  for (const ps of Object.values(player.quests)) {
    if (ps.state !== 'active') continue;
    if (!Array.isArray(ps.visited)) ps.visited = [];
    if (!ps.visited.includes(target)) ps.visited.push(target);
  }
  publishAction('move', { from, to: target });
  if (newRoom) write(`(new place — added to your map)`, 'system');
  fireEvents('on_room_enter', { room: target });
  tickWorldEventProgress('visit', { room: target });
  describeRoom();
}

function take(arg) {
  if (combatBlock('take')) return;
  const room = player.rooms[player.location];
  if (!arg) {
    if (!room.items?.length) { write('There is nothing to take here.', 'error'); return; }
    write('Take what? Try "take <item>" or "look" to see what is here.', 'error'); return;
  }
  if (!room.items?.length) { write('There is nothing to take.', 'error'); return; }
  const idx = findItemIn(room.items, arg);
  if (idx === -1) { write(T('You don\'t see "{0}" here.', arg), 'error'); return; }
  const item = room.items[idx];
  if (!canCarry(item, 1)) { write(`Too heavy. You can carry ${computeMaxCapacity() - computeWeight()} more weight; this needs ${STORY.items[item].weight}.`, 'error'); return; }
  room.items.splice(idx, 1);
  addItem(item, 1);
  write(T('You take {0}.', itemDisplay(item, true)));
  publishAction('take', { item, location: player.location });
}

function drop(arg) {
  if (combatBlock('drop')) return;
  if (!arg) { write('Drop what? Try "drop <item>" — see "inv" for what you carry.', 'error'); return; }
  const idx = findItemIn(player.inventory, arg);
  if (idx === -1) {
    const matKey = findMaterialKey(arg);
    if (matKey) {
      player.materials[matKey]--;
      consumeFreshness(matKey, 1);
      (player.rooms[player.location].items ||= []).push(matKey);
      write(`You drop ${itemDisplay(matKey, true)}.`);
      publishAction('drop', { item: matKey, location: player.location });
      return;
    }
    write(`You don't have "${arg}".`, 'error'); return;
  }
  const item = player.inventory.splice(idx, 1)[0];
  (player.rooms[player.location].items ||= []).push(item);
  write(`You drop ${itemDisplay(item, true)}.`);
  publishAction('drop', { item, location: player.location });
}

function bury(arg) {
  if (combatBlock('bury')) return;
  if (!arg) { write('Bury what? Usage: bury <item>  or  bury <qty> <item>', 'error'); return; }
  const parts = arg.trim().split(/\s+/);
  let qty = 1, query = parts[0];
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    qty = parseInt(parts[0], 10);
    query = parts[1];
  }
  if (qty < 1) { write('Bury at least 1.', 'error'); return; }
  let sampleId = null;
  const idxPreview = findItemIn(player.inventory, query);
  if (idxPreview !== -1) sampleId = player.inventory[idxPreview];
  else {
    const matKey = findMaterialKey(query);
    if (matKey && (player.materials[matKey] || 0) > 0) sampleId = matKey;
  }
  if (sampleId) {
    const item = STORY.items[sampleId];
    const unitValue = (item?.value ?? 0);
    const totalValue = unitValue * qty;
    const isUnique = item && item.stackable === false;
    const isWeapon = (item?.tags || []).includes('weapon');
    const guarded = totalValue >= 50 || isUnique || isWeapon;
    if (guarded && player._bury_confirmed !== `${sampleId}:${qty}`) {
      write(`Bury ${qty}× ${itemDisplay(sampleId, true)}? That's worth ~${totalValue} gold and is gone forever once buried.`, 'error');
      write(`Type "bury ${qty} ${query}" again within the next move to confirm.`, 'system');
      player._bury_confirmed = `${sampleId}:${qty}`;
      return;
    }
    player._bury_confirmed = null;
  }
  let buried = 0;
  for (let n = 0; n < qty; n++) {
    const idx = findItemIn(player.inventory, query);
    if (idx !== -1) { player.inventory.splice(idx, 1); buried++; continue; }
    const matKey = findMaterialKey(query);
    if (matKey && (player.materials[matKey] || 0) > 0) { player.materials[matKey]--; buried++; continue; }
    break;
  }
  if (buried === 0) { write(`You don't have "${query}".`, 'error'); return; }
  if (buried === 1) write(`You bury it in the soil. It is gone.`, 'system');
  else write(`You bury ${buried}× in the soil. They are gone.`, 'system');
  publishAction('bury', { item: query, qty: buried, location: player.location });
  refreshSidebar();
}

function inventoryColorClass(itemId) {
  const tags = (STORY.items[itemId]?.tags || []).map(t => String(t).toLowerCase());
  if (tags.includes('lore') || tags.includes('sacred')) return 'spark';
  if (tags.includes('weapon') || tags.includes('armor')) return 'combat';
  if (tags.includes('consumable') || tags.includes('food') || tags.includes('fish'))
                                                          return 'success';
  if (tags.includes('herb') || tags.includes('alchemy')) return 'success';
  if (tags.includes('tool') || tags.includes('crafted')) return 'gold';
  if (tags.includes('trinket')) return 'spark';
  return '';
}
function showInventory(filter) {
  // Engine v0.50.2 — Tier B10: optional filter argument. `inv leather` shows
  // only items whose id or display contains "leather" (case-insensitive).
  const f = (filter || '').trim().toLowerCase();
  const matches = (id) => {
    if (!f) return true;
    if (id.toLowerCase().includes(f)) return true;
    const disp = (typeof itemDisplay === 'function') ? String(itemDisplay(id) || '').toLowerCase() : '';
    return disp.includes(f);
  };
  const headerSuffix = f ? ` (filter: "${f}")` : '';
  writeBlock('=== Inventory' + headerSuffix + ' ===', () => {
    if (!player.inventory.length) write(T('You carry no discrete items.'));
    else {
      const groups = new Map();
      const unique = [];
      for (const i of player.inventory) {
        if (!matches(i)) continue;
        if (player.edges?.has(i)) unique.push(i);
        else groups.set(i, (groups.get(i) || 0) + 1);
      }
      const anyDiscrete = groups.size + unique.length;
      if (f && anyDiscrete === 0) write(`(no items match "${f}")`, 'muted');
      else {
        write(T('You carry:'));
        for (const [id, n] of groups) {
          const label = n > 1 ? `  · ${itemDisplay(id, true)} ×${n}` : `  · ${itemDisplay(id, true)}`;
          write(label, inventoryColorClass(id));
        }
        for (const i of unique) write(`  · ${itemDisplay(i, true)}`, inventoryColorClass(i));
      }
    }
    const mats = Object.entries(player.materials).filter(([k, q]) => q > 0 && matches(k));
    if (mats.length) {
      write(T('Materials:'));
      for (const [k, q] of mats) {
        const left = freshnessRemaining(k);
        const fresh = (left != null) ? ' ' + T('(rots in {0} turn{1})', left, left === 1 ? '' : 's') : '';
        write(`  · ${itemDisplay(k)} ×${q}${fresh}`, inventoryColorClass(k) || 'gold');
      }
    } else if (f) {
      // Quiet — no materials match. Avoid "no materials" line spam.
    }
    if (!f) write(T('Load: {0}/{1}', Math.round(computeWeight()*10)/10, computeMaxCapacity()), 'system');
  }, '── end of inventory ──');
}

function showStatus() {
  write(T('Location: {0}', t(player.rooms[player.location].name)));
  write(T('Life: {0}/{1}  ·  Gold: {2}  ·  Sparks: {3}  ·  Load: {4}/{5}  ·  Turn: {6}',
    Math.floor(player.life), computeMaxLife(), player.gold, player.sparks,
    Math.round(computeWeight()*10)/10, computeMaxCapacity(), player.turn));
  const def = totalDefenseBonus();
  if (def > 0) write(T('Defense: {0}  (incoming damage reduced; floors at 1)', def));
  write(T('Skills: {0}', player.skills.size === 0 ? T('none') : [...player.skills].map(s => STORY.skills[s].display).join(', ')));
  if (player.companion) {
    const c = player.companion;
    const ent = STORY.entities[c.entity];
    write(T('Companion: {0} ({1}/{2} hp). Type "companion" for status, "feed" for hunger.', ent?.display || c.entity, c.hp, c.max_hp), 'success');
  }
  if (inCombat()) write(T('In combat with {0} ({1} HP).', player.combat_target.display, player.combat_target.hp), 'combat');
}

function showSkills() {
  write('Skills:', 'system');
  const tiers = {};
  for (const [id, sk] of Object.entries(STORY.skills)) (tiers[sk.tier || 1] ||= []).push([id, sk]);
  for (const t of Object.keys(tiers).sort()) {
    write(T('-- Tier {0} --', t), 'system');
    for (const [id, sk] of tiers[t]) {
      const known = player.skills.has(id);
      const reqs = (sk.prereqs || []).filter(p => !player.skills.has(p));
      const triggerOnly = sk.acquisition === 'trigger';
      const status = known
        ? '✓ known'
        : triggerOnly
          ? 'earned through experience'
          : (reqs.length ? `requires: ${reqs.join(', ')}` : `${sk.spark_cost} sparks`);
      write(`  ${id}  —  ${sk.display}  [${status}]`, known ? 'success' : 'system');
    }
  }
  write('Type "learn <skill_id>" to learn one.  ·  Type "skilltree" / "tree" for a prereq view.', 'system');
}

const THEME_KEY = 'taleforge:theme';
const THEMES = ['dark', 'light', 'sepia', 'contrast'];
function applyTheme(name) {
  const valid = THEMES.includes(name) ? name : 'dark';
  for (const t of THEMES) document.body.classList.remove('theme-' + t);
  if (valid !== 'dark') document.body.classList.add('theme-' + valid);
  try { localStorage.setItem(THEME_KEY, valid); } catch {}
}
function loadTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}
function themeCommand(arg) {
  const a = (arg || '').trim().toLowerCase();
  if (!a) {
    const cur = loadTheme();
    write(`Current theme: ${cur}`, 'system');
    write(`Available: ${THEMES.join(' · ')}.  Use "theme <name>" to switch.`, 'system');
    return;
  }
  if (!THEMES.includes(a)) {
    write(`Unknown theme "${a}". Available: ${THEMES.join(', ')}.`, 'error');
    return;
  }
  applyTheme(a);
  write(`Theme: ${a}.`, 'success');
}
applyTheme(loadTheme());

function firstTimeMilestone(flagKey, label, subtitle) {
  if (!player || !player.flags) return;
  if (player.flags.has('milestone:' + flagKey)) return;
  player.flags.add('milestone:' + flagKey);
  try {
    showToast(label, 'milestone', { celebrate: true, tag: 'First time!', subtitle });
  } catch {}
}
function countMilestone(flagKey, count, label, subtitle) {
  if (!player || !player.flags) return;
  const k = `milestone:${flagKey}:${count}`;
  if (player.flags.has(k)) return;
  player.flags.add(k);
  try {
    showToast(label, 'milestone', { celebrate: true, tag: `${count}!`, subtitle });
  } catch {}
}
function checkCountMilestones(flagKey, currentCount, thresholds, makeLabel, makeSubtitle) {
  if (!Array.isArray(thresholds)) return;
  for (const t of thresholds) {
    if (currentCount >= t) countMilestone(flagKey, t, makeLabel(t), makeSubtitle ? makeSubtitle(t) : '');
  }
}

const FONTSIZE_KEY = 'taleforge:fontsize';
const FONTSIZES = ['small', 'medium', 'large'];
function applyFontSize(name) {
  const valid = FONTSIZES.includes(name) ? name : 'medium';
  for (const f of FONTSIZES) document.body.classList.remove('font-' + f);
  document.body.classList.add('font-' + valid);
  try { localStorage.setItem(FONTSIZE_KEY, valid); } catch {}
}
function loadFontSize() {
  try { return localStorage.getItem(FONTSIZE_KEY) || 'medium'; } catch { return 'medium'; }
}
function fontsizeCommand(arg) {
  const a = (arg || '').trim().toLowerCase();
  if (!a) {
    write(`Current font size: ${loadFontSize()}`, 'system');
    write(`Available: ${FONTSIZES.join(' · ')}.  Use "fontsize <name>".`, 'system');
    return;
  }
  const aliases = { s: 'small', sm: 'small', m: 'medium', md: 'medium', l: 'large', lg: 'large' };
  const target = aliases[a] || a;
  if (!FONTSIZES.includes(target)) {
    write(`Unknown font size "${a}". Available: ${FONTSIZES.join(', ')}.`, 'error');
    return;
  }
  applyFontSize(target);
  write(`Font size: ${target}.`, 'success');
}
applyFontSize(loadFontSize());

const TIME_OF_DAY_PERIODS = ['dawn','morning','noon','afternoon','dusk','evening','night'];
function applyTimeOfDayTint(period) {
  for (const p of TIME_OF_DAY_PERIODS) document.body.classList.remove('tod-' + p);
  if (TIME_OF_DAY_PERIODS.includes(period)) document.body.classList.add('tod-' + period);
}

function showSkillTree() {
  const skills = STORY.skills || {};
  const ids = Object.keys(skills);
  if (ids.length === 0) { write('This story has no skills.', 'system'); return; }
  const byTier = new Map();
  for (const id of ids) {
    const tier = skills[id].tier || 1;
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(id);
  }
  const sortedTiers = [...byTier.keys()].sort((a, b) => a - b);
  function lineFor(id) {
    const sk = skills[id];
    const known = player.skills.has(id);
    const reqs = sk.prereqs || [];
    const missing = reqs.filter(r => !player.skills.has(r));
    const triggerOnly = sk.acquisition === 'trigger';
    let glyph, status, cls;
    if (known) { glyph = '✓'; status = 'learned'; cls = 'success'; }
    else if (triggerOnly) { glyph = '☆'; status = 'earned through experience'; cls = 'spark'; }
    else if (missing.length === 0) { glyph = '★'; status = `available (${sk.spark_cost || 0} sparks)`; cls = 'spark'; }
    else { glyph = '•'; status = `requires: ${missing.join(' + ')}`; cls = 'echo'; }
    return { glyph, id, display: sk.display || id, status, cls, prereqs: reqs };
  }
  writeBlock('=== Skill tree ===', () => {
    write(`You know ${player.skills.size}/${ids.length} skills.  ·  Sparks: ${player.sparks}`, 'system');
    write('');
    for (const tier of sortedTiers) {
      write(`-- Tier ${tier}${tier === sortedTiers[0] ? ' (no prereqs)' : ''} --`, 'system');
      for (const id of byTier.get(tier).sort()) {
        const ln = lineFor(id);
        write(`  ${ln.glyph}  ${ln.id.padEnd(16)} ${ln.display.padEnd(18)} ${ln.status}`, ln.cls);
        if (ln.prereqs && ln.prereqs.length && tier > sortedTiers[0]) {
          const chain = ln.prereqs.map(p => {
            const pKnown = player.skills.has(p);
            return (pKnown ? '✓' : '·') + ' ' + p;
          }).join('  →  ');
          write(`     ↳ via: ${chain}`, 'echo');
        }
      }
      write('');
    }
    write('Legend:  ✓ learned · ★ available now · ☆ earned through experience · • locked', 'echo');
    write('Type "learn <skill_id>" to spend sparks on an available skill.', 'system');
  }, '── end of skill tree ──');
}

function learn(arg) {
  if (combatBlock('learn')) return;
  if (!arg) { write('Learn what? Type "skills" to list available skills, then "learn <id>".', 'error'); return; }
  const sk = STORY.skills[arg];
  if (!sk) { write(`No such skill "${arg}". Type "skills" to list.`, 'error'); return; }
  if (sk.acquisition === 'trigger') {
    write(`${t(sk.display)} cannot be bought with sparks. It must be earned through experience.`, 'error');
    return;
  }
  if (player.skills.has(arg)) { write('You already know that skill.'); return; }
  for (const p of (sk.prereqs || []))
    if (!player.skills.has(p)) { write(`You need to learn "${p}" first.`, 'error'); return; }
  if (player.sparks < sk.spark_cost) { write(`Not enough sparks. Need ${sk.spark_cost}, have ${player.sparks}.`, 'error'); return; }
  player.sparks -= sk.spark_cost;
  player.skills.add(arg);
  write(`You learn ${sk.display}. (-${sk.spark_cost} sparks)`, 'spark');
  if (sk.unlocks?.verbs?.length) write(`New verbs: ${sk.unlocks.verbs.join(', ')}`, 'success');
  if (sk.unlocks?.recipes?.length) write(`New recipes: ${sk.unlocks.recipes.join(', ')}`, 'success');
  if (!sk.unlocks?.verbs?.length && !sk.unlocks?.recipes?.length && sk.unlocks?.interactions?.length) {
    const passiveHint = arg === 'skinning' ? 'kills now drop hide as well as meat' : 'effects apply automatically';
    write(`Passive skill — ${passiveHint}.`, 'success');
  }
  publishAction('learn', { skill: arg });
}

const VERB_NARRATION = {
  chop:   { success: 'You chop and gain {0} {1}.{2}',   cant: "You can't chop here.",   need: 'You need {0} to chop.' },
  forage: { success: 'You forage and gain {0} {1}.{2}', cant: "You can't forage here.", need: 'You need {0} to forage.' },
  gather: { success: 'You gather and gain {0} {1}.{2}', cant: "You can't gather here.", need: 'You need {0} to gather.' },
  mine:   { success: 'You mine and gain {0} {1}.{2}',   cant: "You can't mine here.",   need: 'You need {0} to mine.' },
  fish:   { success: 'You fish and gain {0} {1}.{2}',   cant: "You can't fish here.",   need: 'You need {0} to fish.' }
};
function gather(verb, arg) {
  if (combatBlock('gather')) return;
  const room = player.rooms[player.location];
  const candidates = (room.resources || []).filter(r => r.verb === verb);
  const tmpl = VERB_NARRATION[verb] || { success: `You ${verb} and gain {0} {1}.{2}`, cant: `You can't ${verb} here.`, need: `You need {0} to ${verb}.` };
  if (candidates.length === 0) { write(T(tmpl.cant), 'error'); return; }
  let res;
  if (arg) {
    const q = arg.toLowerCase().trim();
    res = candidates.find(r => {
      if (r.id === q) return true;
      const disp = (STORY.items[r.id]?.display || '').toLowerCase();
      return disp.includes(q) || disp.split(/\s+/).includes(q);
    });
    if (!res) { write(`Nothing here you can ${verb} matches "${arg}".`, 'error'); return; }
  } else {
    res = candidates.find(r => player.skills.has(r.skill)) || candidates[0];
  }
  if (!player.skills.has(res.skill)) { write(T(tmpl.need, t(STORY.skills[res.skill].display)), 'error'); return; }
  const cdKey = `${player.location}:${res.id}`;
  const next = player.resource_cooldowns.get(cdKey) || 0;
  if (Date.now() < next) { write(T('Wait {0}s.', Math.ceil((next - Date.now()) / 1000)), 'error'); return; }
  if (!canCarry(res.id, res.yield_qty)) { write(T('Too heavy to carry the {0}.', itemDisplay(res.id)), 'error'); return; }
  let yield_qty = res.yield_qty;
  if (player.weather === 'rain' || player.weather === 'storm') yield_qty = Math.max(1, Math.floor(yield_qty * 0.5));
  addItem(res.id, yield_qty);
  if (res.regenerates) player.resource_cooldowns.set(cdKey, Date.now() + (res.regen_seconds || 0) * 1000);
  const note = (yield_qty < res.yield_qty) ? T(' (rain reduces the catch)') : '';
  write(T(tmpl.success, yield_qty, itemDisplay(res.id), note), 'success');
  publishAction('gather', { verb, item: res.id, qty: yield_qty, location: player.location });
}

function showRecipes(filter) {
  // Engine v0.50.2 — Tier B10: optional filter argument. `recipes iron` shows
  // only recipes whose id, display, or input/output items match.
  const f = (filter || '').trim().toLowerCase();
  const matches = (rid, r) => {
    if (!f) return true;
    if (rid.toLowerCase().includes(f)) return true;
    if (String(r.display || '').toLowerCase().includes(f)) return true;
    for (const io of (r.inputs || [])) if (String(io.item || '').toLowerCase().includes(f)) return true;
    for (const io of (r.outputs || [])) if (String(io.item || '').toLowerCase().includes(f)) return true;
    return false;
  };
  writeBlock('=== Recipes' + (f ? ` (filter: "${f}")` : '') + ' ===', () => {
    const known = [...player.skills].map(s => STORY.skills[s]);
    const recipeIds = new Set();
    for (const sk of known) for (const r of (sk.unlocks?.recipes || [])) recipeIds.add(r);
    if (recipeIds.size === 0) { write('No recipes available. Learn a crafting skill first.'); return; }
    let shown = 0;
    write('Available recipes:', 'system');
    for (const rid of recipeIds) {
      const r = STORY.recipes[rid];
      if (!r || !matches(rid, r)) continue;
      const ins = r.inputs.map(io => `${io.qty} ${itemDisplay(io.item)}`).join(' + ');
      const outs = r.outputs.map(io => `${io.qty} ${itemDisplay(io.item)}`).join(' + ');
      const fire = r.requires_fire ? '  🔥 (needs fire)' : '';
      write(`  ${rid}  —  ${r.display}: ${ins} → ${outs}${fire}`);
      shown++;
    }
    if (f && shown === 0) write(`(no recipes match "${f}")`, 'muted');
    if (!f) write('Type "craft <recipe_id>" to craft. Each craft awards ' + STORY.meta.sparks_per_craft + ' sparks.', 'system');
  }, '── end of recipes ──');
}

function craft(argRaw) {
  if (combatBlock('craft')) return;
  const parts = (argRaw || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) { write('Craft what? Usage: craft <recipe>  or  craft <qty> <recipe>', 'error'); return; }
  let qty = 1;
  let recipeId = parts[0];
  if (/^\d+$/.test(parts[0]) && parts.length >= 2) {
    qty = parseInt(parts[0], 10);
    recipeId = parts[1];
    if (qty < 1) { write('Quantity must be ≥ 1.', 'error'); return; }
    if (qty > 99) { write('Sane batch size is ≤ 99 per command. Run again if you really want more.', 'error'); return; }
  }
  const r = STORY.recipes[recipeId];
  if (!r) { write(`No such recipe "${recipeId}".`, 'error'); return; }
  if (!player.skills.has(r.skill)) { write(`You need ${t(STORY.skills[r.skill].display)}.`, 'error'); return; }
  if (r.requires_fire && !fireActive(player.location)) { write('You need an active fire here. Try "light fire".', 'error'); return; }
  for (const io of r.inputs) {
    const need = io.qty * qty;
    const have = STORY.items[io.item].stackable ? (player.materials[io.item] || 0) : player.inventory.filter(i => i === io.item).length;
    if (have < need) { write(`Not enough ${itemDisplay(io.item)} for ${qty}× ${t(r.display)} (need ${need}, have ${have}).`, 'error'); return; }
  }
  if (r.tool && !player.inventory.includes(r.tool)) { write(`You need ${itemDisplay(r.tool, true)}.`, 'error'); return; }
  let inputWeight = 0;
  for (const io of r.inputs) inputWeight += (STORY.items[io.item].weight ?? 1) * io.qty * qty;
  let outputWeight = 0;
  for (const io of r.outputs) outputWeight += (STORY.items[io.item].weight ?? 1) * io.qty * qty;
  if (computeWeight() - inputWeight + outputWeight > computeMaxCapacity()) {
    write(`Too heavy: ${qty}× ${t(r.display)} would exceed your carry capacity. Drop or store something first.`, 'error'); return;
  }
  for (const io of r.inputs) removeFromInventoryOrMaterials(io.item, io.qty * qty);
  for (const io of r.outputs) addItem(io.item, io.qty * qty);
  const outStr = r.outputs.map(io => `${io.qty * qty} ${itemDisplay(io.item)}`).join(', ');
  if (qty > 1) write(`You craft ${qty}× ${t(r.display)}: ${outStr}.`, 'success');
  else write(`You craft: ${outStr}.`, 'success');
  const perCraftReward = r.sparks_reward ?? STORY.meta.sparks_per_craft ?? 0;
  const totalReward = perCraftReward * qty;
  if (totalReward > 0) {
    player.sparks += totalReward;
    player.stats.sparks_earned += totalReward;
    write(`(+${totalReward} sparks for ${qty} craft${qty === 1 ? '' : 's'})`, 'spark');
  }
  player.stats.crafts += qty;
  firstTimeMilestone('first_craft', '🔨 First craft', `${itemDisplay(STORY.recipes[recipeId]?.outputs?.[0]?.item) || 'Something'} from raw stock. Try "recipes" to see what else your skills unlock.`);
  if (!player.stats.crafts_per_recipe) player.stats.crafts_per_recipe = {};
  player.stats.crafts_per_recipe[recipeId] = (player.stats.crafts_per_recipe[recipeId] || 0) + qty;
  publishAction('craft', { recipe: recipeId, qty, location: player.location });
  for (let i = 0; i < qty; i++) fireEvents('on_craft', { recipe: recipeId });
}

function npcOpen(npcId) {
  const n = STORY.npcs[npcId];
  if (!n?.hours) return true;
  const hr = dayPart().hour;
  const { open, close } = n.hours;
  if (open == null || close == null) return true;
  if (close > open) return hr >= open && hr < close;
  return hr >= open || hr < close;
}
function describeNpcStatus(npcId) {
  const n = STORY.npcs[npcId];
  if (!n?.hours) return null;
  return `${n.display} is closed (open ${n.hours.open}h–${n.hours.close}h).`;
}

function npcInRoom(npcId, roomId, hour) {
  const npc = STORY.npcs[npcId];
  if (!npc) return false;
  const sched = Array.isArray(npc.schedule) ? npc.schedule : null;
  if (!sched || sched.length === 0) {
    return (STORY.rooms[roomId]?.npcs || []).includes(npcId);
  }
  const h = (typeof hour === 'number') ? hour : dayPart().hour;
  for (const entry of sched) {
    if (!Array.isArray(entry.rooms) || !entry.rooms.includes(roomId)) continue;
    const [open, close] = entry.hours || [0, 24];
    if (close > open) { if (h >= open && h < close) return true; }
    else              { if (h >= open || h < close) return true; }
  }
  return false;
}
function npcsHere(roomId) {
  const out = new Set();
  for (const n of (STORY.rooms[roomId]?.npcs || [])) {
    const sched = STORY.npcs[n]?.schedule;
    if (!Array.isArray(sched) || sched.length === 0) out.add(n);
  }
  for (const [nid, n] of Object.entries(STORY.npcs || {})) {
    if (Array.isArray(n.schedule) && n.schedule.length > 0 && npcInRoom(nid, roomId)) out.add(nid);
  }
  return [...out];
}

function resolveNpcInRoom(target) {
  const here = npcsHere(player.location);
  if (!target) return null;
  const t = target.toLowerCase().trim();
  if (here.includes(t)) return t;
  let matches = here.filter(id => id.toLowerCase().includes(t));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: matches };
  matches = here.filter(id => (STORY.npcs[id]?.display || '').toLowerCase().includes(t));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: matches };
  return null;
}

function dialogChoiceAvailable(c) {
  if (!c || typeof c !== 'object') return false;
  if (c.requires_flag && !player.flags.has(c.requires_flag)) return false;
  if (c.requires_skill && !player.skills.has(c.requires_skill)) return false;
  if (c.requires_skill_not && player.skills.has(c.requires_skill_not)) return false;
  if (c.requires_flag_not && player.flags.has(c.requires_flag_not)) return false;
  if (c.requires_quest_active && player.quests[c.requires_quest_active]?.state !== 'active') return false;
  if (c.requires_quest_completed && player.quests[c.requires_quest_completed]?.state !== 'completed') return false;
  if (c.requires_item) {
    const have = player.inventory.includes(c.requires_item) || (player.materials[c.requires_item] || 0) > 0;
    if (!have) return false;
  }
  if (typeof c.requires_gold === 'number' && player.gold < c.requires_gold) return false;
  return true;
}
function applyChoiceCost(c) {
  if (typeof c.consume_gold === 'number' && c.consume_gold > 0) player.gold -= c.consume_gold;
  if (c.consume_item) {
    const idx = player.inventory.indexOf(c.consume_item);
    if (idx !== -1) player.inventory.splice(idx, 1);
    else if ((player.materials[c.consume_item] || 0) > 0) player.materials[c.consume_item]--;
  }
}
function showDialogNode(npcId, nodeId) {
  const npc = STORY.npcs[npcId];
  const node = npc.dialogue_trees?.[nodeId];
  if (!node) {
    write('(They have nothing more to say.)', 'system');
    player.dialog_session = null;
    return;
  }
  if (Array.isArray(node.effects) && node.effects.length) {
    runEventEffects({ effects: node.effects });
  }
  const linesRaw = Array.isArray(node.lines) ? node.lines : (node.lines ? [node.lines] : []);
  for (const ln of linesRaw) write(T('{0} says: "{1}"', t(npc.display), t(ln)), 'npc');
  if (node.end) {
    write('(Conversation ends.)', 'system');
    player.dialog_session = null;
    return;
  }
  const choices = (node.choices || []).map((c, idx) => ({ c, idx, available: dialogChoiceAvailable(c) }));
  const visible = choices.filter(x => x.available || !x.c.hide_when_unavailable);
  if (visible.length === 0) {
    write('(They wait. Type "leave" to end the conversation.)', 'system');
    player.dialog_session = { npc_id: npcId, node_id: nodeId };
    return;
  }
  visible.forEach((x, n) => {
    const cost = [];
    if (typeof x.c.consume_gold === 'number' && x.c.consume_gold > 0) cost.push(`${x.c.consume_gold}g`);
    if (x.c.consume_item) cost.push(itemDisplay(x.c.consume_item));
    const tag = x.available ? '' : ' [unavailable]';
    const costStr = cost.length ? ` (${cost.join(', ')})` : '';
    write(`  ${n + 1}. ${t(x.c.label)}${costStr}${tag}`, x.available ? 'system' : 'error');
  });
  write('(Type the number, or "leave" to end.)', 'system');
  player.dialog_session = { npc_id: npcId, node_id: nodeId, _visible: visible.map(x => x.idx) };
}
function chooseDialog(arg) {
  if (!player.dialog_session) { write('You are not in a conversation.', 'error'); return; }
  const { npc_id, node_id, _visible } = player.dialog_session;
  const npc = STORY.npcs[npc_id];
  const node = npc?.dialogue_trees?.[node_id];
  if (!node) { player.dialog_session = null; write('(The thread is lost.)', 'system'); return; }
  const n = parseInt(arg, 10);
  if (!Number.isInteger(n) || n < 1 || !_visible || n > _visible.length) {
    write('Pick a number from the list.', 'error'); return;
  }
  const choice = node.choices[_visible[n - 1]];
  if (!choice) { write('No such choice.', 'error'); return; }
  if (!dialogChoiceAvailable(choice)) { write('You can\'t pick that right now.', 'error'); return; }
  applyChoiceCost(choice);
  if (choice.end) {
    write(`> ${t(choice.label)}`, 'echo');
    write('(Conversation ends.)', 'system');
    player.dialog_session = null;
    return;
  }
  if (!choice.goto) {
    write('(They simply nod.)', 'npc');
    return;
  }
  write(`> ${t(choice.label)}`, 'echo');
  showDialogNode(npc_id, choice.goto);
}
function leaveDialog() {
  if (!player.dialog_session) { write('You are not in a conversation.', 'error'); return; }
  player.dialog_session = null;
  write('(Conversation ends.)', 'system');
}

function talk(target) {
  if (combatBlock('talk')) return;
  if (transformBlock('talk')) return;
  if (player.dialog_session) {
    write('You are already mid-conversation. Pick a number, or type "leave".', 'error');
    return;
  }
  const resolved = resolveNpcInRoom(target);
  if (!resolved) {
    const here = npcsHere(player.location);
    if (here.length === 0) write(`There's no one here to talk to.`, 'error');
    else write(`There's no "${target}" here. Try: ${here.map(n => STORY.npcs[n]?.display || n).join(', ')}.`, 'error');
    return;
  }
  if (resolved.ambiguous) {
    write(`Multiple matches: ${resolved.ambiguous.join(', ')}. Be more specific.`, 'error');
    return;
  }
  target = resolved;
  if (!npcOpen(target)) { write(describeNpcStatus(target) || 'They aren\'t here right now.', 'error'); return; }
  const npc = STORY.npcs[target];
  if (npc.dialogue_trees && (npc.dialogue_trees.default || npc.dialogue_trees.start)) {
    const startNode = npc.dialogue_trees.default ? 'default' : 'start';
    publishAction('talk', { npc: target, location: player.location });
    showDialogNode(target, startNode);
    return;
  }
  let lines = npc.dialogue_seeds || ['...'];
  if (Array.isArray(npc.conditional_dialogue)) {
    for (const cd of npc.conditional_dialogue) {
      const conds = cd.if || [];
      if (conds.every(matchesNpcCondition) && Array.isArray(cd.lines) && cd.lines.length) {
        lines = cd.lines;
        break;
      }
    }
  }
  const line = lines[Math.floor(Math.random() * lines.length)];
  write(T('{0} says: "{1}"', npc.display, line), 'npc');
  const offers = offerQuestsFor(target);
  for (const [qid, q] of offers) {
    write(T('{0} adds: "I have work, if you\'d take it. {1}" (accept {2})', npc.display, q.description, qid), 'npc');
  }
  for (const [qid, ps] of Object.entries(player.quests)) {
    const q = STORY.quests[qid];
    if (q?.giver === target && ps.state === 'active' && questComplete(qid)) {
      write(T('{0} eyes you. "Have you finished {1}? — turn in {2}"', npc.display, q.title, qid), 'npc');
    }
  }
  publishAction('talk', { npc: target, location: player.location });
}

function answer(text) {
  if (combatBlock('answer')) return;
  const room = player.rooms[player.location];
  if (!room.riddle) { write('There is nothing to answer here.', 'error'); return; }
  const r = STORY.riddles[room.riddle];
  if (player.riddles_solved.has(room.riddle) && !r.repeatable) { write('You have already solved this riddle.'); return; }
  const norm = text.toLowerCase().trim();
  if (r.answers.includes(norm)) {
    player.riddles_solved.add(room.riddle);
    player.sparks += r.reward_sparks;
    player.stats.sparks_earned += r.reward_sparks;
    player.stats.riddles_solved++;
    firstTimeMilestone('first_riddle', '🧩 First riddle solved', 'Try other rooms — voices in stones, candles, lakes…');
    gainRenown('riddle');
    write(r.on_solve_message, 'success');
    write(`(+${r.reward_sparks} sparks)`, 'spark');
    fireEvents('on_riddle_solve', { riddle: room.riddle });
    for (const ri of (r.reward_items || [])) {
      if (canCarry(ri.item, ri.qty)) {
        addItem(ri.item, ri.qty);
        write(`You receive ${ri.qty} ${itemDisplay(ri.item)}.`, 'success');
      } else {
        for (let i = 0; i < ri.qty; i++) (player.rooms[player.location].items ||= []).push(ri.item);
        write(`A ${itemDisplay(ri.item)} appears, but it's too heavy to carry — left here for now.`, 'system');
      }
    }
    publishAction('riddle_solved', { location: player.location, gained: r.reward_sparks });
  } else {
    write('The voice is silent. That is not the answer.', 'error');
    publishAction('riddle_attempt', { location: player.location, text: norm });
  }
}

const FEED_CHANNELS = {
  dm:        { label: 'DMs',           classes: ['whisper'], match: /\[dm from /i },
  whisper:   { label: 'whispers',      classes: ['whisper'], match: null },
  combat:    { label: 'combat',        classes: ['combat'],  match: null },
  events:    { label: 'world events',  classes: ['spark', 'system'], match: />>>|world events|stir runs/i },
  npcs:      { label: 'NPC speech',    classes: ['npc'],     match: null },
  rooms:     { label: 'room descriptions', classes: ['room-name','room-desc'], match: null },
  items:     { label: 'item / loot',   classes: ['items','gold'], match: null },
  all:       { label: 'all narration', classes: null,        match: null }
};
function showFeed(typeRaw) {
  const type = (typeRaw || '').trim().toLowerCase();
  if (!type || type === 'help' || type === '?') {
    write('Channels:', 'system');
    for (const [k, v] of Object.entries(FEED_CHANNELS)) write(`  feed ${k}  —  ${v.label}`, 'system');
    return;
  }
  const ch = FEED_CHANNELS[type];
  if (!ch) {
    write(`Unknown channel "${type}". Try "feed" without an arg to see options.`, 'error');
    return;
  }
  const scanFrom = Math.max(0, out.children.length - 500);
  const matches = [];
  for (let i = scanFrom; i < out.children.length; i++) {
    const node = out.children[i]; if (!node) continue;
    const cls = node.className || '';
    if (/\becho\b/.test(cls)) continue;
    const text = node.textContent || '';
    if (ch.classes) {
      const ok = ch.classes.some(c => cls.includes(' ' + c) || cls.endsWith(c));
      if (!ok) continue;
    }
    if (ch.match && !ch.match.test(text)) continue;
    matches.push({ text, cls: cls.replace(/^line\s+/, '').trim() });
  }
  if (matches.length === 0) {
    write(`No recent ${ch.label} to show. (Scanned the last 500 lines.)`, 'system');
    return;
  }
  const tail = matches.slice(-50);
  writeBlock(`=== Feed · ${ch.label} (${tail.length}${matches.length > tail.length ? ` of ${matches.length}` : ''}) ===`, () => {
    for (const m of tail) write(m.text, m.cls);
  }, '── end of feed ──');
}

function showRecap() {
  if (lastFightStartIdx == null) {
    write('No recent fight to recap.', 'system');
    return;
  }
  const lines = [];
  const end = out.children.length;
  for (let i = lastFightStartIdx; i < end; i++) {
    const node = out.children[i];
    if (!node) continue;
    const cls = node.className || '';
    if (/\bcombat\b|\bspark\b|\bsuccess\b|\berror\b/.test(cls) && !/\becho\b/.test(cls)) {
      lines.push({ text: node.textContent || '', cls: cls.replace(/^line\s+/, '').trim() });
    }
  }
  if (lines.length === 0) {
    write('Last fight had no narration captured. (Maybe you just opened it?)', 'system');
    return;
  }
  writeBlock('=== Last fight recap ===', () => {
    for (const l of lines) write(l.text, l.cls);
  }, '── end of recap ──');
}
function hunt() {
  if (!player.skills.has('hunting')) { write('You need the Hunting skill to hunt.', 'error'); return; }
  if (inCombat()) { write('You are already in a fight.', 'error'); return; }
  const room = player.rooms[player.location];
  if (!room.spawn_table?.length) { write('There is nothing to hunt here.', 'error'); return; }
  lastFightStartIdx = out.children.length;
  const pick = pickWeighted(room.spawn_table);
  const ent = STORY.entities[pick.entity];
  player.combat_target = { id: pick.entity, ...structuredClone(ent) };
  const combat_id = uuid();
  player.combat_id = combat_id;
  for (const [otherId, otherSess] of combatSessions) {
    if (otherSess.opener_pubkey === pk && !otherSess.ended) otherSess.ended = true;
  }
  combatSessions.set(combat_id, {
    entity_id: pick.entity, room_id: player.location,
    hp: ent.hp, max_hp: ent.hp,
    opener_pubkey: pk, opener_name: player.name,
    participants: new Set([pk]),
    started_at: Date.now(), last_activity_at: Date.now(), ended: false
  });
  publishCombat('open', {
    combat_id, entity_id: pick.entity, room_id: player.location,
    hp: ent.hp, max_hp: ent.hp, opener_name: player.name
  });
  write(T('You move quietly. A {0} steps into view.', ent.display), 'combat');
  write(`(${ent.summary})`, 'system');
  write(T('Type "attack" to engage, "flee" to back off. Other players here can "assist" you.'), 'combat');
}

function assist(target) {
  if (combatBlock('assist')) return;
  if (inCombat()) { write(T('You are already in a fight.'), 'error'); return; }
  const fresh = freshCombatsForRoom(player.location,  true);
  const idByOpener = new Map();
  for (const [cid, s] of combatSessions) {
    if (fresh.includes(s)) idByOpener.set(s.opener_pubkey, cid);
  }
  const eligible = fresh.map(s => [idByOpener.get(s.opener_pubkey), s]).filter(([cid]) => cid);
  if (eligible.length === 0) {
    write(T('No combat to assist with here. (When another player runs "hunt" in this room, you\'ll see them.)'), 'error');
    return;
  }
  let picked = null;
  if (target && target.trim()) {
    const t2 = target.toLowerCase().trim();
    picked = eligible.find(([_, s]) =>
      (s.opener_name && s.opener_name.toLowerCase().includes(t2)) ||
      s.opener_pubkey.startsWith(t2) ||
      s.opener_pubkey === t2
    );
    if (!picked) {
      write(T('No combat by "{0}" here. Currently fighting: {1}.', target, eligible.map(([_,s]) => s.opener_name || s.opener_pubkey.slice(0,8)+'…').join(', ')), 'error');
      return;
    }
  } else if (eligible.length === 1) {
    picked = eligible[0];
  } else {
    write(T('Multiple combats here. Specify: {0}.', eligible.map(([_,s]) => s.opener_name || s.opener_pubkey.slice(0,8)+'…').join(', ')), 'error');
    return;
  }
  const [combat_id, sess] = picked;
  const ent = STORY.entities[sess.entity_id];
  if (!ent) { write('Cannot determine the entity. (Stale session.)', 'error'); return; }
  player.combat_target = { id: sess.entity_id, ...structuredClone(ent), hp: sess.hp };
  player.combat_id = combat_id;
  sess.participants.add(pk);
  write(T('You join the fight against the {0}! ({1}/{2} hp)', ent.display, sess.hp, sess.max_hp), 'combat');
  write(T('Type "attack" to strike. The kill is shared; drops go to whoever lands the killing blow.'), 'system');
}

function attack() {
  if (!inCombat()) { write('There is nothing to attack.', 'error'); return; }
  const t = player.combat_target;
  const wielded = player.equipment.hand;
  if (wielded) {
    const wEff = STORY.items[wielded]?.effects || {};
    if (wEff.requires_ammo) {
      const ammoId = wEff.requires_ammo;
      const need = wEff.ammo_per_shot || 1;
      const haveInv = player.inventory.filter(i => i === ammoId).length;
      const haveMat = player.materials[ammoId] || 0;
      if (haveInv + haveMat < need) {
        write(T('Out of {0}. The {1} clicks empty — you swing with bare hands instead.', itemDisplay(ammoId), itemDisplay(wielded)), 'error');
        var __noAmmo = true;
      } else {
        let toConsume = need;
        const fromMat = Math.min(toConsume, haveMat);
        if (fromMat > 0) { player.materials[ammoId] -= fromMat; toConsume -= fromMat; }
        for (let i = 0; i < toConsume; i++) {
          const idx = player.inventory.indexOf(ammoId);
          if (idx !== -1) player.inventory.splice(idx, 1);
        }
      }
    }
  }
  const dmgType = (typeof __noAmmo !== 'undefined' && __noAmmo) ? null : STORY.items[wielded]?.effects?.damage_type;
  let typeMod = 1;
  if (dmgType && t.weaknesses?.includes(dmgType)) typeMod = 1.5;
  else if (dmgType && t.resistances?.includes(dmgType)) typeMod = 0.5;
  const critChance = 0.08 + (player.skills.has('hunting') ? 0.07 : 0);
  const crit = Math.random() < critChance;
  let weaponBonus = (typeof __noAmmo !== 'undefined' && __noAmmo) ? 0 : bestWeaponBonus();
  if (player.transformed === 'wolf') weaponBonus = 0;
  const baseDmg = randInt(2, 5) + weaponBonus + (player.skills.has('hunting') ? 2 : 0);
  const chargeMod = player.charge_pending ? 1.5 : 1;
  let formMod = 1;
  if (player.transformed === 'wolf') { formMod = 1.5; }
  else if (player.transformed === 'bat') { formMod = 1.2; }
  const playerDmg = Math.max(1, Math.floor(baseDmg * typeMod * (crit ? 2 : 1) * chargeMod * formMod));
  if (player.charge_pending) {
    write(T('You charge — your blow comes in fast and reckless.'), 'spark');
    player.charge_pending = false;
    player.charge_recoil = true;
  }
  let didDamage = 0;
  if (Math.random() < (t.evasion || 0)) {
    write(T('You miss the {0}.', t.display), 'combat');
  } else {
    t.hp -= playerDmg;
    didDamage = playerDmg;
    let mod = '';
    if (typeMod === 1.5) mod = T(' (effective)');
    else if (typeMod === 0.5) mod = T(' (glancing)');
    if (crit) mod += T(' — critical strike!');
    write(T('You strike the {0} for {1} damage{2}. ({3} HP left)', t.display, playerDmg, mod, Math.max(0, t.hp)), crit ? 'spark' : 'success');
    if (player.transformed === 'bat' && didDamage > 0) {
      const heal = Math.floor(didDamage / 2);
      if (heal > 0) {
        const before = player.life;
        player.life = Math.min(computeMaxLife(), player.life + heal);
        const got = Math.floor(player.life - before);
        if (got > 0) write(T('The blood comes to you as warmth. (+{0} life)', got), 'spark');
      }
    }
  }
  if (player.combat_id && didDamage > 0) {
    const sess = combatSessions.get(player.combat_id);
    if (sess) {
      sess.hp = Math.min(sess.hp, t.hp);
      sess.participants.add(pk);
      publishCombat('damage', {
        combat_id: player.combat_id, entity_id: t.id, room_id: player.location,
        hp_after: sess.hp, attacker_pubkey: pk, attacker_name: player.name, dmg: didDamage
      });
    }
  }
  if (player.companion && player.companion.hp > 0 && t.hp > 0) {
    const cDmg = randInt(player.companion.attack_min, player.companion.attack_max);
    t.hp -= cDmg;
    write(`Your ${STORY.entities[player.companion.entity].display} bites the ${t.display} for ${cDmg}.`, 'success');
  }
  if (wielded && DURABLE_WEAPONS[wielded]) {
    const cur = player.edges.has(wielded) ? player.edges.get(wielded) : DURABLE_WEAPONS[wielded].max;
    const next = cur - 1;
    if (next <= 0) {
      const dgr = DURABLE_WEAPONS[wielded].downgrade;
      player.edges.delete(wielded);
      delete player.equipment.hand;
      if (dgr) {
        player.inventory.push(dgr);
        if (STORY.items[dgr]?.slot === 'hand') {
          const idx = player.inventory.indexOf(dgr);
          if (idx !== -1) { player.inventory.splice(idx, 1); player.equipment.hand = dgr; }
        }
        write(`Your ${itemDisplay(wielded)} dulls beyond use. You're left holding ${itemDisplay(dgr, true)}.`, 'error');
      } else {
        write(`Your ${itemDisplay(wielded)} shatters. Useless now.`, 'error');
      }
    } else {
      player.edges.set(wielded, next);
      if (next <= 3) write(`Your ${itemDisplay(wielded)} is dulling — ${next} good strike${next === 1 ? '' : 's'} left.`, 'system');
    }
  }
  if (t.hp <= 0) {
    const sess = player.combat_id ? combatSessions.get(player.combat_id) : null;
    if (sess && sess.ended) {
      write(`The ${t.display} falls — but someone else struck the killing blow first. Kill credit yours, drops to them.`, 'system');
      player.stats.kills[t.id] = (player.stats.kills[t.id] || 0) + 1;
      for (const ps of Object.values(player.quests)) {
        if (ps.state === 'active') ps.kills[t.id] = (ps.kills[t.id] || 0) + 1;
      }
      fireEvents('on_kill', { entity: t.id });
      player.combat_target = null;
      player.combat_id = null;
      return;
    }
    write(T('The {0} falls.', t.display), 'success');
    firstTimeMilestone('first_kill', '⚔ First kill', `Your first ${t.display}. The world records the deed.`);
    try {
      const total = Object.values(player.stats?.kills || {}).reduce((a, b) => a + b, 0) + 1;
      checkCountMilestones('kills', total, [10, 50, 100, 500],
        n => `⚔ ${n} kills`,
        n => 'Hunting becomes a livelihood.');
    } catch {}
    const allDrops = [...t.base_drops];
    if (player.skills.has('skinning')) allDrops.push(...t.skinning_drops);
    for (const rd of (t.rare_drops || [])) {
      if (Math.random() < (rd.chance || 0)) allDrops.push({ item: rd.item, qty: rd.qty });
    }
    let summary = [];
    let leftBehind = [];
    for (const d of allDrops) {
      if (canCarry(d.item, d.qty)) { addItem(d.item, d.qty); summary.push(`${d.qty} ${itemDisplay(d.item)}`); }
      else leftBehind.push(`${d.qty} ${itemDisplay(d.item)}`);
    }
    if (summary.length) write(T('You gain: {0}.', summary.join(', ')), 'success');
    if (leftBehind.length) {
      const overflowItems = allDrops.filter((_, i) => leftBehind.length > 0).map(d => ({ item: d.item, qty: d.qty }));
      publishItemDrop(overflowItems, 'overflow');
      write(`Too heavy to carry: ${leftBehind.join(', ')} — left as a drop you can return for.`, 'error');
    }
    if (!player.skills.has('skinning') && t.skinning_drops.length)
      write('(With Skinning, kills also yield hide.)', 'system');
    publishAction('killed', { entity: t.id, location: player.location });
    if (player.combat_id) {
      if (sess) sess.ended = true;
      publishCombat('end', {
        combat_id: player.combat_id, entity_id: t.id, room_id: player.location,
        killer_pubkey: pk, killer_name: player.name
      });
      const others = sess ? [...sess.participants].filter(x => x !== pk) : [];
      if (others.length) write(T('(Shared kill credit goes to {0} other fighter{1} in this combat.)', others.length, others.length === 1 ? '' : 's'), 'system');
    }
    player.stats.kills[t.id] = (player.stats.kills[t.id] || 0) + 1;
    for (const ps of Object.values(player.quests)) {
      if (ps.state === 'active') ps.kills[t.id] = (ps.kills[t.id] || 0) + 1;
    }
    const isUnique = (STORY.entities[t.id]?.tags || []).includes('unique');
    gainRenown(isUnique ? 'kill_unique' : 'kill');
    player.recent_kills.push({ entity: t.id, turn: player.turn });
    if (player.recent_kills.length > 10) player.recent_kills.shift();
    notifyBountyClaimable(t.id);
    tickWorldEventProgress('kill', { entity: t.id });
    fireEvents('on_kill', { entity: t.id });
    player.combat_target = null;
    player.combat_id = null;
    player.parry_ready = false; player.charge_pending = false; player.charge_recoil = false; player.charge_used_this_combat = false;
    return;
  }
  let enemyDmg = randInt(t.attack_damage_range[0], t.attack_damage_range[1]);
  if (player.companion && player.companion.hp > 0) {
    const absorbed = Math.floor(enemyDmg / 2);
    enemyDmg -= absorbed;
    player.companion.hp -= absorbed;
    write(`The ${t.display}'s blow lands partly on your ${STORY.entities[player.companion.entity].display} (${absorbed} dmg, ${Math.max(0, player.companion.hp)} hp left).`, 'error');
    if (player.companion.hp <= 0) {
      const name = STORY.entities[player.companion.entity].display;
      write(`Your ${name} falls. The world is quieter.`, 'error');
      player.companion = null;
    }
  }
  let dodgeChance = profileBonus('evasion_bonus') + (profileAttribute('agi') / 40);
  if (player.transformed === 'bat') dodgeChance += 0.2;
  if (player.parry_ready) {
    dodgeChance += 0.6;
    player.parry_ready = false;
  }
  if (dodgeChance > 0 && Math.random() < dodgeChance) {
    write(T('You twist aside; the {0}\'s blow misses.', t.display), 'success');
    return;
  }
  if (player.charge_recoil) {
    enemyDmg = Math.floor(enemyDmg * 1.5);
    player.charge_recoil = false;
    write(T('Your charge cost you composure — the blow lands harder.'), 'error');
  }
  enemyDmg = applyDefense(enemyDmg);
  player.life -= enemyDmg;
  write(T('The {0} bites you for {1} damage. ({2}/{3} life)', t.display, enemyDmg, Math.max(0, Math.floor(player.life)), computeMaxLife()), 'error');
  if (player.life > 0) fireEvents('on_attacked', { entity: t.id, dmg: enemyDmg, source: 'attack' });
  if (player.life <= 0) handleDeath(`killed by ${t.display}`);
}

function flee() {
  if (!inCombat()) { write('There is nothing to flee from.', 'error'); return; }
  const t = player.combat_target;
  let enemyDmg = randInt(t.attack_damage_range[0], t.attack_damage_range[1]);
  enemyDmg = applyDefense(enemyDmg);
  player.life -= enemyDmg;
  write(`You scramble away. The ${t.display} catches you for ${enemyDmg} parting damage.`, 'error');
  if (player.life > 0) fireEvents('on_attacked', { entity: t.id, dmg: enemyDmg, source: 'flee' });
  player.combat_target = null;
  player.combat_id = null;
  player.parry_ready = false; player.charge_pending = false; player.charge_recoil = false; player.charge_used_this_combat = false;
  if (player.life <= 0) handleDeath(`killed by ${t.display} while fleeing`);
}

function parry() {
  if (!inCombat()) { write('There is nothing to parry.', 'error'); return; }
  if (!player.equipment.hand) {
    write('You need a weapon wielded to parry.', 'error'); return;
  }
  const t = player.combat_target;
  player.parry_ready = true;
  write(T('You take a parry stance, weapon raised, watching the {0}.', t.display), 'success');
  let enemyDmg = randInt(t.attack_damage_range[0], t.attack_damage_range[1]);
  if (player.companion && player.companion.hp > 0) {
    const absorbed = Math.floor(enemyDmg / 2);
    enemyDmg -= absorbed;
    player.companion.hp -= absorbed;
    write(`The ${t.display}'s blow lands partly on your ${STORY.entities[player.companion.entity].display} (${absorbed} dmg, ${Math.max(0, player.companion.hp)} hp left).`, 'error');
    if (player.companion.hp <= 0) { write(`Your ${STORY.entities[player.companion.entity].display} falls.`, 'error'); player.companion = null; }
  }
  let dodgeChance = profileBonus('evasion_bonus') + (profileAttribute('agi') / 40) + 0.6;
  player.parry_ready = false;
  if (Math.random() < dodgeChance) {
    write(T('Your blade meets theirs — the blow turns aside.'), 'success');
    return;
  }
  enemyDmg = applyDefense(Math.max(1, Math.floor(enemyDmg / 2)));
  player.life -= enemyDmg;
  write(T('You catch most of the blow; {0} damage gets through. ({1}/{2} life)', enemyDmg, Math.max(0, Math.floor(player.life)), computeMaxLife()), 'error');
  if (player.life > 0) fireEvents('on_attacked', { entity: t.id, dmg: enemyDmg, source: 'parry' });
  if (player.life <= 0) handleDeath(`killed by ${t.display}`);
}

function charge() {
  if (!inCombat()) { write('There is nothing to charge.', 'error'); return; }
  if (!player.skills.has('hunting')) {
    write('Charging into combat takes the Hunting skill.', 'error'); return;
  }
  if (player.charge_used_this_combat) {
    write('You already committed your charge this fight.', 'error'); return;
  }
  if (player.charge_pending) {
    write('You are already mid-charge — type "attack" to deliver the blow.', 'system');
    return;
  }
  player.charge_pending = true;
  player.charge_used_this_combat = true;
  const t = player.combat_target;
  write(T('You drop your shoulder and charge the {0}. (Your next "attack" will land 1.5× — but expect a counter-hit.)', t.display), 'spark');
}

function retreat() {
  if (!inCombat()) { write('There is nothing to retreat from.', 'error'); return; }
  const t = player.combat_target;
  let chance = 0.7 + (player.skills.has('hunting') ? 0.2 : 0) + (profileAttribute('agi') / 60);
  chance = Math.min(0.95, chance);
  if (Math.random() < chance) {
    write(T('You step back, watching for the lunge — and break clean. The {0} doesn\'t pursue.', t.display), 'success');
    player.combat_target = null;
    player.combat_id = null;
    player.parry_ready = false; player.charge_pending = false; player.charge_recoil = false;
    return;
  }
  write(T('You try to retreat — but the {0} reads you.', t.display), 'error');
  flee();
}

function eat(arg) {
  if (!arg || !String(arg).trim()) { write('Eat what? Try "eat <food>" or "eat <qty> <food>" — see "inv" for what you carry.', 'error'); return; }
  const parts = String(arg).trim().split(/\s+/);
  let qty = 1, query = parts.join(' ');
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    const n = parseInt(parts[0], 10);
    if (n < 1) { write('Quantity must be at least 1.', 'error'); return; }
    qty = n;
    query = parts.slice(1).join(' ');
  }
  let itemId = null;
  const idx = findItemIn(player.inventory, query);
  if (idx !== -1) itemId = player.inventory[idx];
  else { const matKey = findMaterialKey(query); if (matKey) itemId = matKey; }
  if (!itemId) { write(`You don't have "${query}".`, 'error'); return; }
  const it = STORY.items[itemId];
  if (it.consumable_action !== 'eat' && !it.tags?.includes('food')) { write(`You can't eat ${it.display}.`, 'error'); return; }
  const have = it.stackable ? (player.materials[itemId] || 0) : player.inventory.filter(i => i === itemId).length;
  if (have < 1) { write(`You don't have ${itemDisplay(itemId)}.`, 'error'); return; }
  const eatQty = Math.min(qty, have);
  removeFromInventoryOrMaterials(itemId, eatQty);
  const perItemRestore = it.effects?.restore_life ?? 0;
  const totalRestore = perItemRestore * eatQty;
  const before = player.life;
  player.life = Math.min(computeMaxLife(), player.life + totalRestore);
  const actualRestore = Math.round(player.life - before);
  if (eatQty === 1) write(`You eat ${itemDisplay(itemId, true)}. (+${actualRestore} life)`, 'success');
  else write(`You eat ${eatQty}× ${itemDisplay(itemId)}. (+${actualRestore} life${eatQty < qty ? `, only ${eatQty} on hand` : ''})`, 'success');
  publishAction('eat', { item: itemId, qty: eatQty, restore: actualRestore });
}

function drink(arg) {
  const room = player.rooms[player.location];
  if (room.drink_source && !arg) {
    const cdKey = `drink:${player.location}`;
    const next = player.drink_cooldowns.get(cdKey) || 0;
    if (Date.now() < next) { write(`Wait ${Math.ceil((next - Date.now()) / 1000)}s.`, 'error'); return; }
    const r = room.drink_source.restore_life;
    player.life = Math.min(computeMaxLife(), player.life + r);
    if (room.drink_source.cooldown_seconds) player.drink_cooldowns.set(cdKey, Date.now() + room.drink_source.cooldown_seconds * 1000);
    write(`You drink. (+${r} life)`, 'success');
    publishAction('drink', { location: player.location, restore: r });
    return;
  }
  if (!arg) { write('There is no water here.', 'error'); return; }
  let itemId = null;
  const idx = findItemIn(player.inventory, arg);
  if (idx !== -1) itemId = player.inventory[idx];
  else { const matKey = findMaterialKey(arg); if (matKey) itemId = matKey; }
  if (!itemId) { write(`You don't have "${arg}".`, 'error'); return; }
  const it = STORY.items[itemId];
  if (it.consumable_action !== 'drink') { write(`You can't drink ${it.display}.`, 'error'); return; }
  removeFromInventoryOrMaterials(itemId, 1);
  const restore = it.effects?.restore_life ?? 0;
  player.life = Math.min(computeMaxLife(), player.life + restore);
  write(`You drink ${itemDisplay(itemId, true)}. (+${restore} life)`, 'success');
  publishAction('drink', { item: itemId, restore });
}

const EQUIP_SLOTS = ['head','torso','feet','belt','neck','hand','back'];

function itemSlotScore(itemId) {
  const ef = STORY.items[itemId]?.effects || {};
  let s = 0;
  s += (ef.attack_bonus || 0) * 3;
  s += (ef.defense_bonus || 0) * 2;
  s += (ef.life_max_bonus || 0) * 1.5;
  s += (ef.carry_capacity_bonus || 0) * 0.4;
  if (ef.evasion_bonus) s += ef.evasion_bonus * 30;
  return s;
}
function quickEquipSlot(slot) {
  let bestId = null, bestScore = -Infinity;
  for (const id of player.inventory) {
    const it = STORY.items[id];
    if (!it || it.slot !== slot) continue;
    if (player.edges?.has(id)) continue;
    const s = itemSlotScore(id);
    if (s > bestScore) { bestScore = s; bestId = id; }
  }
  if (!bestId) {
    for (const id of player.inventory) {
      const it = STORY.items[id];
      if (!it || it.slot !== slot) continue;
      const s = itemSlotScore(id);
      if (s > bestScore) { bestScore = s; bestId = id; }
    }
  }
  return bestId;
}
function equipmentDiffSummary(oldId, newId) {
  const oldEf = oldId ? (STORY.items[oldId]?.effects || {}) : {};
  const newEf = newId ? (STORY.items[newId]?.effects || {}) : {};
  const stats = [
    ['attack_bonus', 'attack'],
    ['defense_bonus', 'defense'],
    ['life_max_bonus', 'max life'],
    ['carry_capacity_bonus', 'carry'],
    ['evasion_bonus', 'evasion']
  ];
  const parts = [];
  for (const [key, label] of stats) {
    const o = oldEf[key] || 0;
    const n = newEf[key] || 0;
    const d = n - o;
    if (d === 0) continue;
    const sign = d > 0 ? '+' : '';
    const fmt = (key === 'evasion_bonus') ? `${sign}${(d * 100).toFixed(0)}%` : `${sign}${d}`;
    parts.push(`${fmt} ${label}`);
  }
  if (!parts.length) return '';
  return ` — ${parts.join(', ')}` + (oldId ? ` (was: ${STORY.items[oldId]?.display || oldId})` : '');
}
function wear(arg) {
  if (combatBlock('wear')) return;
  if (!arg) { write('Wear what?', 'error'); return; }
  let resolved = arg;
  if (EQUIP_SLOTS.includes(arg.toLowerCase())) {
    const slot = arg.toLowerCase();
    const best = quickEquipSlot(slot);
    if (!best) {
      write(`Nothing in your inventory fits the ${slot} slot.`, 'error');
      return;
    }
    resolved = best;
  }
  const idx = findItemIn(player.inventory, resolved);
  if (idx === -1) { write(`You don't have "${arg}".`, 'error'); return; }
  const itemId = player.inventory[idx];
  const it = STORY.items[itemId];
  if (!it.slot) { write(`You can't wear ${it.display}.`, 'error'); return; }
  const existing = player.equipment[it.slot];
  if (existing) {
    player.inventory.push(existing);
    write(`You take off ${itemDisplay(existing, true)}.`, 'system');
  }
  player.inventory.splice(idx, 1);
  player.equipment[it.slot] = itemId;
  const diff = equipmentDiffSummary(existing, itemId);
  write(`You put on ${itemDisplay(itemId, true)}.${diff}`, 'success');
  publishAction('wear', { item: itemId, slot: it.slot });
}

function unwear(arg) {
  if (combatBlock('unwear')) return;
  if (!arg) { write('Unwear what? (slot or item name)', 'error'); return; }
  let slot;
  if (EQUIP_SLOTS.includes(arg)) slot = arg;
  else {
    for (const [s, id] of Object.entries(player.equipment)) {
      const itd = STORY.items[id]?.display || '';
      if (id === arg || itd.includes(arg) || itd.split(' ').includes(arg)) { slot = s; break; }
    }
  }
  if (!slot || !player.equipment[slot]) { write('You\'re not wearing that.', 'error'); return; }
  const itemId = player.equipment[slot];
  delete player.equipment[slot];
  player.inventory.push(itemId);
  write(`You take off ${itemDisplay(itemId, true)}.`, 'success');
  publishAction('unwear', { item: itemId, slot });
}

function paperDollLine(slot, item, width) {
  const label = slot.padEnd(7);
  const display = item ? itemDisplay(item) : '—';
  const text = item ? (STORY.items[item]?.display || item) : '—';
  return `${label} ${text}`;
}
function showEquipment() {
  writeBlock('=== Equipment ===', () => {
    const eq = player.equipment || {};
    const slots = ['head', 'torso', 'hand', 'feet', 'back'];
    const lines = [
      '         ┌──────┐',
      `  head ──┤ ${(eq.head ? '●' : '○')}    ├── ${eq.head ? (STORY.items[eq.head]?.display || eq.head) : '(nothing)'}`,
      '         ├──────┤',
      `  torso ─┤ ${(eq.torso ? '●' : '○')} ${(eq.back ? '●' : '○')}  ├── ${eq.torso ? (STORY.items[eq.torso]?.display || eq.torso) : '(nothing)'}` + (eq.back ? `  · back: ${STORY.items[eq.back]?.display || eq.back}` : ''),
      `  hand ──┤ ${(eq.hand ? '●' : '○')}    ├── ${eq.hand ? (STORY.items[eq.hand]?.display || eq.hand) : '(nothing)'}`,
      '         ├──────┤',
      `  feet ──┤ ${(eq.feet ? '●' : '○') + ' ' + (eq.feet ? '●' : '○')}  ├── ${eq.feet ? (STORY.items[eq.feet]?.display || eq.feet) : '(nothing)'}`,
      '         └──────┘'
    ];
    for (const l of lines) write(l);
    let lifeBonus = 0, carryBonus = 0, attackBonus = 0;
    const def = totalDefenseBonus();
    for (const slot of slots) {
      const item = eq[slot]; if (!item) continue;
      const ef = STORY.items[item]?.effects || {};
      if (ef.life_max_bonus) lifeBonus += ef.life_max_bonus;
      if (ef.carry_capacity_bonus) carryBonus += ef.carry_capacity_bonus;
      if (ef.attack_bonus) attackBonus += ef.attack_bonus;
    }
    write('');
    const bonusParts = [];
    if (lifeBonus)   bonusParts.push(`+${lifeBonus} life`);
    if (carryBonus)  bonusParts.push(`+${carryBonus} carry`);
    if (attackBonus) bonusParts.push(`+${attackBonus} attack`);
    if (def)         bonusParts.push(`+${def} defense`);
    if (bonusParts.length) write(`Net bonuses: ${bonusParts.join(' · ')}`, 'success');
    else write('Net bonuses: none — equip items to gain stat bonuses.', 'echo');
    const customSlots = Object.keys(eq).filter(s => !slots.includes(s));
    if (customSlots.length) {
      write('');
      write('Other slots:', 'system');
      for (const s of customSlots) write(`  ${s}: ${itemDisplay(eq[s], true)}`);
    }
  }, '── end of equipment ──');
}

function questProgress(qid) {
  const q = STORY.quests[qid];
  const ps = player.quests[qid];
  if (!q || !ps) return [];
  return q.objectives.map(obj => {
    let cur = 0, target = obj.qty || 1, label = '';
    if (obj.type === 'have_item') {
      cur = (player.materials[obj.item] || 0) + player.inventory.filter(i => i === obj.item).length;
      label = `Have ${target} ${itemDisplay(obj.item)}`;
    } else if (obj.type === 'kill') {
      cur = ps.kills[obj.entity] || 0;
      label = `Kill ${target} ${STORY.entities[obj.entity]?.display || obj.entity}`;
    } else if (obj.type === 'visited') {
      const rooms = obj.room ? [obj.room] : (obj.rooms || []);
      cur = rooms.some(r => ps.visited.includes(r)) ? 1 : 0;
      target = 1;
      label = `Visit ${rooms.map(r => SHORT_NAMES[r] || r).join(' or ')}`;
    }
    return { obj, cur, target, done: cur >= target, label };
  });
}
function questComplete(qid) {
  const ps = player.quests[qid];
  if (!ps || ps.state !== 'active') return false;
  return questProgress(qid).every(p => p.done);
}
function showQuests() {
  const active = [];
  const completed = [];
  for (const [qid, ps] of Object.entries(player.quests)) {
    const q = STORY.quests[qid]; if (!q) continue;
    if (ps.state === 'completed') completed.push([qid, q, ps]);
    else active.push([qid, q, ps]);
  }
  if (active.length === 0 && completed.length === 0) {
    write('No active quests. Talk to NPCs to find work.');
    return;
  }
  if (active.length) {
    write('-- Active quests --', 'system');
    for (const [qid, q] of active) {
      const tag = q.recurrence === 'daily' ? '  [DAILY — expires at dawn]' : '';
      write(`  ${qid}  —  ${q.title}${tag}`, 'spark');
      write(`    ${q.description}`);
      const prog = questProgress(qid);
      for (const p of prog) {
        const mark = p.done ? '✓' : '·';
        const cur = Math.min(p.cur, p.target);
        const filled = Math.min(8, Math.round((cur / Math.max(1, p.target)) * 8));
        const bar = '▓'.repeat(filled) + '░'.repeat(8 - filled);
        write(`    [${mark}] ${p.label}  ${bar} ${cur}/${p.target}`);
      }
      if (questComplete(qid) && q.giver) {
        write(`    → Ready! Find ${STORY.npcs[q.giver]?.display || q.giver} and "turn in ${qid}".`, 'success');
      } else if (questComplete(qid) && !q.giver) {
        write(`    → Ready! Type "turn in ${qid}".`, 'success');
      }
    }
  }
  if (completed.length) {
    write('-- Completed --', 'system');
    for (const [qid, q] of completed) write(`  ✓ ${qid}  —  ${q.title}`, 'success');
  }
}
function acceptQuest(qid) {
  if (combatBlock('accept')) return;
  if (!qid) { write('Accept what? Usage: accept <quest_id>. See "quests" for offered quests.', 'error'); return; }
  const q = STORY.quests[qid];
  if (!q) { write(`No such quest "${qid}". Type "quests" to see available quests.`, 'error'); return; }
  if (player.quests[qid]) { write('You already have that quest.'); return; }
  if (!questRequiresMet(q)) {
    const missing = (q.requires || []).filter(r => player.quests[r]?.state !== 'completed');
    if (typeof q.requires_renown_gte === 'number' && (player.renown || 0) < q.requires_renown_gte) {
      write(`That quest isn't offered to you yet. The giver wants more standing first (${player.renown || 0}/${q.requires_renown_gte} renown).`, 'error');
    } else {
      write(`That quest isn't available yet. First complete: ${missing.join(', ')}.`, 'error');
    }
    return;
  }
  if (q.giver) {
    if (!npcsHere(player.location).includes(q.giver)) {
      write(`${STORY.npcs[q.giver]?.display || q.giver} would have to give you that quest.`, 'error');
      return;
    }
  }
  player.quests[qid] = { state: 'active', kills: {}, visited: [] };
  write(`Quest accepted: ${q.title}`, 'spark');
  write(`  ${q.description}`);
  publishAction('quest_accept', { quest: qid });
}
function turnInQuest(qid) {
  if (combatBlock('turn')) return;
  if (!qid) { write('Turn in what? Usage: turn in <quest_id>. See "quests" for active quests.', 'error'); return; }
  const q = STORY.quests[qid];
  const ps = player.quests[qid];
  if (!q || !ps) { write(`You don't have a quest called "${qid}". Type "quests" to see what you have.`, 'error'); return; }
  if (ps.state !== 'active') { write('Already turned in.'); return; }
  if (q.giver) {
    if (!npcsHere(player.location).includes(q.giver)) {
      write(`Bring this to ${STORY.npcs[q.giver]?.display || q.giver}.`, 'error');
      return;
    }
  }
  if (!questComplete(qid)) { write(`Objectives not yet met. Type "quests" to see progress.`, 'error'); return; }
  for (const obj of q.objectives) {
    if (obj.type === 'have_item' && obj.consume !== false) {
      removeFromInventoryOrMaterials(obj.item, obj.qty || 1);
    }
  }
  const r = q.rewards || {};
  if (r.gold)   { player.gold += r.gold; player.stats.gold_earned += r.gold; }
  if (r.sparks) { player.sparks += r.sparks; player.stats.sparks_earned += r.sparks; }
  for (const ri of (r.items || [])) {
    if (canCarry(ri.item, ri.qty)) addItem(ri.item, ri.qty);
    else (player.rooms[player.location].items ||= []).push(ri.item);
  }
  ps.state = 'completed';
  player.stats.quests_completed++;
  firstTimeMilestone('first_quest', '✓ First quest complete', 'Talk to NPCs for more — most stories have chains.');
  checkCountMilestones('quests', player.stats.quests_completed, [10, 25, 50],
    n => `✓ ${n} quests completed`,
    n => 'A reliable hand. NPCs notice.');
  gainRenown('quest');
  if (q.recurrence === 'daily') {
    player.daily_quests_completed++;
    player.daily_quest_active = null;
  }
  fireEvents('on_quest_complete', { quest: qid });
  write(q.completion_message || `Quest complete: ${q.title}`, 'success');
  const reward_parts = [];
  if (r.gold)   reward_parts.push(`${r.gold} gold`);
  if (r.sparks) reward_parts.push(`${r.sparks} sparks`);
  for (const ri of (r.items || [])) reward_parts.push(`${ri.qty} ${itemDisplay(ri.item)}`);
  if (reward_parts.length) write(`Rewards: ${reward_parts.join(', ')}`, 'spark');
  publishAction('quest_complete', { quest: qid });
  const completionRaw = typeof q.completion_message === 'string' ? q.completion_message : (q.completion_message?.en || '');
  const endMatch = /^>>>\s*ENDING:\s*([A-Za-z0-9_\-]+)\s*<<<$/m.exec(completionRaw);
  if (endMatch) {
    const tag = endMatch[1].toUpperCase();
    triggerStoryEnding(tag);
  }
}
function fireEvents(triggerType, params = {}) {
  const evts = STORY.events || {};
  for (const [eid, evt] of Object.entries(evts)) {
    if (evt.trigger !== triggerType) continue;
    if (evt.once && player.events_fired.has(eid)) continue;
    if (!matchesEventParams(evt, params)) continue;
    if (!checkEventConditions(evt)) continue;
    if (typeof evt.chance === 'number' && evt.chance < 1) {
      if (Math.random() >= evt.chance) continue;
    }
    runEventEffects(evt);
    if (evt.once) player.events_fired.add(eid);
  }
}
function matchesEventParams(evt, params) {
  const tp = evt.trigger_params || {};
  switch (evt.trigger) {
    case 'on_kill':           return !tp.entity || tp.entity === params.entity;
    case 'on_attacked':       return !tp.entity || tp.entity === params.entity;
    case 'on_room_enter':     return !tp.room || tp.room === params.room;
    case 'on_riddle_solve':   return !tp.riddle || tp.riddle === params.riddle;
    case 'on_quest_complete': return !tp.quest || tp.quest === params.quest;
    case 'on_turn':           return !tp.turn_gte || player.turn >= tp.turn_gte;
    case 'on_craft':          return !tp.recipe || tp.recipe === params.recipe;
  }
  return true;
}
function checkEventConditions(evt) {
  for (const c of (evt.conditions || [])) {
    if (c.type === 'has_flag'    && !player.flags.has(c.flag)) return false;
    if (c.type === '!has_flag'   && player.flags.has(c.flag)) return false;
    if (c.type === 'has_skill'   && !player.skills.has(c.skill)) return false;
    if (c.type === '!has_skill'  && player.skills.has(c.skill)) return false;
    if (c.type === 'kills_gte'   && (player.stats.kills[c.entity] || 0) < c.qty) return false;
    if (c.type === 'day_gte'     && (Math.floor(player.turn / (STORY.meta.turns_per_day || 96)) + 1) < c.qty) return false;
    if (c.type === 'quests_completed_gte' && Object.values(player.quests).filter(q => q.state === 'completed').length < c.qty) return false;
    if (c.type === 'renown_gte' && (player.renown || 0) < (c.qty || 0)) return false;
    if (c.type === 'renown_lt'  && (player.renown || 0) >= (c.qty || 0)) return false;
    if (c.type === 'crafts_of_gte') {
      const n = (player.stats.crafts_per_recipe && player.stats.crafts_per_recipe[c.recipe]) || 0;
      if (n < (c.qty || 0)) return false;
    }
    if (c.type === 'riddles_solved_gte' && (player.stats.riddles_solved || 0) < (c.qty || 0)) return false;
  }
  return true;
}
function runEventEffects(evt) {
  for (const e of (evt.effects || [])) {
    if (e.type === 'narrate')        write(e.text || '', e.cls || 'spark');
    else if (e.type === 'set_flag')  player.flags.add(e.flag);
    else if (e.type === 'unset_flag')player.flags.delete(e.flag);
    else if (e.type === 'give_item') {
      if (canCarry(e.item, e.qty || 1)) addItem(e.item, e.qty || 1);
      else (player.rooms[player.location].items ||= []).push(e.item);
      write(`You receive ${e.qty || 1} ${itemDisplay(e.item)}.`, 'success');
    }
    else if (e.type === 'spark_award') { const n = e.qty || 0; player.sparks += n; player.stats.sparks_earned += n; write(`(+${n} sparks)`, 'spark'); }
    else if (e.type === 'gold_award')  { const n = e.qty || 0; player.gold += n;   player.stats.gold_earned += n;   write(`(+${n} gold)`, 'gold'); }
    else if (e.type === 'grant_skill') {
      if (!STORY.skills[e.skill]) { console.warn('grant_skill: unknown skill', e.skill); continue; }
      if (player.skills.has(e.skill)) continue;
      player.skills.add(e.skill);
      const sk = STORY.skills[e.skill];
      write(`>>> A new skill stirs: ${t(sk.display)}.`, 'spark');
      if (sk.unlocks?.verbs?.length)   write(`    New verbs: ${sk.unlocks.verbs.join(', ')}`, 'success');
      if (sk.unlocks?.recipes?.length) write(`    New recipes: ${sk.unlocks.recipes.join(', ')}`, 'success');
      publishAction('skill_granted', { skill: e.skill });
    }
    else if (e.type === 'revoke_skill') {
      if (!player.skills.has(e.skill)) continue;
      player.skills.delete(e.skill);
      const sk = STORY.skills[e.skill];
      write(`>>> The ${t(sk?.display || e.skill)} leaves you.`, 'system');
      publishAction('skill_revoked', { skill: e.skill });
    }
  }
}

function questRequiresMet(q) {
  if (q.requires && q.requires.length > 0) {
    if (!q.requires.every(req => player.quests[req]?.state === 'completed')) return false;
  }
  if (typeof q.requires_renown_gte === 'number' && (player.renown || 0) < q.requires_renown_gte) return false;
  return true;
}
function offerQuestsFor(npcId) {
  const offers = [];
  for (const [qid, q] of Object.entries(STORY.quests || {})) {
    if (q.giver !== npcId) continue;
    if (q.recurrence === 'daily') continue;
    if (player.quests[qid]) continue;
    if (!questRequiresMet(q)) continue;
    offers.push([qid, q]);
  }
  return offers;
}

function advanceDailyQuest(currentDay) {
  const pool = (STORY.meta && Array.isArray(STORY.meta.daily_quest_pool)) ? STORY.meta.daily_quest_pool : [];
  if (pool.length === 0) return;
  if (player.daily_quest_day === currentDay) return;
  if (player.daily_quest_active) {
    const prev = player.quests[player.daily_quest_active];
    if (prev && prev.state === 'active') {
      const q = STORY.quests[player.daily_quest_active];
      delete player.quests[player.daily_quest_active];
      write(`[The ${q?.title || player.daily_quest_active} expired with the dawn.]`, 'system');
    }
  }
  const idx = (currentDay - 1) % pool.length;
  const nextId = pool[idx];
  const next = STORY.quests[nextId];
  if (!next) return;
  player.quests[nextId] = { state: 'active', kills: {}, visited: [player.location] };
  player.daily_quest_active = nextId;
  player.daily_quest_day = currentDay;
  write(`>>> Daily quest: ${next.title}`, 'spark');
  write(`    ${next.description}`);
  if (next.giver) write(`    Turn it in to ${STORY.npcs[next.giver]?.display || next.giver} before the day ends.`, 'system');
  else write(`    Complete and turn in before the day ends.`, 'system');
}

function isWorldEventActiveOnDay(eventId, day) {
  const ev = STORY.world_events?.[eventId];
  if (!ev) return false;
  const offset = ev.trigger_day_offset || 1;
  const period = ev.recurrence?.every_days || 0;
  const duration = ev.duration_days || 1;
  if (day < offset) return false;
  if (period <= 0) {
    return day >= offset && day < offset + duration;
  }
  const since = day - offset;
  const cyclePos = since % period;
  return cyclePos < duration;
}
function worldEventStartedOnDay(eventId, day) {
  return isWorldEventActiveOnDay(eventId, day) && !isWorldEventActiveOnDay(eventId, day - 1);
}
function worldEventExpiredOnDay(eventId, day) {
  return !isWorldEventActiveOnDay(eventId, day) && isWorldEventActiveOnDay(eventId, day - 1);
}
function advanceWorldEvents(currentDay) {
  const pool = (STORY.meta && Array.isArray(STORY.meta.world_event_pool)) ? STORY.meta.world_event_pool : [];
  if (!pool.length) return;
  for (const eid of pool) {
    const ev = STORY.world_events?.[eid];
    if (!ev) continue;
    if (worldEventStartedOnDay(eid, currentDay)) {
      player.world_events_progress[eid] = {
        active_day: currentDay, kills: {}, items_seen: [], visited: [],
        completed: false, expired: false, completion_day: null,
        stage_idx: 0, stage_kills: {}
      };
      const narr = ev.narration?.on_start || `>>> A stir runs through the world: ${t(ev.title || eid)}.`;
      write('');
      write(t(narr), 'spark');
      if (ev.description) write(`    ${t(ev.description)}`, 'system');
      showToast(`World event: ${t(ev.title || eid)}`, 'event');
      const hasStages = Array.isArray(ev.stages) && ev.stages.length > 0;
      if (hasStages) {
        const s0 = ev.stages[0];
        if (s0.title) write(`>>> ${t(s0.title)}`, 'spark');
        if (s0.narration) write(t(s0.narration), 'spark');
        if (s0.objective) write(`    Objective: ${describeWorldEventObjective(s0.objective)}`, 'system');
      } else {
        const obj = ev.objective;
        if (obj) write(`    Objective: ${describeWorldEventObjective(obj)}`, 'system');
      }
      const dur = ev.duration_days || 1;
      write(`    Active for ${dur} day${dur === 1 ? '' : 's'}.`, 'system');
      player.world_events_seen.add(eid);
    }
    if (worldEventExpiredOnDay(eid, currentDay)) {
      const prog = player.world_events_progress[eid];
      if (prog && !prog.completed && !prog.expired) {
        prog.expired = true;
        const narr = ev.narration?.on_expire || `[The ${t(ev.title || eid)} passes without resolution.]`;
        write('');
        write(t(narr), 'system');
      }
    }
  }
}
function describeWorldEventObjective(obj) {
  if (!obj) return '(none)';
  if (obj.type === 'kill') return `kill ${obj.qty || 1} ${STORY.entities[obj.entity]?.display || obj.entity}`;
  if (obj.type === 'have_item') return `have ${obj.qty || 1} ${STORY.items[obj.item]?.display || obj.item}`;
  if (obj.type === 'visit') {
    const r = obj.room ? STORY.rooms[obj.room]?.name : null;
    return `visit ${t(r) || obj.room || '?'}`;
  }
  return '(custom)';
}
function tickWorldEventProgress(kind, params) {
  const day = dayPart().day;
  const pool = (STORY.meta && Array.isArray(STORY.meta.world_event_pool)) ? STORY.meta.world_event_pool : [];
  for (const eid of pool) {
    if (!isWorldEventActiveOnDay(eid, day)) continue;
    const ev = STORY.world_events?.[eid];
    if (!ev) continue;
    const prog = player.world_events_progress[eid];
    if (!prog || prog.completed || prog.expired) continue;
    if (Array.isArray(ev.stages) && ev.stages.length) {
      if (typeof prog.stage_idx !== 'number') prog.stage_idx = 0;
      if (!prog.stage_kills || typeof prog.stage_kills !== 'object') prog.stage_kills = {};
      const idx = prog.stage_idx;
      if (idx >= ev.stages.length) continue;
      const stage = ev.stages[idx];
      const sObj = stage.objective; if (!sObj) continue;
      let stageMet = false;
      if (!prog.stage_kills[idx]) prog.stage_kills[idx] = {};
      const sKills = prog.stage_kills[idx];
      if (kind === 'kill' && sObj.type === 'kill' && sObj.entity === params.entity) {
        sKills[sObj.entity] = (sKills[sObj.entity] || 0) + 1;
        if ((sKills[sObj.entity] || 0) >= (sObj.qty || 1)) stageMet = true;
      }
      if (kind === 'have_check' && sObj.type === 'have_item') {
        const have = player.inventory.filter(i => i === sObj.item).length + (player.materials[sObj.item] || 0);
        if (have >= (sObj.qty || 1)) stageMet = true;
      }
      if (kind === 'visit' && sObj.type === 'visit' && sObj.room === params.room) stageMet = true;
      if (stageMet) {
        if (stage.completion_text) { write(''); write(t(stage.completion_text), 'spark'); }
        prog.stage_idx = idx + 1;
        if (prog.stage_idx >= ev.stages.length) {
          completeWorldEvent(eid);
        } else {
          const next = ev.stages[prog.stage_idx];
          write('');
          if (next.title) write(`>>> ${t(next.title)}`, 'spark');
          if (next.narration) write(t(next.narration), 'spark');
          if (next.objective) write(`    Objective: ${describeWorldEventObjective(next.objective)}`, 'system');
        }
      }
      continue;
    }
    const obj = ev.objective; if (!obj) continue;
    let nowMet = false;
    if (kind === 'kill' && obj.type === 'kill' && obj.entity === params.entity) {
      prog.kills[obj.entity] = (prog.kills[obj.entity] || 0) + 1;
      if ((prog.kills[obj.entity] || 0) >= (obj.qty || 1)) nowMet = true;
    }
    if (kind === 'have_check' && obj.type === 'have_item') {
      const have = player.inventory.filter(i => i === obj.item).length + (player.materials[obj.item] || 0);
      if (have >= (obj.qty || 1)) nowMet = true;
    }
    if (kind === 'visit' && obj.type === 'visit' && obj.room === params.room) {
      nowMet = true;
    }
    if (nowMet) completeWorldEvent(eid);
  }
}
function completeWorldEvent(eid) {
  const ev = STORY.world_events?.[eid]; if (!ev) return;
  const prog = player.world_events_progress[eid];
  if (!prog || prog.completed) return;
  prog.completed = true;
  prog.completion_day = dayPart().day;
  const r = ev.rewards || {};
  if (r.gold) { player.gold += r.gold; player.stats.gold_earned += r.gold; }
  if (r.sparks) { player.sparks += r.sparks; player.stats.sparks_earned += r.sparks; }
  if (r.renown) gainRenown('world_event', r.renown);
  for (const ri of (r.items || [])) {
    if (canCarry(ri.item, ri.qty)) addItem(ri.item, ri.qty);
    else (player.rooms[player.location].items ||= []).push(ri.item);
  }
  const narr = ev.narration?.on_complete || `>>> You answered the call.`;
  write('');
  write(t(narr), 'spark');
  const parts = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.sparks) parts.push(`${r.sparks} sparks`);
  if (r.renown) parts.push(`+${r.renown} renown`);
  for (const ri of (r.items || [])) parts.push(`${ri.qty} ${itemDisplay(ri.item)}`);
  if (parts.length) write(`Reward: ${parts.join(', ')}`, 'success');
  publishAction('world_event_complete', { event: eid });
}
function showNews() {
  const day = dayPart().day;
  const pool = (STORY.meta && Array.isArray(STORY.meta.world_event_pool)) ? STORY.meta.world_event_pool : [];
  if (pool.length === 0) { write('There is no news.', 'system'); return; }
  const active = [], upcoming = [];
  for (const eid of pool) {
    const ev = STORY.world_events?.[eid]; if (!ev) continue;
    if (isWorldEventActiveOnDay(eid, day)) active.push(eid);
    else {
      for (let d = day + 1; d <= day + 30; d++) {
        if (isWorldEventActiveOnDay(eid, d)) { upcoming.push({ eid, day: d }); break; }
      }
    }
  }
  if (active.length) {
    write('-- The world stirs --', 'title');
    for (const eid of active) {
      const ev = STORY.world_events[eid];
      const prog = player.world_events_progress[eid] || {};
      const status = prog.completed ? ' ✓ done' : (prog.expired ? ' (expired)' : '');
      write(`  ${t(ev.title || eid)}${status}`, prog.completed ? 'success' : 'spark');
      if (ev.description) write(`    ${t(ev.description)}`, 'system');
      if (Array.isArray(ev.stages) && ev.stages.length && !prog.completed) {
        const idx = (typeof prog.stage_idx === 'number') ? prog.stage_idx : 0;
        const total = ev.stages.length;
        write(`    Watch ${Math.min(idx + 1, total)}/${total}`, 'system');
        if (idx < total) {
          const s = ev.stages[idx];
          if (s.title) write(`    ${t(s.title)}`, 'system');
          const sObj = s.objective;
          if (sObj) {
            let progStr = '';
            if (sObj.type === 'kill') {
              const got = prog.stage_kills?.[idx]?.[sObj.entity] || 0;
              progStr = ` (${got}/${sObj.qty || 1})`;
            }
            write(`    Objective: ${describeWorldEventObjective(sObj)}${progStr}`, 'system');
          }
        }
      } else {
        const obj = ev.objective;
        if (obj && !prog.completed) {
          let progStr = '';
          if (obj.type === 'kill') {
            const got = prog.kills?.[obj.entity] || 0;
            progStr = ` (${got}/${obj.qty || 1})`;
          }
          write(`    Objective: ${describeWorldEventObjective(obj)}${progStr}`, 'system');
        }
      }
    }
  } else {
    write('All quiet. No active stirs in the world.', 'system');
  }
  if (upcoming.length) {
    upcoming.sort((a, b) => a.day - b.day);
    write('-- Coming soon --', 'system');
    for (const u of upcoming.slice(0, 4)) {
      const ev = STORY.world_events[u.eid];
      write(`  Day ${u.day}: ${t(ev.title || u.eid)}`, 'system');
    }
  }
}

function matchesNpcCondition(c) {
  if (!c) return true;
  if (c.type === 'has_flag') return player.flags.has(c.flag);
  if (c.type === '!has_flag') return !player.flags.has(c.flag);
  if (c.type === 'quest_completed') return player.quests[c.quest]?.state === 'completed';
  if (c.type === 'quest_active') return player.quests[c.quest]?.state === 'active';
  if (c.type === 'has_skill') return player.skills.has(c.skill);
  if (c.type === 'has_item') return player.inventory.includes(c.item) || (player.materials[c.item] || 0) >= (c.qty || 1);
  if (c.type === 'renown_gte') return (player.renown || 0) >= (c.qty || 0);
  if (c.type === 'renown_lt')  return (player.renown || 0) <  (c.qty || 0);
  return true;
}

function examineItem(arg) {
  if (!arg || !String(arg).trim()) {
    write('Examine what? Usage: examine <item|creature>', 'error');
    return;
  }
  const q = String(arg).toLowerCase().trim();
  for (const [eid, ent] of Object.entries(STORY.entities || {})) {
    if (!ent) continue;
    const disp = (typeof ent.display === 'string' ? ent.display : (ent.display?.en || '')).toLowerCase();
    if (eid.toLowerCase() === q || disp === q || disp.includes(q) || disp.split(/\s+/).includes(q)) {
      examineEntity(eid, ent);
      return;
    }
  }
  let itemId = null;
  const ii = findItemIn(player.inventory, arg);
  if (ii !== -1) itemId = player.inventory[ii];
  else {
    const matKey = findMaterialKey(arg);
    if (matKey) itemId = matKey;
    else {
      const room = player.rooms[player.location];
      const ri = findItemIn(room.items || [], arg);
      if (ri !== -1) itemId = (room.items || [])[ri];
    }
  }
  if (!itemId) { write(`There's no "${arg}" here you can examine.`, 'error'); return; }
  const it = STORY.items[itemId];
  if (!it) { write(`You can't examine that.`, 'error'); return; }
  write(`You examine ${itemDisplay(itemId, true)}:`, 'system');
  const desc = it.description != null ? t(it.description) : null;
  if (desc) {
    for (const line of String(desc).split('\n')) write(`  ${line}`, '');
  } else {
    write(`  (no description on file)`, 'system');
  }
  const stats = [];
  if (typeof it.weight === 'number') stats.push(`weight ${it.weight}`);
  if (typeof it.value === 'number') stats.push(`value ${it.value}g`);
  if (it.slot) stats.push(`slot: ${it.slot}`);
  if (it.consumable_action) stats.push(`use: ${it.consumable_action}`);
  if (typeof it.decay_turns === 'number') stats.push(`spoils in ${it.decay_turns} turns`);
  if (Array.isArray(it.tags) && it.tags.length) stats.push(`tags: ${it.tags.join(', ')}`);
  if (stats.length) write(`  [${stats.join(' · ')}]`, 'system');
  const ef = it.effects || {};
  const efParts = [];
  if (ef.attack_bonus != null) efParts.push(`+${ef.attack_bonus} attack`);
  if (ef.defense_bonus != null) efParts.push(`+${ef.defense_bonus} defense`);
  if (ef.evasion_bonus != null) efParts.push(`+${ef.evasion_bonus} evasion`);
  if (ef.damage_type) efParts.push(`${ef.damage_type} damage`);
  if (ef.restore_life != null) efParts.push(`restores ${ef.restore_life} life`);
  if (ef.requires_ammo) efParts.push(`uses ${ef.requires_ammo} as ammo (${ef.ammo_per_shot || 1}/shot)`);
  if (efParts.length) write(`  Effects: ${efParts.join(', ')}`, 'system');
  if (it.read_text || (Array.isArray(it.on_read) && it.on_read.length > 0)) {
    write(`  (Try \`read ${itemId}\` for the full text.)`, 'system');
  }
}

function examineEntity(eid, ent) {
  write(`You consider the ${t(ent.display)}:`, 'system');
  if (ent.summary) {
    for (const line of String(t(ent.summary)).split('\n')) write(`  ${line}`, '');
  }
  const stats = [];
  if (typeof ent.hp === 'number') stats.push(`HP ${ent.hp}`);
  if (Array.isArray(ent.attack_damage_range) && ent.attack_damage_range.length === 2) {
    stats.push(`damage ${ent.attack_damage_range[0]}-${ent.attack_damage_range[1]}`);
  }
  if (typeof ent.evasion === 'number' && ent.evasion > 0) stats.push(`evasion ${Math.round(ent.evasion * 100)}%`);
  if (Array.isArray(ent.weaknesses) && ent.weaknesses.length) stats.push(`weak: ${ent.weaknesses.join('/')}`);
  if (Array.isArray(ent.resistances) && ent.resistances.length) stats.push(`resist: ${ent.resistances.join('/')}`);
  if (Array.isArray(ent.tags) && ent.tags.length) stats.push(`tags: ${ent.tags.join(', ')}`);
  if (stats.length) write(`  [${stats.join(' · ')}]`, 'system');
  if (Array.isArray(ent.tone_hints) && ent.tone_hints.length) {
    write(`  Feels: ${ent.tone_hints.join(', ')}`, 'system');
  }
  const killed = (player.stats?.kills_by_entity?.[eid]) || 0;
  if (killed > 0) write(`  Killed: ${killed}.`, 'system');
}

function lookDir(dir) {
  const room = player.rooms[player.location];
  const resolved = resolveExit(room.exits?.[dir]);
  if (!resolved) { write(`Nothing visible to the ${dir}.`, 'error'); return; }
  const target = resolved.target;
  const nextRoom = STORY.rooms[target];
  if (!nextRoom) { write(`Nothing visible to the ${dir}.`, 'error'); return; }
  const seen = player.visited.has(target);
  write(`Looking ${dir}: ${t(nextRoom.name)}${seen ? '' : '  (not yet visited)'}.`, 'system');
  if (seen && nextRoom.summary) {
    write(`  ${t(nextRoom.summary)}`, '');
  } else if (!seen) {
    write(`  You can't make out details from here. Walk ${dir} to enter.`, 'system');
  }
  const gate = resolved.gate;
  if (gate && (gate.requires_flag || gate.requires_item)) {
    if (gate.requires_item) write(`  (the way is gated — you'd need ${itemDisplay(gate.requires_item)})`, 'system');
    else if (gate.requires_flag) write(`  (the way is gated)`, 'system');
  }
}

function readItem(arg) {
  if (combatBlock('read')) return;
  if (!arg || !String(arg).trim()) {
    write('Read what? Usage: read <item>', 'error');
    return;
  }
  let itemId = null, fromLoc = null;
  const ii = findItemIn(player.inventory, arg);
  if (ii !== -1) { itemId = player.inventory[ii]; fromLoc = 'inv'; }
  else {
    const room = player.rooms[player.location];
    const ri = findItemIn(room.items || [], arg);
    if (ri !== -1) { itemId = (room.items || [])[ri]; fromLoc = 'room'; }
  }
  if (!itemId) { write(`There's no "${arg}" here you can read.`, 'error'); return; }
  const it = STORY.items[itemId];
  if (!it) { write(`You can't read that.`, 'error'); return; }
  const text = (it.read_text != null ? t(it.read_text) : null) || (it.description != null ? t(it.description) : null);
  const hasEffects = Array.isArray(it.on_read) && it.on_read.length > 0;
  if (!text && !hasEffects) { write(`There's nothing written on ${itemDisplay(itemId, true)}.`, 'system'); return; }
  if (text) {
    write(`You read ${itemDisplay(itemId, true)}:`, 'system');
    for (const line of String(text).split('\n')) {
      write(`  ${line}`, '');
    }
  }
  if (hasEffects) {
    const flag = `read:${itemId}`;
    if (!player.flags.has(flag)) {
      runEventEffects({ effects: it.on_read });
      player.flags.add(flag);
    }
  }
  if (it.consumed_on_read) {
    if (fromLoc === 'inv') {
      const i = player.inventory.indexOf(itemId);
      if (i !== -1) player.inventory.splice(i, 1);
    } else {
      const room = player.rooms[player.location];
      const i = (room.items || []).indexOf(itemId);
      if (i !== -1) room.items.splice(i, 1);
    }
    write(`The ${t(it.display)} crumbles to dust as you finish reading.`, 'system');
  }
  publishAction('read', { item: itemId });
}

function lightFire() {
  if (!player.skills.has('firemaking')) { write('You need the Firemaking skill.', 'error'); return; }
  if (fireActive(player.location)) { write('A fire is already burning here.'); return; }
  const room = player.rooms[player.location];
  const indoor = (room.tags || []).some(t => ['indoor','underground','shelter'].includes(t));
  const weather = player.weather || 'clear';
  if (!indoor && (weather === 'rain' || weather === 'snow' || weather === 'storm')) {
    if (Math.random() < 0.5) {
      write(`The ${weather} stifles your spark. The kindling smokes and dies.`, 'error');
      return;
    }
    write(`The ${weather} fights you, but you coax a flame to life.`, 'fire');
  }
  player.fires.set(player.location, player.turn + FIRE_DURATION_TURNS);
  write(`You light a fire. It will burn for ${FIRE_DURATION_TURNS} turns.`, 'fire');
  firstTimeMilestone('first_fire', '🔥 First fire', 'Sleep next to fire restores more life. Some recipes need fire too.');
  publishAction('lit_fire', { location: player.location });
}

const SHARPEN_OPTIONS = {
  rusty_dagger:     { cost: 20, transform: 'sharpened_dagger' },
  sharpened_dagger: { cost: 10, restore: true },
  sword:            { cost: 25, restore: true }
};
const REPAIR_RECIPES = {
  broken_sword: { cost_gold: 50, materials: { wood: 1, leather: 1 }, becomes: 'sword' }
};
const DURABLE_WEAPONS = {
  sharpened_dagger: { max: 15, downgrade: 'rusty_dagger' },
  sword:            { max: 25, downgrade: 'broken_sword' },
  bone_knife:       { max: 3,  downgrade: null },
  iron_axe:         { max: 40, downgrade: null },
  iron_sword:       { max: 50, downgrade: null }
};

function findBlacksmithHere() {
  const room = player.rooms[player.location];
  const id = npcsHere(player.location).find(n => STORY.npcs[n].behaviors?.includes('offers_smithing'));
  if (!id) return null;
  if (!npcOpen(id)) { write(describeNpcStatus(id), 'error'); return null; }
  return id;
}

function locateWieldableOrInv(arg, predicate) {
  if (arg) {
    const idx = findItemIn(player.inventory, arg);
    if (idx !== -1 && predicate(player.inventory[idx])) return { itemId: player.inventory[idx], kind: 'inventory', key: idx };
    for (const [slot, eqItem] of Object.entries(player.equipment)) {
      const dn = STORY.items[eqItem]?.display || '';
      if ((eqItem === arg || dn.includes(arg) || dn.split(' ').includes(arg)) && predicate(eqItem)) {
        return { itemId: eqItem, kind: 'equipment', key: slot };
      }
    }
    return null;
  }
  if (player.equipment.hand && predicate(player.equipment.hand))
    return { itemId: player.equipment.hand, kind: 'equipment', key: 'hand' };
  const idx = player.inventory.findIndex(predicate);
  if (idx !== -1) return { itemId: player.inventory[idx], kind: 'inventory', key: idx };
  return null;
}

function removeAt(loc) {
  if (loc.kind === 'inventory') player.inventory.splice(loc.key, 1);
  else delete player.equipment[loc.key];
}

function isSharpenable(id) {
  const opt = SHARPEN_OPTIONS[id];
  if (!opt) return false;
  if (!STORY.items[id]) return false;
  if (opt.transform && !STORY.items[opt.transform]) return false;
  return true;
}
function sharpen(arg) {
  if (combatBlock('sharpen')) return;
  const smith = findBlacksmithHere();
  if (!smith) { write('No blacksmith here. Try the village.', 'error'); return; }
  const found = locateWieldableOrInv(arg, id => isSharpenable(id));
  if (!found) { write(arg ? `Nothing matching "${arg}" can be sharpened.` : `Nothing here can be sharpened.`, 'error'); return; }
  const opt = SHARPEN_OPTIONS[found.itemId];
  if (player.gold < opt.cost) { write(`Sharpening costs ${opt.cost} gold. You have ${player.gold}.`, 'error'); return; }
  player.gold -= opt.cost;
  if (opt.transform) {
    removeAt(found);
    addItem(opt.transform, 1);
    if (DURABLE_WEAPONS[opt.transform]) player.edges.set(opt.transform, DURABLE_WEAPONS[opt.transform].max);
    write(`${STORY.npcs[smith].display} works the edge. ${itemDisplay(found.itemId)} becomes ${itemDisplay(opt.transform, true)}. (-${opt.cost} gold)`, 'success');
    publishAction('sharpen', { from: found.itemId, to: opt.transform, cost: opt.cost });
  } else {
    if (DURABLE_WEAPONS[found.itemId]) {
      player.edges.set(found.itemId, DURABLE_WEAPONS[found.itemId].max);
      write(`${STORY.npcs[smith].display} restores the edge on ${itemDisplay(found.itemId, true)}. (-${opt.cost} gold)`, 'success');
      publishAction('sharpen', { item: found.itemId, cost: opt.cost });
    }
  }
}

function isRepairable(id) {
  const rec = REPAIR_RECIPES[id];
  if (!rec) return false;
  if (!STORY.items[id]) return false;
  if (rec.becomes && !STORY.items[rec.becomes]) return false;
  return true;
}
function repair(arg) {
  if (combatBlock('repair')) return;
  const smith = findBlacksmithHere();
  if (!smith) { write('No blacksmith here. Try the village.', 'error'); return; }
  const found = locateWieldableOrInv(arg, id => isRepairable(id));
  if (!found) { write(`Nothing here can be repaired.`, 'error'); return; }
  const rec = REPAIR_RECIPES[found.itemId];
  if (player.gold < rec.cost_gold) { write(`Repair costs ${rec.cost_gold} gold. You have ${player.gold}.`, 'error'); return; }
  for (const [matId, qty] of Object.entries(rec.materials || {})) {
    const have = STORY.items[matId].stackable ? (player.materials[matId] || 0) : player.inventory.filter(i => i === matId).length;
    if (have < qty) { write(`Repair also needs ${qty} ${itemDisplay(matId)} (you have ${have}).`, 'error'); return; }
  }
  player.gold -= rec.cost_gold;
  for (const [matId, qty] of Object.entries(rec.materials || {})) removeFromInventoryOrMaterials(matId, qty);
  removeAt(found);
  addItem(rec.becomes, 1);
  if (DURABLE_WEAPONS[rec.becomes]) player.edges.set(rec.becomes, DURABLE_WEAPONS[rec.becomes].max);
  const matStr = Object.entries(rec.materials || {}).map(([k, q]) => `${q} ${itemDisplay(k)}`).join(', ');
  write(`${STORY.npcs[smith].display} works the forge for an hour. ${itemDisplay(found.itemId)} is reforged into ${itemDisplay(rec.becomes, true)}. (-${rec.cost_gold} gold${matStr ? ', -' + matStr : ''})`, 'success');
  publishAction('repair', { from: found.itemId, to: rec.becomes, cost: rec.cost_gold });
}

function rest() {
  if (combatBlock('rest')) return;
  write('You rest a moment.');
}

const ACHIEVEMENTS = {
  first_blood:  { name: 'First Blood',      desc: 'Kill your first creature.',     check: () => totalKills() >= 1 },
  hunter:       { name: 'Hunter',           desc: 'Make 20 kills.',                check: () => totalKills() >= 20 },
  wolfslayer:   { name: 'Wolfslayer',       desc: 'Kill 10 wolves.',               check: () => (player.stats.kills.wolf || 0) >= 10 },
  wise:         { name: 'Wise',             desc: 'Solve 5 riddles.',              check: () => player.riddles_solved.size >= 5 },
  reliable:     { name: 'Reliable',         desc: 'Complete 7 daily quests.',      check: () => (player.daily_quests_completed || 0) >= 7 },
  craftsman:    { name: 'Master Craftsman', desc: 'Craft 30 things.',              check: () => player.stats.crafts >= 30 },
  survivor:     { name: 'Survivor',         desc: 'Reach day 5.',                  check: () => Math.floor(player.turn / (STORY.meta.turns_per_day || 96)) + 1 >= 5 },
  wealthy:      { name: 'Wealthy',          desc: 'Hold 200 gold at once.',        check: () => player.gold >= 200 },
  insightful:   { name: 'Insightful',       desc: 'Earn 200 sparks lifetime.',     check: () => player.stats.sparks_earned >= 200 },
  explorer:     { name: 'Explorer',         desc: 'Visit every room.',             check: () => player.visited.size >= Object.keys(STORY.rooms).length },
  legend:       { name: 'Legend',           desc: 'Complete every quest.',         check: () => Object.values(player.quests).filter(q => q.state === 'completed').length >= Object.keys(STORY.quests).length },
  tamer:        { name: 'Tamer',            desc: 'Tame a wolf companion.',        check: () => !!player.companion },
  trader:       { name: 'Trader',           desc: 'Earn 100 gold lifetime.',       check: () => player.stats.gold_earned >= 100 }
};
function totalKills() { return Object.values(player.stats.kills).reduce((a, b) => a + b, 0); }
function checkAchievements() {
  for (const [aid, def] of Object.entries(ACHIEVEMENTS)) {
    if (player.achievements.has(aid)) continue;
    if (def.check()) {
      player.achievements.add(aid);
      write('');
      write(`🏆  Achievement unlocked: ${def.name}`, 'spark');
      write(`    ${def.desc}`, 'system');
      try {
        showToast(`🏆 ${def.name}`, 'achievement', {
          celebrate: true,
          tag: 'Achievement',
          subtitle: def.desc
        });
      } catch {}
    }
  }
}
function showStats() {
  const day = Math.floor(player.turn / (STORY.meta.turns_per_day || 96)) + 1;
  write('-- Stats --', 'system');
  const ttl = playerTitle();
  const tier = renownTier(player.renown);
  write(`  ${player.name || '—'}${ttl ? ' ' + ttl : ''}${tier.stars ? ' ' + '★'.repeat(tier.stars) : ''}`);
  write(`  Renown: ${player.renown} (${tier.label})`);
  write(`  Login streak: ${player.login_streak} day${player.login_streak === 1 ? '' : 's'} (lifetime logins: ${player.total_logins})`);
  write(`  Day ${day} · Turn ${player.turn}`);
  write(`  Total kills: ${totalKills()}`);
  if (Object.keys(player.stats.kills).length) {
    for (const [e, n] of Object.entries(player.stats.kills)) write(`    ${STORY.entities[e]?.display || e}: ${n}`);
  }
  write(`  Riddles solved: ${player.riddles_solved.size}`);
  write(`  Quests completed: ${player.stats.quests_completed}`);
  write(`  Daily quests completed: ${player.daily_quests_completed || 0}`);
  write(`  Crafts made: ${player.stats.crafts}`);
  write(`  Carvings left: ${player.carvings_left || 0}`);
  write(`  Gold earned (lifetime): ${player.stats.gold_earned}`);
  write(`  Sparks earned (lifetime): ${player.stats.sparks_earned}`);
  write(`  Deaths: ${player.stats.deaths}`);
  write(`  Rooms discovered: ${player.visited.size} / ${Object.keys(STORY.rooms).length}`);
}
function showAchievements() {
  write('-- Achievements --', 'system');
  for (const [aid, def] of Object.entries(ACHIEVEMENTS)) {
    const earned = player.achievements.has(aid);
    write(`  ${earned ? '🏆' : '·'} ${def.name}${earned ? '' : ` — ${def.desc}`}`, earned ? 'success' : '');
  }
  write(`Earned: ${player.achievements.size} / ${Object.keys(ACHIEVEMENTS).length}`, 'system');
}

const HUNGER_DAYS = 3;
const HUNGER_GRACE_TURNS = 24;
function tameAttempt() {
  if (!player.skills.has('taming')) { write('You need the Taming skill.', 'error'); return; }
  if (player.companion) { write('You already have a companion. "dismiss" first.', 'error'); return; }
  if (!inCombat()) { write('Tame what? You\'re not in combat.', 'error'); return; }
  const t = player.combat_target;
  const ent = STORY.entities[t.id];
  if (!ent.tameable) { write(`A ${t.display} cannot be tamed.`, 'error'); return; }
  const meatIdx = findItemIn(player.inventory, 'raw_meat');
  const meatInMat = (player.materials.raw_meat || 0) > 0;
  if (meatIdx === -1 && !meatInMat) { write('You need raw meat to offer.', 'error'); return; }
  removeFromInventoryOrMaterials('raw_meat', 1);
  const fullHp = ent.hp;
  const successChance = 0.3 + 0.5 * (1 - t.hp / fullHp);
  if (Math.random() < successChance) {
    player.companion = {
      entity: t.id, hp: t.hp, max_hp: fullHp,
      last_fed_turn: player.turn,
      attack_min: 2, attack_max: 5
    };
    player.combat_target = null;
    write(T('The {0} sniffs the meat, hesitates, and lowers its hackles. It follows you now.', t.display), 'success');
    write(T('(Type "companion" any time to check on it. Feed it raw meat every {0} days or it\'ll go wild.)', HUNGER_DAYS), 'system');
    publishAction('tamed', { entity: t.id });
  } else {
    write(T('The {0} snatches the meat and lunges anyway.', t.display), 'error');
    const enemyDmg = applyDefense(randInt(t.attack_damage_range[0], t.attack_damage_range[1]));
    player.life -= enemyDmg;
    write(T('The {0} bites you for {1} damage.', t.display, enemyDmg), 'error');
    if (player.life > 0) fireEvents('on_attacked', { entity: t.id, dmg: enemyDmg, source: 'tame_fail' });
    if (player.life <= 0) handleDeath(`mauled by ${t.display} (taming failed)`);
  }
}
function feedCompanion() {
  if (!player.companion) { write(T('No companion to feed.'), 'error'); return; }
  const meatIdx = findItemIn(player.inventory, 'raw_meat');
  const matMeat = (player.materials.raw_meat || 0) > 0;
  if (meatIdx === -1 && !matMeat) { write(T('No raw meat to give.'), 'error'); return; }
  removeFromInventoryOrMaterials('raw_meat', 1);
  player.companion.last_fed_turn = player.turn;
  player.companion.hp = Math.min(player.companion.max_hp, player.companion.hp + 5);
  write(T('Your {0} eats. Looks at you with loyal eyes.', STORY.entities[player.companion.entity].display), 'success');
}
function showCompanion() {
  if (!player.companion) { write(T('You travel alone.')); return; }
  const c = player.companion;
  const daysSinceFed = (player.turn - c.last_fed_turn) / (STORY.meta.turns_per_day || 96);
  let mood = T('content');
  if (daysSinceFed >= HUNGER_DAYS) mood = T('hungry — feed it soon');
  else if (daysSinceFed >= HUNGER_DAYS * 0.66) mood = T('getting hungry');
  write(T('Companion: {0}  ·  hp {1}/{2}  ·  {3} (fed {4} days ago)', STORY.entities[c.entity].display, c.hp, c.max_hp, mood, daysSinceFed.toFixed(1)));
}
function dismissCompanion() {
  if (!player.companion) { write(T('No companion.'), 'error'); return; }
  const name = STORY.entities[player.companion.entity].display;
  player.companion = null;
  write(T('You release your {0}. It looks at you once and is gone into the trees.', name), 'system');
  publishAction('dismissed', { entity: name });
}
function checkCompanionHunger() {
  if (!player.companion) return;
  const daysSinceFed = (player.turn - player.companion.last_fed_turn) / (STORY.meta.turns_per_day || 96);
  if (daysSinceFed >= HUNGER_DAYS + HUNGER_GRACE_TURNS / (STORY.meta.turns_per_day || 96)) {
    const c = player.companion;
    const ent = STORY.entities[c.entity];
    write(T('Your {0} has gone too long without food. It bares its teeth and circles. It is no longer yours.', ent.display), 'error');
    player.combat_target = { id: c.entity, ...structuredClone(ent), hp: c.hp };
    player.companion = null;
  }
}

function sleep() {
  if (combatBlock('sleep')) return;
  const room = player.rooms[player.location];
  const isVillage = (room.tags || []).includes('safe') || (room.tags || []).includes('settlement');
  const ownChestHere = player.chests.has(player.location);
  const fire = fireActive(player.location);
  const isHazard = !!room.hazards?.wolves;

  let restoreFraction, danger, label;
  if (isHazard) { restoreFraction = 0.10; danger = 0.85; label = 'restless and exposed'; }
  else if (isVillage || (ownChestHere && fire)) { restoreFraction = 1.0; danger = 0; label = 'deeply, safe and warm'; }
  else if (fire) { restoreFraction = 0.5; danger = 0.05; label = 'by the fire'; }
  else { restoreFraction = 0.25; danger = 0.20; label = 'fitfully, unsheltered'; }

  if (danger > 0 && Math.random() < danger) {
    if (isHazard) {
      const w = room.hazards.wolves;
      const ent = STORY.entities[w.entity];
      const sneakDmg = applyDefense(randInt(ent.attack_damage_range[0], ent.attack_damage_range[1]) * 2);
      player.life -= sneakDmg;
      write(`You sleep. A ${ent.display} catches you in the dark — ${sneakDmg} damage before you wake.`, 'combat');
      if (player.life > 0) fireEvents('on_attacked', { entity: w.entity, dmg: sneakDmg, source: 'sleep_ambush' });
      if (player.life <= 0) { handleDeath(`mauled by ${ent.display} while sleeping`); return; }
      player.combat_target = { id: w.entity, ...structuredClone(ent) };
      write(`You scramble up; the ${ent.display} circles. Attack or flee.`, 'combat');
      publishAction('slept', { location: player.location, restored: 0, interrupted: true });
      return;
    } else {
      const dmg = randInt(2, 6);
      player.life -= dmg;
      write(`Your rest is broken by cold and bad dreams. You take ${dmg} damage from exposure.`, 'error');
      if (player.life <= 0) { handleDeath('exposure'); return; }
      publishAction('slept', { location: player.location, restored: 0, interrupted: true });
      return;
    }
  }
  const sleepTurns = Math.floor((STORY.meta.turns_per_day || 96) / 3);
  player.turn += sleepTurns;
  const maxLife = computeMaxLife();
  const restore = Math.floor((maxLife - player.life) * restoreFraction);
  player.life = Math.min(maxLife, player.life + restore);
  write(`You sleep ${label}. (+${restore} life · 8 hours pass)`, 'success');
  firstTimeMilestone('first_sleep', '🌙 First night', 'A safe shelter is worth more than gold. Sleep heals more by a fire and even more in a village.');
  publishAction('slept', { location: player.location, restored: restore });
}

function profileDef() {
  const profs = STORY.meta?.character_profiles;
  if (!profs || typeof profs !== 'object') return null;
  if (!player.profile_id) return null;
  return profs[player.profile_id] || null;
}
function profileAttribute(key) {
  const p = profileDef();
  return (p && p.attributes && typeof p.attributes[key] === 'number') ? p.attributes[key] : 0;
}
function profileBonus(key) {
  const p = profileDef();
  return (p && typeof p[key] === 'number') ? p[key] : 0;
}
function transformCommand(formArg) {
  if (combatBlock('transform')) return;
  if (player.dialog_session) { write('You can\'t change shape mid-conversation.', 'error'); return; }
  if (player.transformed) {
    write(`You are already a ${player.transformed === 'wolf' ? 'wolf' : 'bat'}. Type "revert" to change back.`, 'error'); return;
  }
  const canWolf = player.skills.has('lycanthropy');
  const canBat  = player.skills.has('vampirism');
  if (!canWolf && !canBat) { write('You have no shape to take but your own.', 'error'); return; }
  let form = (formArg || '').trim().toLowerCase();
  if (!form) {
    if (canWolf && !canBat) form = 'wolf';
    else if (canBat && !canWolf) form = 'bat';
    else { write('Two shapes wait in you. Type "transform wolf" or "transform bat".', 'error'); return; }
  }
  if (form !== 'wolf' && form !== 'bat') { write(`Unknown form: "${form}". Try "wolf" or "bat".`, 'error'); return; }
  if (form === 'wolf' && !canWolf) { write('You are not of the wolf.', 'error'); return; }
  if (form === 'bat'  && !canBat)  { write('You are not of the night.', 'error'); return; }
  player.transformed = form;
  player.transformed_at_day = dayPart().day;
  player.flags.add('is_' + form);
  write('');
  if (form === 'wolf') {
    write('Bone shifts. The world grows louder, sharper. You are a wolf now — fast, hungry, simple.', 'spark');
    write('(While transformed: +50% attack, weapons useless to paws, carry capacity halved, NPCs will not speak to you. Dawn ends the change.)', 'system');
  } else {
    write('Your shape thins. You are wing and shadow. The lake below looks like a coin tossed in trees.', 'spark');
    write('(While transformed: +20% attack, blood you draw heals you, +20% evasion, carry halved, NPCs flee. Dawn forces you back.)', 'system');
  }
  publishAction('transform', { form });
  refreshSidebar();
}
function revertCommand() {
  if (!player.transformed) { write('You are already yourself.', 'error'); return; }
  if (combatBlock('revert')) return;
  const wasForm = player.transformed;
  player.flags.delete('is_' + wasForm);
  player.transformed = null;
  write('');
  write(wasForm === 'wolf'
    ? 'Bone shifts back. You are yourself again — heavier, slower, full of memory.'
    : 'You fold back into yourself. The night was wider, briefly.', 'spark');
  publishAction('revert', { from: wasForm });
  refreshSidebar();
}
function transformBlock(verb) {
  if (!player.transformed) return false;
  const tag = player.transformed === 'wolf'
    ? 'They flinch from you. The wolf does not speak; the wolf is not spoken to.'
    : 'They cross themselves and turn away. The bat is not a friend.';
  write(tag, 'error');
  return true;
}

function showWhoAmI() {
  const dp = dayPart();
  const npub = (typeof nip19 !== 'undefined' && pk) ? nip19.npubEncode(pk) : '';
  const npubShort = npub ? (npub.slice(0, 12) + '…' + npub.slice(-6)) : '(unknown)';
  const profile = profileDef();
  const totalK = Object.values(player.stats?.kills || {}).reduce((a, b) => a + b, 0);
  const visited = (player.visited && typeof player.visited.size === 'number') ? player.visited.size : 0;
  const endings = (player.endings_reached && typeof player.endings_reached.size === 'number') ? player.endings_reached.size : 0;
  const ach = (player.achievements && typeof player.achievements.size === 'number') ? player.achievements.size : 0;
  const skills = (player.skills && typeof player.skills.size === 'number') ? player.skills.size : 0;
  const renown = player.renown || 0;
  const stars = renownTier(renown);
  writeBlock('=== Who am I ===', () => {
    write(`Name: ${player.name || '—'}${playerTitle() ? ' ' + playerTitle() : ''}`, 'system');
    write(`npub: ${npubShort}`, 'system');
    if (profile) write(`Profile: ${t(profile.display)}`, 'system');
    write('');
    write(`Story:    ${t(STORY?.meta?.title) || STORY?.meta?.id || '—'}`, 'system');
    write(`Location: ${t(player.rooms[player.location].name)}`, 'system');
    write(`Day ${dp.day} · ${T(dp.period)} (${dp.hour}h) · ${T(player.weather || 'clear')}`, 'system');
    write('');
    write('-- This run --', 'system');
    write(`  Life:        ${Math.floor(player.life)}/${computeMaxLife()}`, 'life');
    write(`  Gold:        ${player.gold}`, 'gold');
    write(`  Sparks:      ${player.sparks}`, 'spark');
    write(`  Skills:      ${skills} learned`, 'system');
    write(`  Rooms seen:  ${visited}`, 'system');
    write(`  Kills:       ${totalK}`, 'system');
    write('');
    write('-- Lifetime (this character, all runs) --', 'system');
    write(`  Login streak: ${player.login_streak || 0} day${player.login_streak === 1 ? '' : 's'}  ·  ${player.total_logins || 0} total logins`, 'system');
    write(`  Achievements: ${ach}`, 'system');
    write(`  Endings reached: ${endings}`, 'system');
    write(`  Renown:       ${renown}  ${'★'.repeat(stars.stars) || '(unknown)'}  ${stars.label}`, 'system');
    write(`  Crafts:       ${player.stats?.crafts || 0}`, 'system');
    write(`  Riddles:      ${player.stats?.riddles_solved || 0}`, 'system');
    write(`  Quests done:  ${player.stats?.quests_completed || 0}`, 'system');
    write(`  Deaths:       ${player.stats?.deaths || 0}`, 'system');
    write(`  Daily quests: ${player.daily_quests_completed || 0}`, 'system');
    write('');
    write('-- Legacy carry-over --', 'system');
    write(`  Gold:   ${player.legacy_gold || 0}`, 'gold');
    write(`  Sparks: ${player.legacy_sparks || 0}`, 'spark');
  }, '── end of profile ──');
}

function showProfile() {
  const profs = STORY.meta?.character_profiles;
  if (!profs || Object.keys(profs).length === 0) { write('This story has no character profiles.', 'system'); return; }
  if (!player.profile_id) { write('You have not chosen a profile yet.', 'system'); return; }
  const p = profileDef(); if (!p) { write(`Unknown profile "${player.profile_id}".`, 'error'); return; }
  write(`=== Profile: ${t(p.display)} ===`, 'title');
  if (p.summary) write(t(p.summary), 'system');
  if (p.attributes) {
    const parts = Object.entries(p.attributes).map(([k, v]) => `${k} ${v}`);
    write(`Attributes: ${parts.join(' · ')}`, 'system');
  }
  const bonuses = [];
  if (p.life_max_bonus)        bonuses.push(`+${p.life_max_bonus} max life`);
  if (p.carry_capacity_bonus)  bonuses.push(`+${p.carry_capacity_bonus} carry`);
  if (p.attack_bonus)          bonuses.push(`+${p.attack_bonus} attack`);
  if (p.evasion_bonus)         bonuses.push(`+${(p.evasion_bonus*100).toFixed(0)}% evasion`);
  if (bonuses.length) write(`Bonuses: ${bonuses.join(', ')}`, 'system');
}
function askProfile() {
  const profs = STORY.meta?.character_profiles;
  if (!profs || Object.keys(profs).length === 0) return;
  const ids = Object.keys(profs);
  const lines = ids.map((id, i) => {
    const p = profs[id];
    const attr = p.attributes ? '  (' + Object.entries(p.attributes).map(([k,v])=>`${k} ${v}`).join(', ') + ')' : '';
    return `${i+1}. ${t(p.display)}${attr}\n   ${t(p.summary || '')}`;
  });
  const prompt_msg = `Choose your kind:\n\n${lines.join('\n\n')}\n\nEnter a number 1-${ids.length}:`;
  let raw = '';
  try { raw = (typeof prompt === 'function' ? prompt(prompt_msg) : null) || ''; } catch {}
  const idx = parseInt(raw, 10) - 1;
  const chosen = (Number.isInteger(idx) && idx >= 0 && idx < ids.length) ? ids[idx] : ids[0];
  player.profile_id = chosen;
  const p = profs[chosen];
  if (Array.isArray(p.starting_skills_extra)) for (const s of p.starting_skills_extra) player.skills.add(s);
  if (Array.isArray(p.starting_inventory_extra)) for (const it of p.starting_inventory_extra) player.inventory.push(it);
  player.activated = true;
  write(`You are ${t(p.display)}.`, 'success');
  if (p.summary) write(t(p.summary), 'system');
}

function showSoul() {
  write('Your soul (nsec — your character\'s only key):', 'spark');
  write(`  ${nsec}`, 'spark');
  write('Save this. Without it, this character cannot be recovered.', 'system');
  (async () => {
    try {
      await navigator.clipboard.writeText(nsec);
      showToast('nsec copied to clipboard. Save it somewhere safe.', 'identity');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = nsec; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        showToast('nsec copied to clipboard. Save it somewhere safe.', 'identity');
      } catch {
        showToast('Auto-copy failed — long-press the nsec line to select.', 'identity');
      }
    }
  })();
}

function importSoul(arg) {
  if (!arg) { write('Usage: import <nsec1...>', 'error'); return; }
  try {
    const decoded = nip19.decode(arg.trim());
    if (decoded.type !== 'nsec') { write('Not a valid nsec.', 'error'); return; }
    localStorage.setItem(STORAGE_NSEC, arg.trim());
    localStorage.setItem(STORAGE_NSEC_CREATED, String(Date.now()));
    localStorage.removeItem(STORAGE_STATE);
    write('Imported. Reloading…', 'system');
    setTimeout(() => location.reload(), 600);
  } catch {
    write('Invalid nsec format.', 'error');
  }
}

const STORAGE_RECENT = `nstadv:${STORY.meta.id}:recent_chars`;
const RECENT_MAX = 10;
function loadRecentChars() {
  try {
    const raw = localStorage.getItem(STORAGE_RECENT);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveRecentChars(arr) {
  try { localStorage.setItem(STORAGE_RECENT, JSON.stringify(arr.slice(0, RECENT_MAX))); } catch {}
}
function recordRecentChar() {
  if (!player || !player.activated) return;
  const list = loadRecentChars();
  const now = Math.floor(Date.now() / 1000);
  const idx = list.findIndex(e => e.nsec === nsec);
  const entry = { nsec, name: player.name || 'Wanderer', npub_short: npubShort, last_used_at: now };
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(entry);
  saveRecentChars(list);
}
function _relTime(epochSec) {
  if (!epochSec) return '?';
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
// Engine v0.50.2 — Tier B8: characters dialog (UI for the existing
// `characters` CLI command). Listing, switching, forgetting, importing nsec,
// new character. Triggered from the story picker's "👤 Characters" button.
function showCharactersDialog() {
  const list = loadRecentChars();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;color:#e8e6e3;';
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1815;border:1px solid #3a352e;border-radius:8px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:22px;';
  const activeNsec = (typeof nsec !== 'undefined' ? nsec : '');
  const activeName = (typeof player !== 'undefined' && player?.name) || '?';
  const activeNpub = (typeof npubShort === 'string' ? npubShort : '?');
  let listHtml = '';
  if (list.length === 0) {
    listHtml = '<div style="color:#9c9388;font-size:13px;padding:12px;text-align:center;">No saved characters on this browser yet.</div>';
  } else {
    listHtml = list.map((e, i) => {
      const isActive = e.nsec === activeNsec;
      return `<div style="padding:10px 12px;background:${isActive ? '#2a3528' : '#23201c'};border:1px solid ${isActive ? '#4a6a3a' : '#3a352e'};border-radius:4px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="flex:1;">
          <div style="font-weight:bold;color:${isActive ? '#6dc28d' : '#e8e6e3'};">${escapeHtml(e.name || '?')}${isActive ? ' <span style="font-size:11px;font-weight:normal;">(active)</span>' : ''}</div>
          <div style="font-size:11px;color:#9c9388;">${escapeHtml(e.npub_short || '?')} · last used ${_relTime(e.last_used_at)}</div>
        </div>
        <div style="display:flex;gap:4px;">
          ${isActive ? '' : `<button data-act="switch" data-idx="${i}" style="background:#c79b3a;border:none;color:#1a1408;border-radius:3px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;">Switch</button>`}
          ${isActive ? '' : `<button data-act="forget" data-idx="${i}" style="background:#3a352e;border:1px solid #6a4a3a;color:#c66;border-radius:3px;padding:4px 8px;font:inherit;font-size:12px;cursor:pointer;">Forget</button>`}
        </div>
      </div>`;
    }).join('');
  }
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:18px;font-weight:bold;">Characters on this browser</div>
      <button id="ch-close" style="background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;padding:4px 10px;font:inherit;font-size:13px;cursor:pointer;">×</button>
    </div>
    <div style="color:#9c9388;font-size:13px;margin-bottom:14px;">Each character is a separate Nostr identity (nsec). Switching reloads the page; your current character is saved automatically. Character state lives on the relays — switching browsers later, just <em>import &lt;nsec&gt;</em> to bring them back.</div>
    <div style="background:#0c0e10;border:1px solid #3a352e;border-radius:4px;padding:10px;margin-bottom:14px;font-size:12px;">
      <div style="color:#9c9388;margin-bottom:4px;">Currently active</div>
      <div style="color:#6dc28d;font-weight:bold;">${escapeHtml(activeName)} <span style="color:#9c9388;font-weight:normal;">${escapeHtml(activeNpub)}</span></div>
    </div>
    <div style="margin-bottom:10px;">${listHtml}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
      <button id="ch-import" title="Import a character by nsec key — restores their state from relays." style="background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;">+ Import nsec…</button>
      <button id="ch-new" title="Start a fresh character. Wipes the current one — make sure you've saved their nsec via 'soul' first." style="background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;">+ New character</button>
    </div>
  `;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  function close() { overlay.remove(); }
  panel.querySelector('#ch-close').onclick = close;
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  panel.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      const idx = parseInt(btn.dataset.idx, 10);
      const target = list[idx];
      if (!target) return;
      if (act === 'switch') {
        if (!confirm(`Switch to ${target.name}? Your current character is saved automatically. The page will reload.`)) return;
        try {
          recordRecentChar();
          localStorage.setItem(STORAGE_NSEC, target.nsec);
          localStorage.setItem(STORAGE_NSEC_CREATED, String(Date.now()));
          localStorage.removeItem(STORAGE_STATE);
          setTimeout(() => location.reload(), 200);
        } catch (e) { alert('Switch failed: ' + (e?.message || e)); }
      } else if (act === 'forget') {
        if (!confirm(`Forget "${target.name}" from this browser? Their state stays on the relays — you can re-import via nsec later.`)) return;
        list.splice(idx, 1);
        saveRecentChars(list);
        close();
        showCharactersDialog();
      }
    });
  });
  panel.querySelector('#ch-import').onclick = () => {
    const v = prompt('Paste an nsec to import this character:\n(format: nsec1...)');
    if (!v) return;
    try {
      // Validate the nsec is well-formed before reload
      nip19.decode(v.trim());
      if (!confirm('Import this character? The page will reload, and your CURRENT character will remain saved on this browser.')) return;
      recordRecentChar();
      localStorage.setItem(STORAGE_NSEC, v.trim());
      localStorage.setItem(STORAGE_NSEC_CREATED, String(Date.now()));
      localStorage.removeItem(STORAGE_STATE);
      setTimeout(() => location.reload(), 200);
    } catch (e) { alert('Invalid nsec: ' + (e?.message || e)); }
  };
  panel.querySelector('#ch-new').onclick = () => {
    close();
    newCharacter();
  };
}

// Engine v0.52.1 — Tier A3: cold-backup of the full character.
// Writes a JSON file containing the nsec + the serialized state (the same
// payload that lives in kind-30425 events) so the player has a fully
// offline-recoverable bundle. Pairs with `restore` to load back in.
function backupCharacterCommand(argRaw) {
  try {
    const payload = {
      format: 'taleforge-character-backup',
      format_version: '1',
      exported_at: new Date().toISOString(),
      engine_version: ENGINE_VERSION_LABEL,
      story_id: STORY.meta.id,
      story_version: STORY.meta.version,
      character_name: player.name || null,
      npub_short: npubShort,
      nsec: typeof nsec !== 'undefined' ? nsec : null,
      state: serializeState()
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fname = `taleforge-${STORY.meta.id}-${(player.name || 'character').replace(/[^a-z0-9]+/gi, '_')}-${new Date().toISOString().slice(0,10)}.json`;
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    write(`Backup saved: ${fname}`, 'success');
    write('This file contains your nsec — keep it safe and offline. Use "restore" + the file to bring this character back.', 'system');
  } catch (e) {
    write('Backup failed: ' + (e?.message || e), 'error');
  }
}

function restoreCharacterCommand(argRaw) {
  // Spawn a hidden file picker; on file → parse → confirm → swap nsec → reload.
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.style.display = 'none';
  inp.addEventListener('change', () => {
    const f = inp.files?.[0]; inp.remove();
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (obj?.format !== 'taleforge-character-backup') {
          write('Not a Taleforge character backup file.', 'error'); return;
        }
        if (!obj.nsec) { write('Backup is missing the nsec — cannot restore.', 'error'); return; }
        // Validate the nsec parses
        try { nip19.decode(obj.nsec); }
        catch { write('Backup nsec is malformed.', 'error'); return; }
        const tag = obj.character_name ? `"${obj.character_name}"` : '(unnamed)';
        const ok = confirm(`Restore character ${tag} from backup?\n\nStory: ${obj.story_id} v${obj.story_version}\nExported: ${obj.exported_at}\n\nThis will save your CURRENT character to this browser's recent list (so you can switch back later) and reload the page.`);
        if (!ok) return;
        try { recordRecentChar(); } catch {}
        localStorage.setItem(STORAGE_NSEC, obj.nsec);
        localStorage.setItem(STORAGE_NSEC_CREATED, String(Date.now()));
        // Optimistically write the saved state so the engine picks it up before relays sync.
        if (obj.state) {
          try { localStorage.setItem(STORAGE_STATE, JSON.stringify(obj.state)); } catch {}
        }
        write('Restoring — page reloading…', 'system');
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        write('Restore failed: ' + (e?.message || e), 'error');
      }
    };
    reader.readAsText(f);
  });
  document.body.appendChild(inp);
  inp.click();
  write('Pick a previously-exported backup .json file…', 'system');
}

// Engine v0.53.1 — Tier D14: share-character command.
// Opens a modal with a magic-link URL (?nsec=...) and a QR code so the
// player can hand the character off to another device. The URL bypasses
// the new-character flow on the receiving end after a confirm prompt.
function shareCharacterCommand(argRaw) {
  if (typeof nsec === 'undefined' || !nsec) {
    write('No active character to share.', 'error');
    return;
  }
  const baseUrl = `${location.origin}${location.pathname}`;
  const magicUrl = `${baseUrl}#nsec=${nsec}`;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;color:#e8e6e3;';
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1815;border:1px solid #3a352e;border-radius:8px;max-width:480px;width:100%;padding:22px;';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:18px;font-weight:bold;">Share character — magic link</div>
      <button id="sh-close" style="background:#3a352e;border:none;color:#e8e6e3;border-radius:4px;padding:4px 10px;font:inherit;font-size:13px;cursor:pointer;">×</button>
    </div>
    <div style="background:#3a2520;color:#e0a890;border:1px solid #6a4a3a;border-radius:4px;padding:10px;font-size:12px;margin-bottom:14px;line-height:1.5;">
      ⚠ <strong>This link contains your private key (nsec).</strong> Anyone who opens it can play AS you on their device. Share only with yourself, or with someone you fully trust.
    </div>
    <div style="font-size:13px;color:#bcb4a8;margin-bottom:6px;">Magic link (open on the other device):</div>
    <div style="display:flex;gap:6px;margin-bottom:14px;">
      <input id="sh-url" type="text" value="${escapeHtml(magicUrl)}" readonly style="flex:1;background:#0c0e10;border:1px solid #3a352e;color:#e8e6e3;border-radius:4px;padding:6px 8px;font:inherit;font-size:11px;font-family:monospace;">
      <button id="sh-copy" style="background:#c79b3a;border:none;color:#1a1408;border-radius:4px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;">Copy</button>
    </div>
    <div style="font-size:13px;color:#bcb4a8;margin-bottom:8px;text-align:center;">— or scan this QR code —</div>
    <div id="sh-qr" style="display:flex;justify-content:center;background:#fff;border-radius:4px;padding:14px;margin-bottom:12px;"></div>
    <div style="font-size:11px;color:#9c9388;line-height:1.5;">
      The receiving browser will prompt for confirmation before importing. Your CURRENT character on that browser (if any) gets saved to "recent characters" first, so you can switch back.<br><br>
      Tip: the link uses the URL hash (#nsec=…) — this means it isn't sent to any server, only kept local in the browser.
    </div>
  `;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  panel.querySelector('#sh-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); });
  panel.querySelector('#sh-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(magicUrl);
      panel.querySelector('#sh-copy').textContent = '✓ Copied';
      setTimeout(() => { panel.querySelector('#sh-copy').textContent = 'Copy'; }, 1500);
    } catch {
      const inp = panel.querySelector('#sh-url');
      inp.select(); document.execCommand('copy');
      panel.querySelector('#sh-copy').textContent = '✓ Copied';
      setTimeout(() => { panel.querySelector('#sh-copy').textContent = 'Copy'; }, 1500);
    }
  };
  // Lazy-load QR generator from a CDN; if unreachable, fall back to a textual notice.
  const qrTarget = panel.querySelector('#sh-qr');
  qrTarget.innerHTML = '<div style="color:#888;font-size:12px;">Generating QR…</div>';
  // Use Google Charts QR endpoint as fallback — but prefer offline by using an inline SVG generator.
  generateQrSvg(magicUrl, qrTarget);
}

// Tiny QR encoder good enough for ~600-char URLs.
// We avoid bundling a full QR library; instead we use the goqr.me data URL
// service. If the network is unreachable, we fall back to a text block the
// player can copy. (No private data is sent — the URL is the magic link
// the player just chose to share.)
function generateQrSvg(url, target) {
  target.innerHTML = '';
  const img = document.createElement('img');
  img.alt = 'QR code for the magic link';
  img.style.cssText = 'width:240px;height:240px;display:block;';
  // Use api.qrserver.com (open, no key required, returns PNG).
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&data=${encodeURIComponent(url)}&margin=2`;
  img.onerror = () => {
    target.innerHTML = '<div style="color:#a00;font-size:12px;text-align:center;">QR generation failed (offline?). Copy the link above instead.</div>';
  };
  target.appendChild(img);
}

function charactersCommand(argRaw) {
  const arg = (argRaw || '').trim();
  const list = loadRecentChars();
  if (!arg) {
    if (!list.length) {
      write('No recent characters yet. Once you start playing, this character will be remembered here.', 'system');
      write(`Active now: ${player.name || '?'} (${npubShort})`, 'system');
      write('To bring back another character, type "import <nsec>".', 'system');
      return;
    }
    write('=== Recent characters on this browser ===', 'title');
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const here = e.nsec === nsec ? '  ← active' : '';
      write(`  [${i+1}] ${e.name || '?'}  (${e.npub_short || '?'})  — ${_relTime(e.last_used_at)}${here}`, 'system');
    }
    write('', 'system');
    write('Switch: "characters <#>"   ·   Forget: "characters forget <#>"', 'system');
    write('(Switching reloads the page. Your current character is saved automatically.)', 'system');
    return;
  }
  const parts = arg.split(/\s+/);
  if (parts[0].toLowerCase() === 'forget' && parts[1]) {
    const idx = parseInt(parts[1], 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) { write('No such entry. Use "characters" to list.', 'error'); return; }
    if (list[idx].nsec === nsec) { write('Cannot forget the currently-active character. Switch to another one first.', 'error'); return; }
    const removed = list.splice(idx, 1)[0];
    saveRecentChars(list);
    write(`Forgot "${removed.name}".`, 'success');
    return;
  }
  const idx = parseInt(parts[0], 10) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
    write('No such entry. Use "characters" to list.', 'error'); return;
  }
  const target = list[idx];
  if (target.nsec === nsec) { write('That character is already active.', 'system'); return; }
  try {
    recordRecentChar();
    localStorage.setItem(STORAGE_NSEC, target.nsec);
    localStorage.setItem(STORAGE_NSEC_CREATED, String(Date.now()));
    localStorage.removeItem(STORAGE_STATE);
    write(`Switching to ${target.name}…`, 'system');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    write('Switch failed: ' + (e?.message || e), 'error');
  }
}

function newCharacter() {
  const ok = confirm('Start a fresh character?\n\nThis WIPES your current character on this browser — name, npub, skills, gold, sparks, inventory, equipment, chests, quests, achievements, the lot.\nIf you want to come back to this character later, type "soul" first to copy your nsec.');
  if (!ok) { write('Cancelled.', 'system'); return; }
  player.inventory = [];
  player.materials = {};
  player.equipment = {};
  player.skills = new Set();
  player.riddles_solved = new Set();
  player.fires = new Map();
  player.chests = new Map();
  player.quests = {};
  player.edges = new Map();
  player.flags = new Set();
  player.companion = null;
  player.events_fired = new Set();
  player.stats = { kills: {}, gold_earned: 0, sparks_earned: 0, deaths: 0, quests_completed: 0, crafts: 0, riddles_solved: 0, crafts_per_recipe: {} };
  player.achievements = new Set();
  player.outgoing_offers = new Map();
  player.incoming_offers = new Map();
  player.visited = new Set();
  player.gold = 0; player.sparks = 0; player.life = 0; player.turn = 0;
  player.name = null;
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('nstadv:')) keys.push(k);
    }
    for (const k of keys) { localStorage.removeItem(k); removed++; }
  } catch (e) {
    write('Local storage error: ' + e.message, 'error');
  }
  write(`Wiped ${removed} stored entr${removed === 1 ? 'y' : 'ies'}. Reloading with a fresh keypair…`, 'system');
  setTimeout(() => location.reload(), 600);
}

function askName(reason) {
  const msg = reason || 'What is your name, traveler?\n(2-32 characters; you can change it any time with "rename <new_name>")';
  let raw = '';
  try { raw = (typeof prompt === 'function' ? prompt(msg) : null) || ''; } catch {}
  raw = raw.trim();
  const userTyped = !!raw;
  if (!raw) raw = 'Wanderer';
  raw = raw.replace(/[\x00-\x1f]/g, '').slice(0, 32) || 'Wanderer';
  player.name = raw;
  if (userTyped) player.activated = true;
}

function renameCharacter(arg) {
  const newName = (arg || '').trim().replace(/[\x00-\x1f]/g, '').slice(0, 32);
  if (!newName) { write('Usage: rename <new_name>', 'error'); return; }
  const old = player.name;
  player.name = newName;
  player.activated = true;
  try { recordRecentChar(); } catch {}
  write(`You change your name from "${old}" to "${newName}".`, 'success');
  publishAction('rename', { from: old, to: newName });
}

function placeChest() {
  if (combatBlock('place')) return;
  const idx = player.inventory.indexOf('simple_chest');
  if (idx === -1) { write('You have no simple chest to place.', 'error'); return; }
  if (player.chests.has(player.location)) { write('You already have a chest here.', 'error'); return; }
  player.inventory.splice(idx, 1);
  player.chests.set(player.location, { items: [], materials: {} });
  write(T('You place a chest in {0}. Items stored here don\'t count toward your carry weight.', t(player.rooms[player.location].name)), 'success');
  publishAction('placed_chest', { location: player.location });
}

function showChest() {
  const chest = player.chests.get(player.location);
  if (!chest) { write('No chest here. (Try "place chest" if you have one.)', 'error'); return; }
  write(T('-- chest in {0} --', t(player.rooms[player.location].name)), 'system');
  if (chest.items.length === 0 && Object.values(chest.materials).every(q => q === 0))
    write('  (empty)');
  if (chest.items.length) {
    const groups = new Map();
    const unique = [];
    for (const i of chest.items) {
      if (player.edges?.has(i)) unique.push(i);
      else groups.set(i, (groups.get(i) || 0) + 1);
    }
    const parts = [];
    for (const [iid, n] of groups) parts.push(n > 1 ? `${itemDisplay(iid, true)} ×${n}` : itemDisplay(iid, true));
    for (const i of unique) parts.push(itemDisplay(i, true));
    write('  Items: ' + parts.join(', '));
  }
  const mats = Object.entries(chest.materials).filter(([_, q]) => q > 0);
  if (mats.length) write('  Materials: ' + mats.map(([k, q]) => `${itemDisplay(k)} ×${q}`).join(', '));
  write('"store <item>" to deposit, "retrieve <item>" to take.', 'system');
}

function _parseQtyArg(argRaw) {
  const parts = (argRaw || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { qty: null, name: '' };
  const head = parts[0].toLowerCase();
  if (head === 'all' || head === '*') {
    if (parts.length === 1) return { qty: 'all', name: '' };
    return { qty: 'all', name: parts.slice(1).join(' ').toLowerCase() };
  }
  if (/^\d+$/.test(parts[0])) {
    const n = parseInt(parts[0], 10);
    if (n < 1) return { error: 'Quantity must be ≥ 1.' };
    return { qty: n, name: parts.slice(1).join(' ').toLowerCase() };
  }
  return { qty: 1, name: argRaw.trim().toLowerCase() };
}

function storeItem(argRaw) {
  if (combatBlock('store')) return;
  const chest = player.chests.get(player.location);
  if (!chest) { write('No chest here.', 'error'); return; }
  const parsed = _parseQtyArg(argRaw);
  if (parsed.error) { write(parsed.error, 'error'); return; }
  if (parsed.qty == null) { write('Store what? Try "store <item>", "store 5 <item>", or "store all".', 'error'); return; }

  if (parsed.qty === 'all' && !parsed.name) {
    let total = 0;
    const summary = [];
    for (const [id, n] of Object.entries(player.materials)) {
      if (n <= 0) continue;
      chest.materials[id] = (chest.materials[id] || 0) + n;
      summary.push(`${n} ${itemDisplay(id)}`);
      total += n;
      player.materials[id] = 0;
    }
    if (total === 0) { write('Nothing stackable to store. Specify an item id for unique items.', 'error'); return; }
    write(`You store: ${summary.join(', ')}. (${total} total)`, 'success');
    return;
  }

  const name = parsed.name;
  const matKey = findMaterialKey(name);
  if (matKey) {
    const have = player.materials[matKey] || 0;
    const want = parsed.qty === 'all' ? have : Math.min(parsed.qty, have);
    if (want < 1) { write(`You don't have any ${itemDisplay(matKey)}.`, 'error'); return; }
    player.materials[matKey] -= want;
    chest.materials[matKey] = (chest.materials[matKey] || 0) + want;
    if (parsed.qty !== 'all' && want < parsed.qty) write(`(only had ${want})`, 'system');
    write(`You store ${want} ${itemDisplay(matKey)}.`, 'success');
    return;
  }
  const movedCount = (() => {
    const wantQty = parsed.qty === 'all' ? Infinity : parsed.qty;
    let n = 0;
    while (n < wantQty) {
      const idx = findItemIn(player.inventory, name);
      if (idx === -1) break;
      const item = player.inventory.splice(idx, 1)[0];
      chest.items.push(item);
      n++;
    }
    return n;
  })();
  if (movedCount === 0) { write(`You don't have "${name}".`, 'error'); return; }
  write(movedCount === 1 ? `You store ${name}.` : `You store ${movedCount} of ${name}.`, 'success');
}

function retrieveItem(argRaw) {
  if (combatBlock('retrieve')) return;
  const chest = player.chests.get(player.location);
  if (!chest) { write('No chest here.', 'error'); return; }
  const parsed = _parseQtyArg(argRaw);
  if (parsed.error) { write(parsed.error, 'error'); return; }
  if (parsed.qty == null) { write('Retrieve what? Try "retrieve <item>", "retrieve 5 <item>", or "retrieve all".', 'error'); return; }

  if (parsed.qty === 'all' && !parsed.name) {
    const summary = [];
    let totalMoved = 0;
    let stoppedDueToWeight = false;
    for (const [id, n] of Object.entries(chest.materials)) {
      if (n <= 0) continue;
      let canTake = n;
      while (canTake > 0 && !canCarry(id, 1)) canTake--;
      const w = STORY.items[id]?.weight ?? 1;
      const room = computeMaxCapacity() - computeWeight();
      const fit = Math.max(0, Math.min(canTake, Math.floor(room / Math.max(0.0001, w))));
      if (fit < n) stoppedDueToWeight = true;
      if (fit > 0) {
        chest.materials[id] -= fit;
        addItem(id, fit);
        summary.push(`${fit} ${itemDisplay(id)}`);
        totalMoved += fit;
      }
    }
    if (totalMoved === 0) { write('Nothing stackable to retrieve from the chest.', 'error'); return; }
    write(`You retrieve: ${summary.join(', ')}. (${totalMoved} total)`, 'success');
    if (stoppedDueToWeight) write('(some left in the chest — too heavy to carry)', 'system');
    return;
  }

  const name = parsed.name;
  for (const [id, qty] of Object.entries(chest.materials)) {
    if (qty <= 0) continue;
    if (id !== name && !(STORY.items[id]?.display.toLowerCase().includes(name))) continue;
    const want = parsed.qty === 'all' ? qty : Math.min(parsed.qty, qty);
    const w = STORY.items[id]?.weight ?? 1;
    const room = computeMaxCapacity() - computeWeight();
    const fit = Math.max(0, Math.min(want, Math.floor(room / Math.max(0.0001, w))));
    if (fit < 1) { write(`Too heavy to take ${itemDisplay(id)} now.`, 'error'); return; }
    chest.materials[id] -= fit;
    addItem(id, fit);
    if (fit < want) write(`(took ${fit}, the rest is too heavy for now)`, 'system');
    else if (parsed.qty !== 'all' && want < parsed.qty) write(`(chest only had ${want})`, 'system');
    write(`You retrieve ${fit} ${itemDisplay(id)}.`, 'success');
    return;
  }
  const wantQty = parsed.qty === 'all' ? Infinity : parsed.qty;
  let moved = 0;
  while (moved < wantQty) {
    const idx = chest.items.findIndex(i => {
      const it = STORY.items[i];
      return i === name || (it && it.display.toLowerCase().includes(name));
    });
    if (idx === -1) break;
    const item = chest.items[idx];
    if (!canCarry(item, 1)) {
      if (moved === 0) { write(`Too heavy to take ${itemDisplay(item)} now.`, 'error'); return; }
      write('(stopped — carry capacity reached)', 'system');
      break;
    }
    chest.items.splice(idx, 1);
    addItem(item, 1);
    moved++;
  }
  if (moved === 0) { write(`No "${name}" in the chest.`, 'error'); return; }
  write(`You retrieve ${moved} of ${name}.`, 'success');
  return;
}

function showCorpses() {
  const localDrops = getDropsInRoom(player.location);
  if (localDrops.length === 0) { write('No corpses or drops here.'); return; }
  write('-- corpses & drops here --', 'system');
  localDrops.forEach((d, i) => {
    const who = d.dropper === pk ? 'YOU' : d.dropper.slice(0, 8) + '…';
    const items = d.items.map(it => `${it.qty} ${itemDisplay(it.item)}`).join(', ');
    write(`  [${i + 1}]  ${who}'s drop  —  ${items}`);
  });
  write(`Type "loot <#>" to take everything.`, 'system');
}

async function loot(arg) {
  if (combatBlock('loot')) return;
  const idx = parseInt(arg, 10) - 1;
  if (Number.isNaN(idx)) { write('Specify a drop number.', 'error'); return; }
  const localDrops = getDropsInRoom(player.location);
  const drop = localDrops[idx];
  if (!drop) { write('No such drop here.', 'error'); return; }
  let totalWeight = 0;
  for (const di of drop.items) totalWeight += (STORY.items[di.item]?.weight ?? 1) * di.qty;
  if (computeWeight() + totalWeight > computeMaxCapacity()) { write(`Too heavy. Need ${totalWeight} more capacity. Drop or store first.`, 'error'); return; }
  for (const di of drop.items) addItem(di.item, di.qty);
  looted.set(drop.id, { looter: pk, looted_at: Math.floor(Date.now() / 1000) });
  const items = drop.items.map(it => `${it.qty} ${itemDisplay(it.item)}`).join(', ');
  write(`You loot: ${items}.`, 'success');
  await publishLoot(drop.id);
}

function showMarket(query) {
  if (combatBlock('market')) return;
  const room = player.rooms[player.location];
  const merchantId = npcsHere(player.location).find(n => STORY.npcs[n].is_marketplace);
  if (!merchantId) { write('No merchant here.', 'error'); return; }
  const allListings = getActiveListings(merchantId);
  const q = (query || '').trim().toLowerCase();
  let listings = allListings;
  if (q) {
    listings = allListings.filter(l => {
      const disp = (STORY.items[l.item]?.display || l.item || '').toLowerCase();
      const sellerHex = (l.seller_pubkey || '').toLowerCase();
      return disp.includes(q) || (l.item || '').toLowerCase().includes(q) || sellerHex.startsWith(q);
    });
  }
  write(`-- ${STORY.npcs[merchantId].display}'s listings${q ? ` · matching "${query}" (${listings.length}/${allListings.length})` : ''} --`, 'system');
  if (allListings.length === 0) { write('  (nothing listed)'); return; }
  if (q && listings.length === 0) { write(`  (no listings matching "${query}")`, 'echo'); return; }
  for (const l of listings) {
    const idx = allListings.indexOf(l);
    const seller = l.source === 'system' ? 'house' : (l.seller_pubkey === pk ? 'YOU' : l.seller_pubkey.slice(0, 8) + '…');
    write(`  [${idx + 1}]  ${itemDisplay(l.item)}  —  ${l.price_gold} gold  (${seller})`);
  }
  write(q
    ? `Type "buy <#>" to purchase, or "market" without a filter to see everything.`
    : `Type "buy <#>" to purchase. Tip: "market <keyword>" to filter (e.g. "market sword" / "market <seller-hex>").`,
    'system');
}

async function buy(arg) {
  if (combatBlock('buy')) return;
  if (transformBlock('buy')) return;
  const room = player.rooms[player.location];
  const merchantId = npcsHere(player.location).find(n => STORY.npcs[n].is_marketplace);
  if (!merchantId) { write('No merchant here.', 'error'); return; }
  if (!npcOpen(merchantId)) { write(describeNpcStatus(merchantId), 'error'); return; }
  const idx = parseInt(arg, 10) - 1;
  if (Number.isNaN(idx)) { write('Specify a listing number.', 'error'); return; }
  const listings = getActiveListings(merchantId);
  const listing = listings[idx];
  if (!listing) { write('No such listing.', 'error'); return; }
  const stars = renownTier(player.renown).stars;
  const isHouse = listing.source === 'system';
  const discount = isHouse ? Math.floor(listing.price_gold * (0.02 * stars)) : 0;
  const finalPrice = Math.max(0, listing.price_gold - discount);
  if (player.gold < finalPrice) { write(`Not enough gold (need ${finalPrice}).`, 'error'); return; }
  if (listing.seller_pubkey === pk) { write("You can't buy your own listing.", 'error'); return; }
  if (!canCarry(listing.item, listing.qty)) { write(`Too heavy. ${itemDisplay(listing.item)} weighs ${(STORY.items[listing.item]?.weight ?? 1) * listing.qty}; you have ${computeMaxCapacity() - computeWeight()} room.`, 'error'); return; }
  player.gold -= finalPrice;
  addItem(listing.item, listing.qty);
  marketplace.purchased.set(listing.id, { buyer_pubkey: pk, paid_gold: finalPrice, purchased_at: Math.floor(Date.now() / 1000) });
  if (discount > 0) write(`You buy ${itemDisplay(listing.item, true)} for ${finalPrice} gold (${listing.price_gold} - ${discount} reputation discount).`, 'success');
  else write(`You buy ${itemDisplay(listing.item, true)} for ${finalPrice} gold.`, 'success');
  if (listing.source !== 'system') await publishPurchase(listing.id, listing);
}

async function sell(args) {
  if (combatBlock('sell')) return;
  if (transformBlock('sell')) return;
  const room = player.rooms[player.location];
  const merchantId = npcsHere(player.location).find(n => STORY.npcs[n].is_marketplace);
  const directNpc  = npcsHere(player.location).find(n => STORY.npcs[n].behaviors?.includes('buys_items'));
  const buyer = merchantId || directNpc;
  if (!buyer) { write('There is no one here to sell to.', 'error'); return; }
  if (!npcOpen(buyer)) { write(describeNpcStatus(buyer), 'error'); return; }
  const parts = args.trim().split(/\s+/);
  if (!parts[0]) { write('Sell what? Usage: sell <item> [price]  or  sell <qty> <item> [price]', 'error'); return; }
  let qty = 1, ofs = 0, end = parts.length;
  if (/^\d+$/.test(parts[0])) {
    qty = parseInt(parts[0], 10);
    if (qty < 1) { write('Quantity must be at least 1.', 'error'); return; }
    ofs = 1;
  }
  let price = null;
  if (end - 1 > ofs && /^\d+$/.test(parts[end - 1])) {
    const parsed = parseInt(parts[end - 1], 10);
    if (parsed >= 1) { price = parsed; end = end - 1; }
  }
  const itemQuery = parts.slice(ofs, end).join(' ');
  if (!itemQuery) { write('Sell what?', 'error'); return; }
  const idx = findItemIn(player.inventory, itemQuery);
  let itemId, kind;
  if (idx !== -1) { itemId = player.inventory[idx]; kind = 'inv'; }
  else {
    const matKey = findMaterialKey(itemQuery);
    if (!matKey) { write(`You don't have "${itemQuery}".`, 'error'); return; }
    itemId = matKey; kind = 'mat';
  }
  const have = kind === 'inv' ? player.inventory.filter(i => i === itemId).length : (player.materials[itemId] || 0);
  if (have < qty) { write(`You only have ${have} ${itemDisplay(itemId)}.`, 'error'); return; }
  if (price !== null && merchantId) {
    let listed = 0;
    for (let n = 0; n < qty; n++) {
      if (kind === 'inv') {
        const i = player.inventory.indexOf(itemId);
        if (i === -1) break;
        player.inventory.splice(i, 1);
      } else {
        if ((player.materials[itemId] || 0) <= 0) break;
        player.materials[itemId]--;
      }
      await publishListing(merchantId, itemId, 1, price);
      listed++;
    }
    write(`You list ${listed}× ${itemDisplay(itemId)} on the market for ${price} gold each.`, 'success');
    if (listed > 1) write(`(${listed} separate listings; each pays out independently when bought.)`, 'system');
    return;
  }
  const value = STORY.items[itemId].value;
  let sold = 0;
  for (let n = 0; n < qty; n++) {
    if (kind === 'inv') {
      const i = player.inventory.indexOf(itemId);
      if (i === -1) break;
      player.inventory.splice(i, 1);
    } else {
      if ((player.materials[itemId] || 0) <= 0) break;
      player.materials[itemId]--;
    }
    sold++;
  }
  const total = value * sold;
  const stars = renownTier(player.renown).stars;
  const markup = total * (0.05 * stars);
  const adjusted = total + Math.floor(markup);
  player.gold += adjusted;
  player.stats.gold_earned += adjusted;
  if (stars > 0 && markup > 0) gainRenown('sale');
  if (sold === 1) write(`${STORY.npcs[buyer].display} takes ${itemDisplay(itemId, true)} for ${adjusted} gold${stars ? ` (${total} + ${Math.floor(markup)} reputation)` : ''}.`, 'success');
  else write(`${STORY.npcs[buyer].display} takes ${sold}× ${itemDisplay(itemId)} for ${adjusted} gold (${value} each${stars ? `, +${Math.floor(markup)} reputation` : ''}).`, 'success');
}

function showListings() {
  const mine = [];
  for (const [lid, l] of marketplace.listings) {
    if (l.seller_pubkey !== pk) continue;
    mine.push({ lid, l, sold: marketplace.purchased.has(lid) });
  }
  if (mine.length === 0) { write('You have no active listings.'); return; }
  write('Your listings:', 'system');
  for (const { lid, l, sold } of mine)
    write(`  ${lid.slice(0,8)}…  ${itemDisplay(l.item)} @ ${l.price_gold}g  [${sold ? 'SOLD' : 'active'}]`);
}

const WHISPER_MAX_LEN = 240;
function whisper(text) {
  if (combatBlock('whisper')) return;
  text = (text || '').trim();
  if (!text) { write('Whisper what? Usage: whisper <text> (broadcast to your room).', 'error'); return; }
  if (text.length > WHISPER_MAX_LEN) { write(`Whispers are at most ${WHISPER_MAX_LEN} characters.`, 'error'); return; }
  write(`You whisper: "${text}"`, 'whisper');
  publishAction('whisper', { text, location: player.location });
}

function giveCommand(argRaw) {
  if (combatBlock('give')) return;
  if (transformBlock('give')) return;
  let itemQuery, target, message = '';
  const toForm = argRaw.match(/^(.+?)\s+to\s+(\S+)(?:\s+(.+))?$/i);
  if (toForm) {
    itemQuery = toForm[1].trim();
    target = toForm[2].trim();
    message = (toForm[3] || '').trim();
  } else {
    const parts = argRaw.trim().split(/\s+/);
    if (parts.length < 2) { write('Usage: give <item> to <name|npub> [message]', 'error'); return; }
    itemQuery = parts[0];
    target = parts[1];
    message = parts.slice(2).join(' ');
  }
  let recipient_pubkey = null;
  if (target.startsWith('npub')) {
    try { const dec = nip19.decode(target); if (dec.type === 'npub') recipient_pubkey = dec.data; } catch {}
  }
  if (!recipient_pubkey) {
    for (const [pkOther, info] of knownPlayers) {
      if (info.name && info.name.toLowerCase() === target.toLowerCase()) { recipient_pubkey = pkOther; break; }
    }
  }
  if (!recipient_pubkey) { write(`No traveler named "${target}" known yet. Use their npub directly.`, 'error'); return; }
  if (recipient_pubkey === pk) { write("You can't give items to yourself.", 'error'); return; }
  const idx = findItemIn(player.inventory, itemQuery);
  let itemId;
  if (idx !== -1) { itemId = player.inventory[idx]; player.inventory.splice(idx, 1); }
  else {
    const matKey = findMaterialKey(itemQuery);
    if (!matKey) { write(`You don't have "${itemQuery}".`, 'error'); return; }
    itemId = matKey;
    player.materials[itemId]--;
  }
  publishGiftOffer(recipient_pubkey, itemId, 1, message);
  const recipientName = knownPlayers.get(recipient_pubkey)?.name || target;
  write(`📦 You offer ${itemDisplay(itemId, true)} to ${recipientName}. (held until they claim or decline)`, 'success');
  refreshSidebar();
}

function claimGift(arg) {
  if (combatBlock('claim')) return;
  if (!arg) { write('Usage: claim <offer_id>', 'error'); return; }
  let foundId = null;
  for (const oid of player.incoming_offers.keys()) {
    if (oid.startsWith(arg) || oid === arg) { foundId = oid; break; }
  }
  if (!foundId) { write(`No incoming offer matching "${arg}". Try "gifts" to list.`, 'error'); return; }
  const offer = player.incoming_offers.get(foundId);
  if (!canCarry(offer.item, offer.qty)) { write(`Too heavy to claim ${offer.qty} ${itemDisplay(offer.item)}. Drop or store something first.`, 'error'); return; }
  addItem(offer.item, offer.qty);
  player.incoming_offers.delete(foundId);
  publishGiftAccept(foundId, offer.sender_pubkey);
  write(`You accept the gift: ${offer.qty} ${itemDisplay(offer.item)} from ${offer.sender_name}.`, 'success');
  refreshSidebar();
}

function declineGift(arg) {
  if (combatBlock('decline')) return;
  if (!arg) { write('Usage: decline <offer_id>', 'error'); return; }
  let foundId = null;
  for (const oid of player.incoming_offers.keys()) {
    if (oid.startsWith(arg) || oid === arg) { foundId = oid; break; }
  }
  if (!foundId) { write(`No incoming offer matching "${arg}".`, 'error'); return; }
  const offer = player.incoming_offers.get(foundId);
  const item = STORY.items[offer.item];
  const total = (item?.value || 0) * (offer.qty || 1);
  if (total >= 50 && player._decline_confirmed !== foundId) {
    write(`Decline ${offer.sender_name}'s gift of ${offer.qty}× ${itemDisplay(offer.item)} (worth ~${total} gold)? Type "decline ${arg}" again to confirm.`, 'error');
    player._decline_confirmed = foundId;
    return;
  }
  player._decline_confirmed = null;
  player.incoming_offers.delete(foundId);
  publishGiftDecline(foundId, offer.sender_pubkey);
  write(`You decline ${offer.sender_name}'s gift.`, 'system');
}

function showGifts() {
  const inc = [...player.incoming_offers.entries()];
  const out = [...player.outgoing_offers.entries()];
  if (inc.length === 0 && out.length === 0) { write('No gift offers pending.'); return; }
  if (inc.length) {
    write('-- Incoming gifts --', 'system');
    for (const [oid, o] of inc) {
      const ago = Math.round((Date.now() - o.offered_at) / 60000);
      const msg = o.message ? ` — "${o.message}"` : '';
      write(`  ${oid.slice(0,8)}  ${o.sender_name}: ${o.qty} ${itemDisplay(o.item)}${msg}  (${ago}m ago)`);
    }
    write('  Accept with "claim <id>", refuse with "decline <id>".', 'system');
  }
  if (out.length) {
    write('-- Outgoing gifts (waiting) --', 'system');
    for (const [oid, o] of out) {
      const ago = Math.round((Date.now() - o.offered_at) / 60000);
      const recip = o.recipient_name || o.recipient_pubkey.slice(0,8) + '…';
      write(`  ${oid.slice(0,8)}  to ${recip}: ${o.qty} ${itemDisplay(o.item)}  (${ago}m ago)`);
    }
  }
}

function healCommand(target) {
  if (transformBlock('heal')) return;
  if (combatBlock('heal')) return;
  if (!target) { write('Usage: heal <name|npub>', 'error'); return; }
  let recipient_pubkey = null;
  if (target.startsWith('npub')) {
    try { const dec = nip19.decode(target); if (dec.type === 'npub') recipient_pubkey = dec.data; } catch {}
  }
  if (!recipient_pubkey) {
    for (const [pkOther, info] of knownPlayers) {
      if (info.name && info.name.toLowerCase() === target.toLowerCase()) { recipient_pubkey = pkOther; break; }
    }
  }
  if (!recipient_pubkey) { write(`No traveler named "${target}" known.`, 'error'); return; }
  if (recipient_pubkey === pk) { write('Heal yourself with "eat <healing item>".', 'error'); return; }
  let bestIdx = -1, bestItem = null, bestRestore = 0;
  for (let i = 0; i < player.inventory.length; i++) {
    const it = STORY.items[player.inventory[i]];
    const r = it?.effects?.restore_life || 0;
    if (r > bestRestore) { bestRestore = r; bestIdx = i; bestItem = player.inventory[i]; }
  }
  if (bestIdx === -1) { write('You have no item that restores life. Try crafting a healing salve.', 'error'); return; }
  player.inventory.splice(bestIdx, 1);
  publishHeal(recipient_pubkey, bestRestore);
  const recipientName = knownPlayers.get(recipient_pubkey)?.name || target;
  write(`💚 You consume ${itemDisplay(bestItem, true)} and bind its virtue to ${recipientName}. (+${bestRestore} life sent)`, 'success');
  refreshSidebar();
}

const DM_MAX_LEN = 500;
function dmCommand(args) {
  if (combatBlock('dm')) return;
  const trimmed = (args || '').trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) { write('Usage: dm <name|npub> <message>', 'error'); return; }
  const target = trimmed.slice(0, firstSpace);
  const text = trimmed.slice(firstSpace + 1).trim();
  if (!target || !text) { write('Usage: dm <name|npub> <message>', 'error'); return; }
  if (text.length > DM_MAX_LEN) { write(`Direct messages are at most ${DM_MAX_LEN} characters.`, 'error'); return; }
  let pubkeyHex = null;
  if (target.startsWith('npub')) {
    try { const dec = nip19.decode(target); if (dec.type === 'npub') pubkeyHex = dec.data; } catch {}
  }
  if (!pubkeyHex) {
    for (const [pkOther, info] of knownPlayers) {
      if (info.name && info.name.toLowerCase() === target.toLowerCase()) { pubkeyHex = pkOther; break; }
    }
  }
  if (!pubkeyHex) { write(`No traveler named "${target}" known yet. Use their npub directly, or wait until you've seen them in the world.`, 'error'); return; }
  publishDM(pubkeyHex, text);
  write(`[dm to ${target}] ${text}`, 'whisper');
}

function showInbox() {
  if (dmInbox.length === 0) { write('No messages.'); return; }
  write('-- Messages --', 'system');
  for (const m of dmInbox.slice(0, 15)) {
    const ago = Math.round((Date.now() - m.received_at) / 60000);
    write(`  ${m.from_name} (${ago}m ago): "${m.text}"`);
  }
  if (dmInbox.length > 15) write(`  ... and ${dmInbox.length - 15} older.`, 'system');
}

const PIN_MAX_LEN = 280;
function pinNotice(text) {
  if (combatBlock('pin')) return;
  text = (text || '').trim();
  if (!text) { write('Usage: pin <text>  (posts a note on this room\'s board)', 'error'); return; }
  if (text.length > PIN_MAX_LEN) { write(`Notices are at most ${PIN_MAX_LEN} characters.`, 'error'); return; }
  publishNotice(text);
  write(`You pin a note. "${text}"`, 'success');
}

function showNotices() {
  const localNotices = [];
  for (const [nid, n] of notices) {
    if (n.roomId === player.location) localNotices.push({ id: nid, ...n });
  }
  if (localNotices.length === 0) { write('No notices here.'); return; }
  localNotices.sort((a, b) => b.posted_at - a.posted_at);
  write(T('-- Notices in {0} --', t(player.rooms[player.location].name)), 'system');
  for (const n of localNotices.slice(0, 10)) {
    const ago = Math.round((Date.now() - n.posted_at) / 60000);
    const author = n.name || n.author.slice(0, 8) + '…';
    write(`  ${author} (${ago}m ago):`);
    write(`    "${n.text}"`);
  }
  if (localNotices.length > 10) write(`  ...and ${localNotices.length - 10} older notices.`);
}

function langCommand(argRaw) {
  const supported = STORY.meta.languages || [STORY.meta.language || 'en'];
  const arg = (argRaw || '').trim().toLowerCase();
  if (!arg) {
    write(`Current language: ${currentLang()}.`, 'system');
    write(`Story supports: ${supported.join(', ')}.`, 'system');
    if (supported.length > 1) write(`Switch with "lang <code>", e.g. "lang de".`, 'system');
    else write(`This story is single-language.`, 'system');
    return;
  }
  if (!supported.includes(arg)) {
    write(`This story doesn't have a "${arg}" translation. Available: ${supported.join(', ')}.`, 'error');
    return;
  }
  player.language = arg;
  resolveStoryProse();
  applyDomI18n();
  write(T('Language set to {0}.', arg), 'success');
  describeRoom();
  refreshSidebar();
}

function relayCommand(argRaw) {
  const parts = (argRaw || '').trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();
  if (!sub || sub === 'list') {
    write('-- Relays --', 'system');
    const custom = new Set(loadCustomRelays().map(r => r.replace(/\/+$/, '')));
    for (const r of RELAYS) {
      const norm = r.replace(/\/+$/, '');
      const tag = custom.has(norm) ? '[yours]' : '[default]';
      write(`  ${tag}  ${r}`);
    }
    write('Commands: "relay add <wss://...>", "relay remove <url>", "relay reset"', 'system');
    write('Note: changes apply on next page reload.', 'system');
    return;
  }
  if (sub === 'add') {
    const url = parts[1];
    if (!url || !/^wss?:\/\//i.test(url)) { write('Usage: relay add <wss://your-relay.example>', 'error'); return; }
    const list = loadCustomRelays();
    const norm = url.replace(/\/+$/, '');
    if (list.some(r => r.replace(/\/+$/, '') === norm) || DEFAULT_RELAYS.some(r => r.replace(/\/+$/, '') === norm)) {
      write(`Already on the list: ${url}`, 'system'); return;
    }
    list.push(url);
    saveCustomRelays(list);
    write(`Added ${url}.`, 'success');
    write('Reload the page to connect to it.', 'system');
    return;
  }
  if (sub === 'remove' || sub === 'rm') {
    const url = parts[1];
    if (!url) { write('Usage: relay remove <url>', 'error'); return; }
    const list = loadCustomRelays();
    const norm = url.replace(/\/+$/, '');
    const before = list.length;
    const next = list.filter(r => r.replace(/\/+$/, '') !== norm);
    if (next.length === before) { write(`Not in your custom list: ${url}`, 'error'); return; }
    saveCustomRelays(next);
    write(`Removed ${url}.`, 'success');
    write('Reload the page to apply.', 'system');
    return;
  }
  if (sub === 'reset') {
    saveCustomRelays([]);
    write('Custom relays cleared. Reload the page to use defaults only.', 'success');
    return;
  }
  write(`Unknown relay subcommand "${sub}". Try: relay list / add / remove / reset.`, 'error');
}

async function switchStoryCommand() {
  while (true) {
    const id = await showStoryPicker(STORY.meta.id);
    if (!id || id === STORY.meta.id) {
      write('Continuing in "' + STORY.meta.title + '".', 'system');
      return;
    }
    const target = loadStoryById(id);
    if (target && !hasAgeAck(target)) {
      const ok = await showAgeGateModal(target);
      if (!ok) {
        continue;
      }
    }
    try { saveLocal(); } catch {}
    write('Switching to "' + (target?.meta?.title || id) + '"... (reloading)', 'system');
    setTimeout(() => location.reload(), 400);
    return;
  }
}
function listStoriesCommand() {
  write('-- Stories in your library --', 'system');
  const here = STORY.meta.id;
  for (const opt of listAllStoryOptions()) {
    const mark = opt.id === here ? '✓' : ' ';
    write(`  ${mark} ${opt.label}  ·  ${Object.keys(opt.story.rooms||{}).length} rooms`);
  }
  write('Use "switch story" to change worlds.', 'system');
}

const CARVE_MAX_LEN = 80;
function carveCommand(text) {
  if (combatBlock('carve')) return;
  text = (text || '').trim();
  if (!text) { write('Usage: carve <text>  (leaves a permanent mark on this room, visible to all future visitors)', 'error'); return; }
  if (text.length > CARVE_MAX_LEN) { write(`Carvings are at most ${CARVE_MAX_LEN} characters. Carve few words.`, 'error'); return; }
  publishCarve(text);
  write(`You score the words into stone (or wood, or what stands here). "${text}"`, 'success');
  write('They will outlast your visit.', 'system');
}

function showCarvings() {
  const here = carvingsAt(player.location);
  if (here.length === 0) { write('No carvings here. Yet.'); return; }
  write(`-- Carvings in ${player.rooms[player.location].name} --`, 'system');
  for (const c of here) {
    const ago = Math.round((Date.now() - c.posted_at) / 60000);
    const author = c.name || c.author.slice(0, 8) + '…';
    const ttl = c.title ? ' ' + c.title : '';
    let when;
    if (ago < 60) when = `${ago}m ago`;
    else if (ago < 60*24) when = `${Math.round(ago/60)}h ago`;
    else when = `${Math.round(ago/(60*24))}d ago`;
    write(`  "${c.text}"`);
    write(`    — ${author}${ttl} (${when})`, 'system');
  }
}

function who() {
  if (knownPlayers.size === 0) { write('No other players seen yet.'); return; }
  write(`Known travelers: ${knownPlayers.size}`);
  for (const [pkOther, info] of knownPlayers) {
    const ago = Math.round((Date.now() - info.firstSeen) / 1000);
    const nm = info.name || pkOther.slice(0, 12) + '…';
    write(`  ${nm}  loc=${info.location || '?'}  (seen ${ago}s ago)`);
  }
}

const SHORT_NAMES = {
  forest_clearing: 'Clearing',
  deep_forest: 'Deep',
  red_canyon: 'Canyon',
  hilltop_ruins: 'Ruins',
  quiet_valley: 'Valley',
  echoing_cave: 'Cave',
  riverside_camp: 'Camp',
  greenmeadow_village: 'Village',
  moss_grotto: 'Grotto',
  hermits_glade: 'Glade',
  old_mine: 'Mine',
  salt_marsh: 'Marsh',
  mountain_peak: 'Peak',
  frozen_north: 'North',
  wave_cliffs: 'Cliffs',
  greycliffs_hamlet: 'Hamlet',
  forge_ruins: 'Forge',
  grand_hall: 'Hall',
  sacred_grove: 'Grove',
  abandoned_lighthouse: 'Lighthouse'
};
function shortRoomName(rid) {
  if (SHORT_NAMES[rid]) return SHORT_NAMES[rid];
  const parts = rid.split('_');
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function showMap(targetEl) {
  // Engine v0.50.2 — Tier B9: optional targetEl. When provided, the map's
  // wrap element is appended to it instead of the main terminal output.
  // Enables the zoomable mapview modal.
  const __outTarget = targetEl || out;
  const rooms = player.rooms;
  const layerOf = id => (rooms[id]?.layer || 'surface');
  const visited = [...player.visited].filter(id => rooms[id]);
  const byLayer = { overhead: [], surface: [], underground: [] };
  for (const id of visited) {
    const L = layerOf(id);
    if (!byLayer[L]) byLayer[L] = [];
    byLayer[L].push(id);
  }
  const orderedLayers = ['overhead', 'surface', 'underground'].filter(L => byLayer[L]?.length);
  for (const L of Object.keys(byLayer)) {
    if (!['overhead','surface','underground'].includes(L) && byLayer[L].length) orderedLayers.push(L);
  }

  const dirOffset = {
    north:[0,-1], south:[0,1], east:[1,0], west:[-1,0],
    up:[0,-3], down:[0,3], in:[0,2], out:[0,-2]
  };
  const playerLayer = layerOf(player.location);
  const layerSequence = [];
  if (orderedLayers.includes(playerLayer)) layerSequence.push(playerLayer);
  for (const L of orderedLayers) if (L !== playerLayer) layerSequence.push(L);
  const layoutByLayer = new Map();
  for (const L of layerSequence) {
    const ids = byLayer[L];
    const positions = new Map();
    const inLayer = new Set(ids);
    const occupied = new Set();
    const anchors = [];
    const seenAnchorRooms = new Set();
    for (const id of ids) {
      if (seenAnchorRooms.has(id)) continue;
      for (const [dir, rawTarget] of Object.entries(rooms[id].exits || {})) {
        const r = resolveExit(rawTarget); if (!r) continue;
        const target = r.target;
        if (inLayer.has(target)) continue;
        for (const [otherL, otherPos] of layoutByLayer) {
          if (otherL === L) continue;
          if (otherPos.has(target)) {
            const [ox] = otherPos.get(target);
            anchors.push({ room: id, x: ox });
            seenAnchorRooms.add(id);
            break;
          }
        }
        if (seenAnchorRooms.has(id)) break;
      }
    }
    let primarySeed = null;
    if (ids.includes(player.location)) primarySeed = player.location;
    if (!primarySeed && anchors.length > 0) primarySeed = anchors[0].room;
    if (!primarySeed) primarySeed = ids[0];
    positions.set(primarySeed, [0, 0]);
    occupied.add('0,0');
    const seedQueue = [primarySeed];
    for (const { room, x } of anchors) {
      if (positions.has(room)) continue;
      let ax = x, ay = 0;
      let xSlide = 0;
      while (occupied.has(`${ax},${ay}`)) {
        ay++;
        if (ay > 50) {
          xSlide++;
          ax = x + (xSlide % 2 === 1 ? xSlide : -xSlide);
          ay = 0;
          if (xSlide > 10) break;
        }
      }
      positions.set(room, [ax, ay]);
      occupied.add(`${ax},${ay}`);
      seedQueue.push(room);
    }
    while (seedQueue.length) {
      const cur = seedQueue.shift();
      const [cx, cy] = positions.get(cur);
      for (const [dir, rawTarget] of Object.entries(rooms[cur].exits || {})) {
        const r = resolveExit(rawTarget); if (!r) continue;
        const target = r.target;
        if (!inLayer.has(target)) continue;
        if (positions.has(target)) continue;
        const off = dirOffset[dir]; if (!off) continue;
        let nx = cx + off[0], ny = cy + off[1];
        let guard = 0;
        const stepX = off[0] === 0 ? 0 : Math.sign(off[0]);
        const stepY = off[1] === 0 ? 0 : Math.sign(off[1]);
        while (occupied.has(`${nx},${ny}`) && guard < 200) {
          nx += stepX || 1;
          ny += stepY;
          guard++;
        }
        if (occupied.has(`${nx},${ny}`)) continue;
        positions.set(target, [nx, ny]);
        occupied.add(`${nx},${ny}`);
        seedQueue.push(target);
      }
    }
    let stackY = 0;
    for (const id of ids) {
      if (!positions.has(id)) {
        let maxX = 0;
        for (const [x, _y] of positions.values()) maxX = Math.max(maxX, x);
        const px = maxX + 2;
        let py = stackY++;
        while (occupied.has(`${px},${py}`)) py++;
        positions.set(id, [px, py]);
        occupied.add(`${px},${py}`);
      }
    }
    layoutByLayer.set(L, positions);
  }

  const labelMax = 8;
  const boxW = labelMax + 4;
  const cellW = boxW + 2;
  const cellH = 4;
  function renderLayerGrid(L, positions) {
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (const [x, y] of positions.values()) { minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); }
    if (!isFinite(minX)) return '(no rooms)';
    const cols = (maxX - minX + 1) * cellW;
    const rowsH = (maxY - minY + 1) * cellH;
    const grid = Array(rowsH).fill(null).map(() => Array(cols).fill(' '));
    function put(y, x, s) { for (let i = 0; i < s.length; i++) if (x+i>=0 && x+i<cols && y>=0 && y<rowsH) grid[y][x+i] = s[i]; }
    for (const [room, [x, y]] of positions) {
      const cx = (x - minX) * cellW, cy = (y - minY) * cellH;
      const here = room === player.location;
      let mark = ' ';
      if (player.chests.has(room)) mark = '📦';
      else if (rooms[room].hazards?.wolves) mark = '⚠';
      else if (fireActive(room)) mark = '🔥';
      let stair = '';
      for (const [dir, rawTarget] of Object.entries(rooms[room].exits || {})) {
        const r = resolveExit(rawTarget); if (!r) continue;
        if (!player.visited.has(r.target)) continue;
        if (layerOf(r.target) === L) continue;
        if (dir === 'up')   { stair = '↑'; break; }
        if (dir === 'down') { stair = '↓'; break; }
        if (dir === 'in')   { stair = '→'; break; }
        if (dir === 'out')  { stair = '←'; break; }
        if (dir === 'north' && !stair) stair = '⇡';
        else if (dir === 'south' && !stair) stair = '⇣';
        else if (dir === 'east'  && !stair) stair = '⇢';
        else if (dir === 'west'  && !stair) stair = '⇠';
      }
      if (stair && mark === ' ') mark = stair;
      const sn = shortRoomName(room);
      const name = sn.length > labelMax ? sn.slice(0, labelMax-1) + '…' : sn;
      const inner = (here ? '*' : ' ') + name.padEnd(labelMax) + mark;
      put(cy + 0, cx, '┌' + '─'.repeat(boxW - 2) + '┐');
      put(cy + 1, cx, '│' + inner + '│');
      put(cy + 2, cx, '└' + '─'.repeat(boxW - 2) + '┘');
    }
    for (const [room, [x, y]] of positions) {
      const cx = (x - minX) * cellW, cy = (y - minY) * cellH;
      for (const [dir, rawTarget] of Object.entries(rooms[room].exits || {})) {
        const r = resolveExit(rawTarget); if (!r) continue;
        const target = r.target;
        if (!positions.has(target)) continue;
        const [tx, ty] = positions.get(target);
        const dx = tx - x, dy = ty - y;
        if      (dx ===  1 && dy ===  0) put(cy + 1, cx + boxW, '──');
        else if (dx ===  0 && dy ===  1) put(cy + 3, cx + Math.floor(boxW/2), '│');
        else if (dx ===  0 && dy ===  2) { put(cy + 3, cx + Math.floor(boxW/2), '┊'); put(cy + 5, cx + Math.floor(boxW/2), '┊'); }
        else if (dx ===  0 && dy === -2) { put(cy - 1, cx + Math.floor(boxW/2), '┊'); put(cy - 3, cx + Math.floor(boxW/2), '┊'); }
        else if (dx ===  0 && dy ===  3) { put(cy + 3, cx + Math.floor(boxW/2), '╎'); put(cy + 5, cx + Math.floor(boxW/2), '╎'); put(cy + 7, cx + Math.floor(boxW/2), '╎'); }
        else if (dx ===  0 && dy === -3) { put(cy - 1, cx + Math.floor(boxW/2), '╎'); put(cy - 3, cx + Math.floor(boxW/2), '╎'); put(cy - 5, cx + Math.floor(boxW/2), '╎'); }
      }
    }
    return grid.map(row => row.join('').replace(/\s+$/, '')).join('\n');
  }

  const wrap = document.createElement('div');
  wrap.className = 'map-wrap';
  const header = document.createElement('div');
  header.className = 'line system';
  const layerHint = orderedLayers.length > 1 ? ` · layers: ${orderedLayers.join(' / ')}` : '';
  header.textContent = `-- map (* = you, ⚠ = wolves, 📦 = chest, 🔥 = fire, ↑↓→← = inter-layer)${layerHint} — ${player.visited.size} room${player.visited.size === 1 ? '' : 's'} discovered --`;
  wrap.appendChild(header);

  for (const L of orderedLayers) {
    const positions = layoutByLayer.get(L);
    const isPlayer = L === playerLayer;
    const layerLabel = document.createElement('div');
    layerLabel.className = 'line system';
    layerLabel.style.fontWeight = isPlayer ? '700' : '400';
    layerLabel.style.opacity = isPlayer ? '1' : '0.65';
    layerLabel.style.marginTop = '6px';
    layerLabel.textContent = `[ ${L.toUpperCase()} ]${isPlayer ? '  ← you are here' : ''}  (${positions.size} room${positions.size===1?'':'s'})`;
    wrap.appendChild(layerLabel);
    const pre = document.createElement('pre');
    pre.className = 'map-pre';
    pre.style.opacity = isPlayer ? '1' : '0.7';
    pre.textContent = renderLayerGrid(L, positions);
    wrap.appendChild(pre);
  }
  __outTarget.appendChild(wrap);

  const undiscovered = [];
  for (const room of player.visited) {
    for (const [dir, rawTarget] of Object.entries(rooms[room].exits || {})) {
      const r = resolveExit(rawTarget); if (!r) continue;
      if (!player.visited.has(r.target)) undiscovered.push(`${shortRoomName(room)} → ${dir}`);
    }
  }
  if (undiscovered.length) {
    const hint = document.createElement('div');
    hint.className = 'line system';
    hint.style.opacity = '0.7';
    hint.textContent = `Unexplored exits: ${undiscovered.join(', ')}`;
    __outTarget.appendChild(hint);
  }
  if (__outTarget === out) out.scrollTop = out.scrollHeight;
}

// Engine v0.50.2 — Tier B9: zoomable, pannable map modal.
// Wheel = zoom (Ctrl-wheel desktop, pinch on touch). Drag to pan. Esc to close.
function showMapModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;flex-direction:column;align-items:stretch;font-family:inherit;';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#1a1815;border-bottom:1px solid #3a352e;color:#e8e6e3;font-size:13px;';
  header.innerHTML = `
    <div>🗺 Map view <span style="color:#9c9388;font-size:11px;margin-left:8px;">scroll-wheel zoom · drag to pan · double-click to reset · Esc to close</span></div>
    <div>
      <button id="mv-zoom-out" title="Zoom out" style="background:#3a352e;border:none;color:#e8e6e3;border-radius:3px;padding:3px 9px;cursor:pointer;font:inherit;font-size:12px;margin-right:4px;">−</button>
      <span id="mv-zoom-pct" style="font-size:11px;color:#9c9388;margin:0 4px;">100%</span>
      <button id="mv-zoom-in" title="Zoom in" style="background:#3a352e;border:none;color:#e8e6e3;border-radius:3px;padding:3px 9px;cursor:pointer;font:inherit;font-size:12px;margin-right:8px;">+</button>
      <button id="mv-close" style="background:#c79b3a;border:none;color:#1a1408;border-radius:3px;padding:4px 12px;cursor:pointer;font:inherit;font-weight:600;font-size:12px;">Close</button>
    </div>
  `;
  overlay.appendChild(header);
  const viewport = document.createElement('div');
  viewport.style.cssText = 'flex:1;overflow:hidden;position:relative;background:#0c0e10;cursor:grab;';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;left:50%;top:50%;transform-origin:0 0;transform:translate(-50%,-50%) scale(1);transition:transform 0.05s linear;color:#e8e6e3;';
  stage.style.padding = '20px';
  // Render map into stage
  try { showMap(stage); }
  catch (e) {
    const err = document.createElement('div');
    err.style.cssText = 'color:#c66;padding:20px;';
    err.textContent = 'Map render failed: ' + (e?.message || e);
    stage.appendChild(err);
  }
  // Engine v0.53.1 — Tier A1 follow-on: legend inside the zoom modal.
  const legend = document.createElement('div');
  legend.style.cssText = 'margin-top:16px;padding:8px 12px;border-top:1px solid #3a352e;font-size:12px;color:#9c9388;line-height:1.6;';
  legend.innerHTML = 'Legend: &nbsp;<span style="color:#f0b54a;">*</span> you &nbsp;·&nbsp; 📦 chest &nbsp;·&nbsp; ⚠ wolves &nbsp;·&nbsp; 🔥 fire &nbsp;·&nbsp; <span style="color:#bcb4a8;">⇡⇣</span> stairs (up/down) &nbsp;·&nbsp; <span style="color:#bcb4a8;">⇢⇠</span> stairs (in/out) &nbsp;·&nbsp; ┊ in/out &nbsp;·&nbsp; ╎ through wall';
  stage.appendChild(legend);
  viewport.appendChild(stage);
  overlay.appendChild(viewport);
  document.body.appendChild(overlay);

  const stateMV = { scale: 1, dx: 0, dy: 0 };
  const minScale = 0.4, maxScale = 4;
  function applyTransform() {
    stage.style.transform = `translate(calc(-50% + ${stateMV.dx}px), calc(-50% + ${stateMV.dy}px)) scale(${stateMV.scale})`;
    const pct = header.querySelector('#mv-zoom-pct');
    if (pct) pct.textContent = Math.round(stateMV.scale * 100) + '%';
  }
  function setScale(s, originX, originY) {
    const newScale = Math.min(maxScale, Math.max(minScale, s));
    if (newScale === stateMV.scale) return;
    if (originX != null && originY != null) {
      const rect = viewport.getBoundingClientRect();
      const cx = originX - rect.left - rect.width / 2;
      const cy = originY - rect.top - rect.height / 2;
      const k = newScale / stateMV.scale;
      stateMV.dx = cx - (cx - stateMV.dx) * k;
      stateMV.dy = cy - (cy - stateMV.dy) * k;
    }
    stateMV.scale = newScale;
    applyTransform();
  }
  // Wheel zoom (Ctrl on desktop, naked on touch trackpad pinch)
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(stateMV.scale * delta, e.clientX, e.clientY);
  }, { passive: false });
  // Drag to pan
  let dragging = false, sx = 0, sy = 0, idx0 = 0, idy0 = 0;
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true; sx = e.clientX; sy = e.clientY; idx0 = stateMV.dx; idy0 = stateMV.dy;
    viewport.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    stateMV.dx = idx0 + (e.clientX - sx);
    stateMV.dy = idy0 + (e.clientY - sy);
    applyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; viewport.style.cursor = 'grab'; });
  // Touch: 1-finger pan, 2-finger pinch
  let pinchDist = 0;
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) { dragging = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; idx0 = stateMV.dx; idy0 = stateMV.dy; }
    else if (e.touches.length === 2) {
      pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  });
  viewport.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
      stateMV.dx = idx0 + (e.touches[0].clientX - sx);
      stateMV.dy = idy0 + (e.touches[0].clientY - sy);
      applyTransform();
    } else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchDist > 0) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        setScale(stateMV.scale * (d / pinchDist), cx, cy);
      }
      pinchDist = d;
    }
  }, { passive: false });
  viewport.addEventListener('touchend', () => { dragging = false; pinchDist = 0; });
  viewport.addEventListener('dblclick', () => { stateMV.scale = 1; stateMV.dx = 0; stateMV.dy = 0; applyTransform(); });
  // Buttons
  header.querySelector('#mv-zoom-in').onclick = () => setScale(stateMV.scale * 1.2);
  header.querySelector('#mv-zoom-out').onclick = () => setScale(stateMV.scale / 1.2);
  function close() { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  function escHandler(e) { if (e.key === 'Escape') close(); }
  header.querySelector('#mv-close').onclick = close;
  document.addEventListener('keydown', escHandler);
}

const TUTORIAL_HINTS = {
  first_look: [
    '[tutorial] "look" reprints the room. Notice the items, exits, and any people present.',
    '[tutorial] To travel, type a direction (n/s/e/w · sometimes u/d/in/out) or "go <dir>".'
  ],
  first_move: [
    '[tutorial] You moved. The world is persistent — every room remembers what you did.',
    '[tutorial] Other players may share rooms with you. Try "who" to see who is online.'
  ],
  first_take: [
    '[tutorial] You picked something up. Type "inv" to see what you carry.',
    '[tutorial] Each item has weight; "status" shows your carry capacity.'
  ],
  first_inv: [
    '[tutorial] You can "drop", "wear" / "wield" gear, "eat" food, or "place chest" once you own one.'
  ],
  first_talk: [
    '[tutorial] NPCs may pose riddles or offer quests. Use "answer <text>" to reply, "accept <id>" to take a quest.'
  ],
  first_combat: [
    '[tutorial] Combat: "attack" to strike, "flee" to escape. "assist <name>" to help another player\'s fight.',
    '[tutorial] Watch your life — sleep at fires or shelters to recover. Death respawns you (you keep your sparks).'
  ],
  first_quests: [
    '[tutorial] "accept <id>" picks up an offered quest. "turn in <id>" claims the rewards.',
    '[tutorial] Daily quests rotate at dawn — turn them in before then or they expire.'
  ],
  first_skills: [
    '[tutorial] "learn <skill>" spends sparks to unlock new abilities and recipes.',
    '[tutorial] Sparks are earned through crafting, exploration, and quests.'
  ],
  first_social: [
    '[tutorial] This is a shared world over Nostr. "whisper" speaks to your room only;',
    '[tutorial] "dm <name|npub> <text>" reaches one person directly. "carve" leaves a mark all visitors see.'
  ]
};

function showHint(key) {
  if (!player || player.tutorial_done) return;
  if (!player.tutorial_seen) player.tutorial_seen = new Set();
  if (player.tutorial_seen.has(key)) return;
  player.tutorial_seen.add(key);
  const lines = TUTORIAL_HINTS[key];
  if (!lines) return;
  write('');
  for (const l of lines) write(l, 'system');
  if (player.tutorial_seen.size >= 5 && !player.tutorial_done) {
    player.tutorial_done = true;
    write('[tutorial] You have the basics. Hints will stop. Type "tutorial" to revisit, "help" for the full command list.', 'system');
  }
}

function maybeAdvanceTutorial(cmd) {
  if (!player || player.tutorial_done) return;
  switch (cmd) {
    case 'look': case 'l':
      showHint('first_look'); break;
    case 'go': case 'move':
    case 'north': case 'south': case 'east': case 'west':
    case 'up': case 'down': case 'in': case 'out':
    case 'n': case 's': case 'e': case 'w': case 'u': case 'd':
      showHint('first_move'); break;
    case 'take': case 'get':
      showHint('first_take'); break;
    case 'inv': case 'inventory': case 'i':
      showHint('first_inv'); break;
    case 'talk':
      showHint('first_talk'); break;
    case 'hunt': case 'attack': case 'assist': case 'help_attack': case 'parry': case 'charge': case 'retreat':
      showHint('first_combat'); break;
    case 'quests': case 'q': case 'accept': case 'turn': case 'turnin':
      showHint('first_quests'); break;
    case 'skills': case 'sk': case 'learn':
      showHint('first_skills'); break;
    case 'whisper': case 'shout': case 'dm': case 'tell': case 'carve':
      showHint('first_social'); break;
  }
}

function tutorialCommand(arg) {
  arg = (arg || '').trim().toLowerCase();
  if (arg === 'off' || arg === 'skip' || arg === 'done') {
    player.tutorial_done = true;
    write('Tutorial hints disabled. Type "tutorial" any time to re-read the guide, or "tutorial on" to re-enable hints.', 'success');
    return;
  }
  if (arg === 'on' || arg === 'reset') {
    player.tutorial_done = false;
    player.tutorial_seen = new Set();
    write('Tutorial hints re-enabled. Try a few commands to see them again.', 'success');
    return;
  }
  const parts = arg.split(/\s+/);
  if (parts[0] === 'topics') {
    const all = Object.keys(TUTORIAL_HINTS);
    const seen = (player.tutorial_seen && typeof player.tutorial_seen.size === 'number') ? player.tutorial_seen.size : 0;
    const total = all.length;
    write(`Tutorial topics — ${seen}/${total} seen${player.tutorial_done ? ' · auto-hints disabled' : ''}:`, 'system');
    for (const k of all) {
      const tick = (player.tutorial_seen && player.tutorial_seen.has(k)) ? '✓' : ' ';
      write(`  [${tick}] ${k}`, 'system');
    }
    write('Type "tutorial topic <name>" to re-read one.', 'system');
    return;
  }
  if (parts[0] === 'topic' && parts[1]) {
    const lines = TUTORIAL_HINTS[parts[1]];
    if (!lines) {
      write(`No tutorial topic "${parts[1]}". Type "tutorial topics" to list available ones.`, 'error');
      return;
    }
    write('');
    for (const l of lines) write(l, 'system');
    return;
  }
  write('=== TUTORIAL: BEGINNER\'S GUIDE ===', 'title');
  write('You are a traveler in a persistent shared world. Other players may share rooms with you.', 'system');
  write('');
  write('-- Moving --', 'system');
  write('  Type a direction: n / s / e / w (sometimes u / d / in / out)', 'system');
  write('  "look" reprints the room. "map" shows visited rooms.', 'system');
  write('-- Things --', 'system');
  write('  "take <item>" / "drop <item>". "inv" lists what you carry. "status" shows weight & life.', 'system');
  write('  "wear" / "wield" to equip; "eq" shows slots. "eat" / "drink" / "rest" / "sleep" to survive.', 'system');
  write('-- People & quests --', 'system');
  write('  "talk <npc>", "answer <text>" for riddles. "quests" / "accept <id>" / "turn in <id>".', 'system');
  write('  "who" lists nearby players. "whisper", "dm", "carve" to communicate.', 'system');
  write('-- Combat & skills --', 'system');
  write('  "hunt" starts a fight; "attack", "flee", or "assist <name>". Death respawns you.', 'system');
  write('  "skills" / "learn <skill>" to grow. "recipes" / "craft <recipe>" once you have ingredients.', 'system');
  write('-- Identity --', 'system');
  write('  Your character lives on a Nostr key. "soul" shows your nsec — save it to log in elsewhere.', 'system');
  write('  "rename <new_name>" changes your visible name. "new character" starts fresh.', 'system');
  write('');
  write('Type "tutorial off" to silence the auto-hints, or "help" for the full command list.', 'system');
}

function writeBlock(headerText, bodyFn, footerText = '── end ──') {
  const startIdx = out.children.length;
  write(headerText, 'title');
  bodyFn();
  write(footerText, 'echo');
  requestAnimationFrame(() => {
    const hdr = out.children[startIdx];
    if (hdr && typeof hdr.scrollIntoView === 'function') {
      try { hdr.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch { hdr.scrollIntoView(); }
    }
  });
}

function help(query) {
  const filterQ = (query || '').trim().toLowerCase();
  return helpImpl(filterQ);
}
function helpImpl(filterQ) {
  const skills = STORY.skills || {};
  const items = STORY.items || {};
  const npcs = STORY.npcs || {};
  const hasTransform = !!(skills.lycanthropy || skills.vampirism);
  const hasSmithing = Object.values(npcs).some(n => Array.isArray(n.behaviors) && n.behaviors.includes('offers_smithing'));
  const hasTaming = !!skills.taming || Object.values(skills).some(s => Array.isArray(s.tags) && s.tags.includes('taming'));
  const hasWorldEvents = !!(STORY.world_events && Object.keys(STORY.world_events).length > 0);
  const hasMarketplace = Object.values(npcs).some(n => n.is_marketplace === true);
  const hasBestiary = !!(STORY.entities && Object.keys(STORY.entities).length > 0);
  const hasAmmo = Object.values(items).some(it => it?.effects?.requires_ammo);
  const lines = [
    T('Movement:        n/s/e/w · u/d · in · out · go <dir> · look · look <dir>  (peek without moving) · map'),
    T('Items:           take <x> · drop <x> · bury <x|qty x> · inv · status'),
    T('World:           talk <npc> · answer <text> · read <item>  (lore, letters, books)'),
    T('                 examine / inspect / x <item|creature>  (close inspection — stats, effects, descriptions, kill counts)'),
    T('Skills:          skills · learn <skill> · skilltree / tree  (visual prereq view)'),
    T('Gathering:       chop / forage / gather (needs skill)'),
    T('Crafting:        recipes · craft <recipe> · craft <qty> <recipe>  (batch; each craft awards sparks)'),
    T('Survival:        eat <x> · eat <qty> <x> · drink · light fire · hunt · attack · flee · rest · sleep'),
    T('                 recap / last  (replay narration from your most recent fight)'),
    T('                 parry  (defensive stance — next blow has +60% dodge)'),
    T('                 charge  (Hunting only, +50% damage on next attack but enemy hits 1.5×; once per fight)'),
    T('                 retreat  (try to escape without parting damage; 70% base, +20% with Hunting)'),
    ...(hasTransform ? [T('                 transform [wolf|bat]  (if cursed) · revert  (change back)')] : []),
    ...(hasAmmo ? [T('                 (some ranged weapons consume ammo per shot — see item descriptions)')] : []),
    T('                 assist [<name>]  (join another player\'s fight in the same room)'),
    T('Equipment:       wear / wield <x> · unwear <slot> · equipment / eq'),
    ...(hasSmithing ? [T('Smithing:        sharpen <x> · repair <x>  (at the village blacksmith)')] : []),
    ...(hasTaming ? [T('Companion:       tame · feed · companion / pet · dismiss')] : []),
    T('Progress:        quests / q · stats · achievements'),
    T('                 accept <id> · turn in <id>'),
    T('                 complete / finish [<id>]  (force-completes a null-giver quest if all objectives met — escape hatch)'),
    T('                 (daily quests auto-rotate at dawn — turn in before dawn or they expire)'),
    T('Storage:         place chest · chest · store [<n>] <x> · retrieve [<n>] <x>  (also "store all" / "retrieve all")'),
    ...(hasBestiary ? [T('Bestiary:        bestiary  (list creatures the story defines, with kill counts)')] : []),
    ...(hasWorldEvents ? [T('World news:      news  (active world events + their progress)')] : []),
    ...(hasBestiary ? [T('Bounties:        bounties · bounty post <entity> <gold> · bounty claim <id> · bounty cancel <id>')] : []),
    ...(hasMarketplace ? [
      T('Market:          sell <item>          (direct sale, instant gold)'),
      T('                 sell <qty> <item>    (batch sell at base value)'),
      T('                 sell <item> <price>  (list on player marketplace)'),
      T('                 sell <qty> <item> <price>  (list batch)'),
      T('                 buy <#> · market · listings'),
    ] : []),
    T('Drops:           corpses · loot <#>'),
    T('Channels:        feed <type>  (dm · whisper · combat · events · npcs · rooms · items · all — recent only)'),
    T('Network:         whisper <text>  (broadcast to your room)'),
    T('                 dm <name|npub> <text>  · messages / inbox'),
    T('                 pin <text>  · notices / board (settlement bulletin)'),
    T('                 carve <text>  · carvings / marks (permanent room marks, all visitors see)'),
    T('                 who'),
    T('Cooperation:     give <item> to <name> [message]'),
    T('                 gifts / offers · claim <id> · decline <id>'),
    T('                 heal <name>  (uses one healing salve from your inventory)'),
    T('Identity:        soul (show your nsec) · import <nsec> · new character (fresh start) · restart (this story only)'),
    T('Run history:     endings  (list endings reached) · legacy  (carry-over wallet) · whoami / me  (personal scorecard)'),
    T('                 rename <new_name>  (change your visible name)'),
    T('                 characters  (recently used on this browser; switch with "characters <#>")'),
    T('Worlds:          switch story · stories  (list/switch story files)'),
    T('Relays:          relay list · relay add <wss://...> · relay remove <url> · relay reset'),
    T('Offline:         (no command — events queue automatically when offline, sync on reconnect)'),
    T('Language:        lang  (show)  ·  lang <code>  (switch, e.g. "lang de")'),
    T('Theme:           theme  (show)  ·  theme <dark|light|sepia|contrast>'),
    T('Font size:       fontsize  (show)  ·  fontsize <small|medium|large>'),
    T('Tutorial:        tutorial  (beginner\'s guide)  ·  tutorial topics / topic <name>  (replay one)  ·  tutorial off  (silence hints)'),
    T('Feedback:        bug / report  (open a bug-report dialog)'),
    T('Updates:         reload story  (fetch the latest version of the active story without losing progress)'),
    T('                 reload engine  (fetch the latest engine build — page reload, your character is safe)'),
    T('Misc:            clear · help · help <topic>  (filter by keyword, e.g. "help combat" / "help market")')
  ];
  let filtered = lines;
  let header = '=== Help ===';
  if (filterQ) {
    filtered = lines.filter(l => l.toLowerCase().includes(filterQ));
    header = `=== Help · matching "${filterQ}" (${filtered.length}/${lines.length} lines) ===`;
    if (filtered.length === 0) {
      write(`No help lines match "${filterQ}". Type "help" for the full list.`, 'error');
      return;
    }
  }
  writeBlock(header, () => {
    for (const l of filtered) write(l, 'system');
  }, '── end of help ──');
}

function handleCommand(input) {
  const raw = input.trim();
  if (!raw) return;
  write('> ' + escapeHtml(raw), 'echo');
  if (!player.activated) {
    player.activated = true;
    try { recordRecentChar(); } catch {}
  }
  if (player.dialog_session) {
    const lower = raw.toLowerCase();
    if (/^\d+$/.test(raw)) { chooseDialog(raw); return; }
    if (lower === 'leave' || lower === 'bye' || lower === 'goodbye') { leaveDialog(); return; }
    if (lower === 'choose' || lower.startsWith('choose ')) { chooseDialog(raw.replace(/^choose\s*/i, '')); return; }
    write('You are mid-conversation. Pick a number, or type "leave".', 'error');
    return;
  }
  const parts = raw.split(/\s+/);
  let cmd = parts[0].toLowerCase();
  let argRaw = parts.slice(1).join(' ');
  let arg = argRaw.toLowerCase();
  if (DIR_INPUT_ALIASES[cmd]) cmd = DIR_INPUT_ALIASES[cmd];
  if (COMMAND_ALIASES[cmd]) cmd = COMMAND_ALIASES[cmd];
  if (endingBlock(cmd)) return;
  const dirAlias = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down',
                     ...DIR_INPUT_ALIASES };

  if (dynamicVerbs.has(cmd) && dynamicVerbs.get(cmd) === 'gather') {
    gather(cmd, arg); tickTurn(); return;
  }

  let consumesTurn = true;
  switch (cmd) {
    case 'look': case 'l':
      if (arg && (dirAlias[arg] || arg)) {
        const d = dirAlias[arg] || arg;
        const VALID = ['north','south','east','west','up','down','in','out'];
        if (VALID.includes(d)) { lookDir(d); consumesTurn = false; break; }
      }
      describeRoom(); consumesTurn = false; break;
    case 'go': case 'move':      move(dirAlias[arg] || arg); break;
    case 'n': case 'north':      move('north'); break;
    case 's': case 'south':      move('south'); break;
    case 'e': case 'east':       move('east'); break;
    case 'w': case 'west':       move('west'); break;
    case 'u': case 'up':         move('up'); break;
    case 'd': case 'down':       move('down'); break;
    case 'in':                   move('in'); break;
    case 'out':                  move('out'); break;
    case 'take': case 'get':     take(arg); break;
    case 'drop':                 drop(arg); break;
    case 'bury':                 bury(argRaw); break;
    case 'inv': case 'inventory': case 'i': showInventory(argRaw); consumesTurn = false; break;
    case 'status':               showStatus(); consumesTurn = false; break;
    case 'skills': case 'sk':    showSkills(); consumesTurn = false; break;
    case 'skilltree': case 'tree': case 'st':  showSkillTree(); consumesTurn = false; break;
    case 'theme':                themeCommand(arg); consumesTurn = false; break;
    case 'fontsize': case 'font': fontsizeCommand(arg); consumesTurn = false; break;
    case 'learn':                learn(arg); break;
    case 'recipes': case 'rec':  showRecipes(argRaw); consumesTurn = false; break;
    case 'craft':                craft(arg); break;
    case 'market': case 'mkt':   showMarket(argRaw); consumesTurn = false; break;
    case 'sell':                 sell(argRaw); break;
    case 'buy':                  buy(arg); break;
    case 'listings':             showListings(); consumesTurn = false; break;
    case 'talk':                 talk(arg); break;
    case 'answer': case 'say':   answer(argRaw); break;
    case 'hunt':                 hunt(); break;
    case 'attack':               attack(); break;
    case 'fight':                fightToTheDeath(); consumesTurn = false; break;
    case 'flee':                 flee(); break;
    case 'parry':                parry(); break;
    case 'charge':               charge(); break;
    case 'retreat':              retreat(); break;
    case 'transform':            transformCommand(argRaw); break;
    case 'revert':               revertCommand(); break;
    case 'bounty':               bountyCommand(argRaw); consumesTurn = false; break;
    case 'bounties':             showBounties(); consumesTurn = false; break;
    case 'bestiary':             showBestiary(); consumesTurn = false; break;
    case 'news': case 'worldevents': showNews(); consumesTurn = false; break;
    case 'assist': case 'help_attack': assist(argRaw); break;
    case 'eat':                  eat(arg); break;
    case 'drink':                drink(arg); break;
    case 'wear': case 'equip': case 'wield':   wear(arg); break;
    case 'unwear': case 'remove': case 'unequip': unwear(arg); break;
    case 'equipment': case 'eq': showEquipment(); consumesTurn = false; break;
    case 'sharpen':              sharpen(arg); break;
    case 'repair':               repair(arg); break;
    case 'bug': case 'report':   showBugReporter(); consumesTurn = false; break;
    case 'read':                 readItem(arg); break;
    case 'examine': case 'inspect': case 'x':  examineItem(arg); consumesTurn = false; break;
    case 'reload': case 'update':
      if (arg === 'story') { reloadStory(); consumesTurn = false; }
      else if (arg === 'engine') { reloadEngine(); consumesTurn = false; }
      else if (arg === '' || arg === undefined) {
        try { checkForEngineUpdate({ silentIfSame: true }); } catch {}
        reloadStory();
        consumesTurn = false;
      } else {
        write(`Reload what? Try "reload story" or "reload engine".`, 'error');
      }
      break;
    case 'tame':                 tameAttempt(); break;
    case 'feed':
      if (arg && (arg in FEED_CHANNELS)) { showFeed(argRaw); consumesTurn = false; }
      else { feedCompanion(); }
      break;
    case 'companion': case 'pet':showCompanion(); consumesTurn = false; break;
    case 'dismiss':              dismissCompanion(); break;
    case 'stats':                showStats(); consumesTurn = false; break;
    case 'achievements': case 'ach': showAchievements(); consumesTurn = false; break;
    case 'quests': case 'q':     showQuests(); consumesTurn = false; break;
    case 'accept':               acceptQuest(arg); break;
    case 'turn':
      if (parts[1] === 'in' && parts[2]) turnInQuest(parts[2].toLowerCase());
      else if (arg) turnInQuest(arg);
      else write('Usage: turn in <quest_id>', 'error');
      break;
    case 'turnin':               turnInQuest(arg); break;
    case 'complete':             completeQuestCommand(arg); break;
    case 'finish':               completeQuestCommand(arg); break;
    case 'light':                if (arg === 'fire' || arg === '') lightFire(); else write(`Light what?`, 'error'); break;
    case 'rest':                 rest(); break;
    case 'sleep':                sleep(); break;
    case 'soul':                 showSoul(); consumesTurn = false; break;
    case 'import':               importSoul(argRaw); consumesTurn = false; break;
    case 'characters': case 'chars': charactersCommand(argRaw); consumesTurn = false; break;
    case 'backup':               backupCharacterCommand(argRaw); consumesTurn = false; break;
    case 'restore':              restoreCharacterCommand(argRaw); consumesTurn = false; break;
    case 'share':                shareCharacterCommand(argRaw); consumesTurn = false; break;
    case 'profile':              showProfile(); consumesTurn = false; break;
    case 'whoami': case 'me':    showWhoAmI(); consumesTurn = false; break;
    case 'signature': case 'sig':
      (async () => {
        const r = await verifyStorySignature(STORY);
        if (!STORY.signature) write('This story is unsigned.', 'system');
        else if (r.ok) {
          write(`Story signed by ${r.npub} ✓ (signature verified)`, 'success');
          try { write(`  full npub: ${nip19.npubEncode(r.pubkey)}`, 'system'); } catch {}
          if (r.signed_at) write(`  signed at: ${new Date(r.signed_at * 1000).toISOString()}`, 'system');
        } else {
          write(`⚠ Signature ${r.reason}`, 'error');
        }
      })();
      consumesTurn = false; break;
    case 'new':                  if (arg === 'character' || arg === '') newCharacter(); else write('Did you mean "new character"?', 'error'); consumesTurn = false; break;
    case 'reset':                newCharacter(); consumesTurn = false; break;
    case 'rename':               renameCharacter(argRaw); consumesTurn = false; break;
    case 'switch':               if (arg === 'story' || arg === '') switchStoryCommand(); else write('Did you mean "switch story"?', 'error'); consumesTurn = false; break;
    case 'relay': case 'relays': relayCommand(argRaw); consumesTurn = false; break;
    case 'lang': case 'language': langCommand(argRaw); consumesTurn = false; break;
    case 'stories':              listStoriesCommand(); consumesTurn = false; break;
    case 'place':                if (arg === 'chest') placeChest(); else write('Place what? Try "place chest".', 'error'); break;
    case 'chest':                showChest(); consumesTurn = false; break;
    case 'store':                storeItem(argRaw); break;
    case 'retrieve': case 'unstore': retrieveItem(argRaw); break;
    case 'corpses':              showCorpses(); consumesTurn = false; break;
    case 'loot':                 loot(arg); break;
    case 'whisper': case 'shout':whisper(argRaw); break;
    case 'dm': case 'tell':      dmCommand(argRaw); break;
    case 'messages': case 'inbox': case 'msg': showInbox(); consumesTurn = false; break;
    case 'pin':                  pinNotice(argRaw); break;
    case 'notices': case 'board':showNotices(); consumesTurn = false; break;
    case 'carve':                carveCommand(argRaw); break;
    case 'carvings': case 'marks': showCarvings(); consumesTurn = false; break;
    case 'give':                 giveCommand(argRaw); break;
    case 'claim':                claimGift(arg); break;
    case 'decline':              declineGift(arg); break;
    case 'gifts': case 'offers': showGifts(); consumesTurn = false; break;
    case 'heal':                 healCommand(arg); break;
    case 'who':                  who(); consumesTurn = false; break;
    case 'map': case 'm':        writeBlock('=== Map ===', () => {
      showMap();
      write('');
      write('Legend:  *=you · 📦=chest · ⚠=wolves · 🔥=fire · ↑↓=stairs (up/down) · ┊=in/out · ╎=through wall', 'echo');
      write('(Type "mapview" / "bigmap" for a fullscreen, zoomable map.)', 'echo');
    }, '── end of map ──'); consumesTurn = false; break;
    case 'mapview': case 'bigmap': case 'mv': showMapModal(); consumesTurn = false; break;
    case 'whatsnew': case 'changelog': showWhatsNewCommand(); consumesTurn = false; break;
    case 'forgetage': case 'resetage': forgetAgeAcksCommand(); consumesTurn = false; break;
    case 'recap': case 'last':   showRecap(); consumesTurn = false; break;
    case 'endings':              showEndings(); consumesTurn = false; break;
    case 'restart':              restartCommand(); consumesTurn = false; break;
    case 'legacy':               showLegacy(); consumesTurn = false; break;
    case 'help': case '?':       help(argRaw); consumesTurn = false; break;
    case 'tutorial': case 'guide': tutorialCommand(argRaw); consumesTurn = false; break;
    case 'clear':                out.innerHTML = ''; consumesTurn = false; break;
    default:
      if (STORY.skills[cmd]) {
        const sk = STORY.skills[cmd];
        const isActive = sk.unlocks?.verbs?.length || sk.unlocks?.recipes?.length;
        if (player.skills.has(cmd)) {
          write(`${sk.display}: known. ${isActive ? 'Active — see "skills" / "recipes".' : 'Passive — effects apply automatically.'}`, 'system');
        } else {
          write(`${sk.display} is a skill. Use "learn ${cmd}" (${sk.spark_cost} sparks).`, 'system');
        }
      } else {
        const suggestions = fuzzyCommandSuggestions(cmd);
        if (!player.tutorial_done) {
          write(`Unknown command: "${cmd}". Type "help" for the full list, or "tutorial" for a beginner's guide.`, 'error');
        } else {
          write(`Unknown command: "${cmd}". Type "help".`, 'error');
        }
        if (suggestions.length) {
          write(`Did you mean: ${suggestions.join(', ')}?`, 'system');
        }
      }
      consumesTurn = false;
  }
  if (consumesTurn) tickTurn();
  maybeAdvanceTutorial(cmd);
  checkAchievements();
  refreshSidebar();
  saveLocal();
  maybePublishState();
}

const drawer = document.getElementById('side');
const backdrop = document.getElementById('drawer-backdrop');
function openDrawer() { drawer.classList.add('open'); backdrop.classList.add('show'); }
function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('show'); }
document.getElementById('drawer-toggle').addEventListener('click', openDrawer);
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) {
    e.preventDefault();
    closeDrawer();
  }
});

const cmdInput = document.getElementById('cmd');

const HIST_KEY = `nstadv:${STORY?.meta?.id || 'default'}:hist`;
const HIST_MAX = 100;
let cmdHistory = [];
try { cmdHistory = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); if (!Array.isArray(cmdHistory)) cmdHistory = []; } catch { cmdHistory = []; }
let histIdx = cmdHistory.length;
let histDraft = '';
function pushHistory(s) {
  if (!s || !s.trim()) return;
  if (cmdHistory.length && cmdHistory[cmdHistory.length - 1] === s) {
    histIdx = cmdHistory.length;
    return;
  }
  cmdHistory.push(s);
  if (cmdHistory.length > HIST_MAX) cmdHistory = cmdHistory.slice(-HIST_MAX);
  histIdx = cmdHistory.length;
  try { localStorage.setItem(HIST_KEY, JSON.stringify(cmdHistory)); } catch {}
}

const STATIC_VERBS = [
  'look','take','drop','bury','inv','status','talk','answer','read','examine','inspect',
  'skills','learn','recipes','craft','eat','drink','rest','sleep','hunt','attack','flee',
  'parry','charge','retreat','transform','revert','assist','wear','wield','unwear','equipment','eq',
  'sharpen','repair','tame','feed','companion','pet','dismiss','quests','q','stats','achievements',
  'accept','place','chest','store','retrieve','bestiary','news','bounties','bounty','sell','buy','market','listings',
  'corpses','loot','whisper','dm','messages','inbox','pin','notices','board','carve','carvings','marks',
  'who','give','gifts','offers','claim','decline','heal','soul','import','rename','characters',
  'switch','stories','relay','lang','tutorial','bug','report','reload','clear','help','map',
  'go','n','s','e','w','u','d','in','out','north','south','east','west','up','down',
  'donate','support','recap','last','complete','finish','feed','endings','restart','legacy','whoami','me','skilltree','tree','st','theme','fontsize','font'
];
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  if (m > 30 || n > 30) return Math.max(m, n);
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = cur;
  }
  return prev[n];
}
function fuzzyCommandSuggestions(typed) {
  if (!typed) return [];
  const lc = typed.toLowerCase();
  const scored = STATIC_VERBS.map(v => ({ v, d: levenshtein(lc, v) }));
  scored.sort((a, b) => a.d - b.d || a.v.length - b.v.length);
  const out = [];
  for (const s of scored) {
    if (s.d > 2) break;
    if (s.v === lc) continue;
    out.push(s.v);
    if (out.length >= 3) break;
  }
  return out;
}
function completionCandidates(prefix, tokenIdx) {
  const cands = new Set();
  const lc = prefix.toLowerCase();
  if (tokenIdx === 0) {
    for (const v of STATIC_VERBS) if (v.startsWith(lc)) cands.add(v);
    return [...cands].sort();
  }
  const room = (player?.rooms?.[player.location]) || STORY.rooms?.[player.location];
  for (const id of (player?.inventory || [])) cands.add(id);
  for (const [k, n] of Object.entries(player?.materials || {})) if (n > 0) cands.add(k);
  for (const id of (room?.items || [])) cands.add(id);
  for (const id of (room?.npcs || [])) cands.add(id);
  for (const dir of Object.keys(room?.exits || {})) cands.add(dir);
  cands.add('north'); cands.add('south'); cands.add('east'); cands.add('west'); cands.add('up'); cands.add('down');
  for (const id of Object.keys(STORY.skills || {})) cands.add(id);
  for (const id of Object.keys(STORY.recipes || {})) cands.add(id);
  return [...cands].filter(c => c.toLowerCase().startsWith(lc)).sort();
}
let tabState = { prefix: null, list: [], idx: 0 };

const completionHint = document.getElementById('completion-hint');
function refreshCompletionHint() {
  if (!completionHint) return;
  const raw = cmdInput.value;
  if (!raw) { completionHint.style.display = 'none'; return; }
  const lastSpace = raw.lastIndexOf(' ');
  const head = raw.slice(0, lastSpace + 1);
  const tail = raw.slice(lastSpace + 1);
  if (!tail) { completionHint.style.display = 'none'; return; }
  const tokenIdx = head.trim().split(/\s+/).filter(Boolean).length;
  const list = completionCandidates(tail, tokenIdx);
  if (list.length === 0) { completionHint.style.display = 'none'; return; }
  if (list.length === 1) {
    completionHint.textContent = `Tab → ${list[0]}`;
  } else if (list.length <= 5) {
    completionHint.textContent = `Tab → ${list.join(' · ')}`;
  } else {
    completionHint.textContent = `Tab → ${list.slice(0, 4).join(' · ')} … (${list.length} matches)`;
  }
  completionHint.style.display = 'block';
}
cmdInput.addEventListener('input', refreshCompletionHint);
cmdInput.addEventListener('blur', () => { if (completionHint) completionHint.style.display = 'none'; });
cmdInput.addEventListener('focus', refreshCompletionHint);
cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = cmdInput.value;
    cmdInput.value = '';
    pushHistory(v);
    histDraft = '';
    tabState.prefix = null;
    if (completionHint) completionHint.style.display = 'none';
    handleCommand(v);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    tabState.prefix = null;
    if (cmdHistory.length === 0) return;
    if (histIdx === cmdHistory.length) histDraft = cmdInput.value;
    histIdx = Math.max(0, histIdx - 1);
    cmdInput.value = cmdHistory[histIdx] || '';
    requestAnimationFrame(() => { try { cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length); } catch {} });
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    tabState.prefix = null;
    if (cmdHistory.length === 0) return;
    histIdx = Math.min(cmdHistory.length, histIdx + 1);
    cmdInput.value = (histIdx === cmdHistory.length) ? histDraft : cmdHistory[histIdx];
    requestAnimationFrame(() => { try { cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length); } catch {} });
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const raw = cmdInput.value;
    const lastSpace = raw.lastIndexOf(' ');
    const head = raw.slice(0, lastSpace + 1);
    const tail = raw.slice(lastSpace + 1);
    const tokenIdx = head.trim().split(/\s+/).filter(Boolean).length;
    if (tabState.prefix === tail && tabState.list.length > 0) {
      tabState.idx = (tabState.idx + 1) % tabState.list.length;
    } else {
      const list = completionCandidates(tail, tokenIdx);
      if (list.length === 0) return;
      tabState.prefix = tail;
      tabState.list = list;
      tabState.idx = 0;
    }
    cmdInput.value = head + tabState.list[tabState.idx];
    requestAnimationFrame(() => { try { cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length); } catch {} });
    refreshCompletionHint();
    return;
  }
  tabState.prefix = null;
});

write(`=== Taleforge — ${t(STORY.meta.title)} — ${ENGINE_VERSION_LABEL} ===`, 'title');
try { document.title = `Taleforge — ${t(STORY.meta.title)} — ${ENGINE_VERSION_LABEL}`; } catch {}
write(`awb_<svg viewBox="0 0 32 32" width="11" height="11" style="vertical-align:-1px;display:inline-block;border-radius:1px;"><rect width="32" height="32" fill="#d8232a"/><rect x="13" y="6" width="6" height="20" fill="#fff"/><rect x="6" y="13" width="20" height="6" fill="#fff"/></svg> · 2026`, 'system');
write('');

setTimeout(() => { try { checkForStoryUpdate({ silentIfSame: true }); } catch {} }, 8000);
setInterval(() => { try { checkForStoryUpdate({ silentIfSame: true }); } catch {} }, 10 * 60 * 1000);
setTimeout(() => { try { checkForEngineUpdate({ silentIfSame: true }); } catch {} }, 8000);
setInterval(() => { try { checkForEngineUpdate({ silentIfSame: true }); } catch {} }, 10 * 60 * 1000);
// Tier D18: post-reload "what's new" digest.
try { showWhatsNewIfUpdated(); } catch {}
let __lastVisCheck = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (now - __lastVisCheck < 60_000) return;
  __lastVisCheck = now;
  try { checkForStoryUpdate({ silentIfSame: true }); } catch {}
  try { checkForEngineUpdate({ silentIfSame: true }); } catch {}
});

if (isNewCharacter) {
  player.created_at = Math.floor(Date.now() / 1000);
  write('=== WELCOME, TRAVELER ===', 'title');
  write('This is a shared, persistent world. Other players may pass through your room.', 'system');
  write('Your character lives on a Nostr key. Below is your "soul" — write it down.', 'system');
  write('');
  write(`  ${nsec}`, 'spark');
  write('');
  write('With this nsec you can return to this character on any device, anywhere.', 'system');
  write('Without it, this character is lost forever. Type "soul" any time to see it again.', 'error');
  write('');
  write('New here? Type "tutorial" for a beginner\'s guide, or just try "look" to begin.', 'spark');
  write('');
} else {
  write(`Welcome back. Type "soul" to see your nsec, "import <nsec>" to switch characters.`, 'system');
}

try {
  const saved = localStorage.getItem(STORAGE_STATE);
  if (saved) {
    applyState(JSON.parse(saved));
    migrateNewRoomContent();
    write('[restored from local storage]', 'system');
  }
} catch {}

try {
  const ENGINE_LAST_SEEN_KEY = 'taleforge:engine_last_seen';
  const lastSeen = localStorage.getItem(ENGINE_LAST_SEEN_KEY);
  if (lastSeen && lastSeen !== ENGINE_VERSION_LABEL) {
    write('');
    write(`>>> Engine upgraded: ${lastSeen} → ${ENGINE_VERSION_LABEL}.`, 'spark');
    write(`    See https://github.com/awb-ch/taleforge for the changelog, or the in-game banner above for the running version.`, 'system');
    showToast(`Welcome to ${ENGINE_VERSION_LABEL}.`, 'engine', { tag: 'engine upgrade', subtitle: `From ${lastSeen}.` });
  }
  localStorage.setItem(ENGINE_LAST_SEEN_KEY, ENGINE_VERSION_LABEL);
} catch {}

try {
  const ach = (player.achievements && typeof player.achievements.size === 'number') ? player.achievements.size : 0;
  const endings = (player.endings_reached && typeof player.endings_reached.size === 'number') ? player.endings_reached.size : 0;
  const legacyG = player.legacy_gold || 0;
  const legacyS = player.legacy_sparks || 0;
  const lastDate = player.last_login_date;
  const daysAway = lastDate ? daysBetweenISO(lastDate, todayISO()) : 0;
  const isRusty = !isNewCharacter && daysAway >= 30;
  const isVeteran = !isNewCharacter && (ach >= 5 || endings >= 1 || (player.login_streak || 0) >= 14);
  if (isRusty) {
    write('');
    write(`>>> You've been away ${daysAway} days. Welcome back.`, 'spark');
    if (ach > 0 || endings > 0) {
      const bits = [];
      if (endings > 0) bits.push(`${endings} ending${endings === 1 ? '' : 's'}`);
      if (ach > 0) bits.push(`${ach} achievement${ach === 1 ? '' : 's'}`);
      write(`    Your record stands: ${bits.join(' · ')}.`, 'system');
    }
    write(`    Type "tutorial" for a refresher on commands, or "whoami" to see where you left off.`, 'system');
  } else if (isVeteran && (ach > 0 || endings > 0 || legacyG > 0 || legacyS > 0)) {
    const bits = [];
    if (endings > 0) bits.push(`${endings} ending${endings === 1 ? '' : 's'} reached`);
    if (ach > 0) bits.push(`${ach} achievement${ach === 1 ? '' : 's'}`);
    if (legacyG > 0 || legacyS > 0) bits.push(`legacy ${legacyG}g/${legacyS}s carried over`);
    write(`Your record: ${bits.join(' · ')}.`, 'spark');
  } else if (!isNewCharacter && (ach > 0 || endings > 0 || legacyG > 0 || legacyS > 0)) {
    const bits = [];
    if (endings > 0) bits.push(`${endings} ending${endings === 1 ? '' : 's'} reached`);
    if (ach > 0) bits.push(`${ach} achievement${ach === 1 ? '' : 's'}`);
    if (legacyG > 0 || legacyS > 0) bits.push(`legacy ${legacyG}g/${legacyS}s carried over`);
    write(`Your record: ${bits.join(' · ')}.`, 'spark');
  }
} catch {}
resolveStoryProse();
applyDomI18n();

if (!player.name) askName();
if (!player.profile_id && STORY.meta?.character_profiles && Object.keys(STORY.meta.character_profiles).length > 0) {
  askProfile();
}

{
  const before = player.login_streak;
  const lastDate = player.last_login_date;
  const r = rollLoginStreak();
  if (r.firstToday) {
    if (player.total_logins === 1) {
      write(`Welcome, ${player.name}.`, 'system');
    } else if (lastDate && daysBetweenISO(lastDate, todayISO()) === 1) {
      write(`Day ${player.login_streak} on the streak. Welcome back, ${player.name}.`, 'spark');
      const newTitle = streakTitle(player.login_streak);
      const oldTitle = streakTitle(before);
      if (newTitle && newTitle !== oldTitle)
        write(`>>> You earn the title "${newTitle}".`, 'success');
    } else {
      write(`The chain breaks. A new streak begins. Welcome back, ${player.name}.`, 'system');
    }
  }
}

const __ttl = playerTitle();
write(`You are ${player.name}${__ttl ? ' ' + __ttl : ''}.`, 'system');

if (!player.weather) {
  rollDailyWeather();
  player.weather_day = dayPart().day;
}
advanceDailyQuest(dayPart().day);

write(`Identity: ${npubShort}`, 'system');
if (STORY.signature) {
  if (__storyVerification) {
    if (__storyVerification.ok) write(`Story: signed by ${__storyVerification.npub} ✓`, 'success');
    else write(`Story: ⚠ signature ${__storyVerification.reason}`, 'error');
  } else {
    write('Story: signature present, verifying…', 'system');
    verifyStorySignature(STORY).then(r => {
      __storyVerification = r;
      if (r.ok) write(`Story: signed by ${r.npub} ✓`, 'success');
      else write(`Story: ⚠ signature ${r.reason}`, 'error');
    });
  }
}
write(`${Object.keys(STORY.rooms).length} rooms · ${Object.keys(STORY.skills).length} skills · ${Object.keys(STORY.recipes).length} recipes · ${Object.keys(STORY.entities).length} entities`, 'system');
write(`Connecting to ${RELAYS.length} Nostr relays…`, 'system');
write('');
write('Carry capacity 40 weight. Crafting awards sparks. Place chests for storage. Sleep to recover life.', 'system');
write('On phone? Tap ☰ at top right for the side panel.', 'system');
if (isNewCharacter || !player.tutorial_done) {
  write('Type "tutorial" for the beginner\'s guide, "help" for the full command list, "quests" for your active goals.', 'system');
} else {
  write('Type "help" for commands, "quests" to see your active goals.', 'system');
}
write('');

if (player.quests.intro && player.quests.intro.state === 'active' && !player.quests.intro.announced_intro) {
  player.quests.intro.announced_intro = true;
  const q = STORY.quests.intro;
  write(`>>> First quest: ${q.title}`, 'spark');
  write(`    ${q.description}`);
  write(`    (Type "quests" any time to see progress.)`, 'system');
  write('');
}

if (player.activated) { try { recordRecentChar(); } catch {} }

setBootStatus('Connecting to relays…');
try { applyTimeOfDayTint(dayPart().period); } catch {}
describeRoom();
refreshSidebar();
subscribe();

(function setupNsecDropImport() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,30,0.85);color:var(--accent);display:none;align-items:center;justify-content:center;z-index:9999;font-size:18px;font-weight:600;border:3px dashed var(--accent);pointer-events:none;text-align:center;padding:20px;';
  overlay.textContent = '📂 Drop a text file containing your nsec to import';
  document.body.appendChild(overlay);
  let dragDepth = 0;
  function isFileDrag(e) {
    return e.dataTransfer && [...(e.dataTransfer.types || [])].some(t => t === 'Files' || t === 'application/x-moz-file');
  }
  document.addEventListener('dragenter', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.style.display = 'flex';
  });
  document.addEventListener('dragleave', e => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.style.display = 'none';
  });
  document.addEventListener('dragover', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', async e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.style.display = 'none';
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.size > 10000) {
      write('That file is too large to be an nsec — drop a small text file.', 'error');
      return;
    }
    try {
      const text = (await file.text()).trim();
      const match = text.match(/nsec1[a-z0-9]{50,80}/i);
      if (!match) {
        write('No nsec1... string found in that file.', 'error');
        return;
      }
      const ok = confirm(`Import this character?\n\nFound nsec: ${match[0].slice(0, 16)}…${match[0].slice(-8)}\n\nThis replaces your current character on this browser. Save your current "soul" first if you want to come back.`);
      if (!ok) return;
      importSoul(match[0]);
    } catch (err) {
      write('Could not read that file: ' + err.message, 'error');
    }
  });
})();
publishAction('look', { location: player.location });

if (!player.activated) {
  setTimeout(() => {
    if (player.activated) return;
    write('');
    write('[idle] Still there? Type any command (try "look" or "tutorial") to keep this character.', 'error');
    write('[idle] If no command in the next ~3 minutes, this character will be retired.', 'system');
  }, INACTIVE_WARN_MS);
  setTimeout(() => {
    if (player.activated) return;
    try {
      const keysToKill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`nstadv:${STORY.meta.id}:`)) keysToKill.push(k);
      }
      for (const k of keysToKill) localStorage.removeItem(k);
    } catch {}
    write('');
    write('[idle] No activity for 10 minutes — retiring this character. Reloading…', 'error');
    setTimeout(() => location.reload(), 1500);
  }, INACTIVE_LIMIT_MS);
}

// Tier C9: opportunistic cross-device endings sync. Runs in parallel to
// state restore — both are tied to the player's nsec, so if they imported
// their key on a fresh browser, we backfill any endings they reached
// elsewhere into the local GLOBAL_ENDINGS table (which the picker reads).
setTimeout(() => { try { fetchAndMergeProgression(); } catch {} }, 2500);

fetchAndRestoreState().then(remoteState => {
  if (remoteState && (remoteState.turn ?? 0) > player.turn) {
    applyState(remoteState);
    migrateNewRoomContent();
    refreshSidebar();
    write('');
    write(`[synced] character state restored from relays (turn ${remoteState.turn}).`, 'system');
    describeRoom();
    saveLocal();
  }
});

setTimeout(() => {
  if (relayUp) return;
  const ua = navigator.userAgent || '';
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS/.test(ua);
  const isFile = location.protocol === 'file:';
  if (isFile) return;
  write('');
  write(`[network] Relays haven't connected after 12 seconds.`, 'system');
  if (isSafari) {
    write('On Safari this usually means Cross-Site Tracking Prevention is blocking the WebSocket handshake.', 'system');
    write('  Fix 1: Safari → Settings → Privacy → uncheck "Prevent cross-site tracking", then reload.', 'system');
    write('  Fix 2: Add a relay you can reach with "relay add wss://your-relay.example", then reload.', 'system');
  } else {
    write('Check your network — try "relay list" and "relay add <wss://...>" to use a different relay.', 'system');
  }
}, 12000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.addEventListener('online', () => {
  refreshRelayLabel();
  try { subscribe(); } catch {}
  maybePublishState(true);
  drainOutbox();
});
window.addEventListener('offline', () => {
  markRelayDown();
  const queued = loadOutbox().length;
  write(`[offline — your actions will queue and sync when network returns${queued ? ` (${queued} already queued)` : ''}]`, 'system');
});

refreshRelayLabel();
setTimeout(() => { if (loadOutbox().length) drainOutbox(true); }, 5000);
