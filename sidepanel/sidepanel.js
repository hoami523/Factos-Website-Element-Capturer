const $ = (sel) => document.querySelector(sel);

let tabId = null;
let state = { elements: [], picking: false };
let blocked = false;
let autoClear = false;
let autoFocus = false;
let exportFormat = 'text';
let noticeTimer = 0;

const BLOCKED_PREFIXES = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'devtools://'];

const EXPORT_FORMATS = {
  text: { label: '简洁文本', ext: 'txt', mime: 'text/plain' },
  simple: { label: '简洁 JSON', ext: 'json', mime: 'application/json' },
  full: { label: '完整 JSON', ext: 'json', mime: 'application/json' }
};

const STABLE_KIND_LABEL = {
  'name-prefix': 'name前缀',
  'name': 'name',
  'id': 'id',
  'src-path': 'src路径',
  'src-service': 'src参数',
  'unchanged': '原定位器'
};

const EMPTY_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="3.4"></circle>' +
  '<path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6"></path>' +
  '<path d="M8.9 8.9 5.4 5.4M15.1 8.9l3.5-3.5M8.9 15.1l-3.5 3.5M15.1 15.1l3.5 3.5" opacity=".55"></path>' +
  '</svg>';

const TARGET_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="6"></circle>' +
  '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle>' +
  '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"></path>' +
  '</svg>';

const TRASH_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 6h18"></path>' +
  '<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>' +
  '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
  '<path d="M10 11v6M14 11v6"></path>' +
  '</svg>';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

async function queryState() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE', tabId });
    if (resp) state = resp;
  } catch (e) {}
  render();
}

async function updateActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0] && tabs[0].id;
    const url = tabs[0] && tabs[0].url;
    blocked = false;
    hideNotice();
    if (url && BLOCKED_PREFIXES.some((p) => url.startsWith(p))) {
      blocked = true;
      showNotice('当前是浏览器内部页面（chrome:// 等），无法注入捕捉脚本。请切换到普通网页。', 'error');
    } else if (url && url.startsWith('file://')) {
      const allowed = await isFileSchemeAccessAllowed();
      if (!allowed) {
        showNotice('file:// 页面需要先在扩展详情里开启「允许访问文件网址」，开启后刷新页面即可自动恢复。', 'warn');
      }
    }
  } catch (e) {}
  await queryState();
}

function showNotice(text, kind) {
  const n = $('#notice');
  n.className = 'notice ' + (kind || 'warn');
  n.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  const close = document.createElement('button');
  close.className = 'notice-close';
  close.textContent = '×';
  close.title = '关闭提示';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    hideNotice();
  });
  n.append(span, close);
  if (kind === 'ok') {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => hideNotice(), 4000);
  }
}

function hideNotice() {
  $('#notice').className = 'notice hidden';
}

function isFileSchemeAccessAllowed() {
  return new Promise((resolve) => {
    try {
      chrome.extension.isAllowedFileSchemeAccess((allowed) => resolve(!!allowed));
    } catch (e) {
      resolve(false);
    }
  });
}

function render() {
  const picking = state.picking && !blocked;
  const pickBtn = $('#pickBtn');
  pickBtn.disabled = blocked;
  pickBtn.classList.toggle('on', picking);
  $('#pickLabel').textContent = picking ? '停止拾取' : '开始拾取';
  $('#statusLine').dataset.mode = picking ? 'pick' : 'idle';
  $('#statusText').textContent = picking
    ? '拾取中 · Alt+点击捕捉，普通点击放行，B 切换浏览'
    : '空闲 · Alt+点击捕捉元素';
  $('#count').textContent = String((state.elements || []).length);

  const list = $('#list');
  list.innerHTML = '';
  if (!state.elements || !state.elements.length) {
    const empty = el('div', 'empty');
    const icon = el('div', 'empty-icon');
    icon.innerHTML = EMPTY_ICON;
    empty.append(
      icon,
      el('div', 'empty-title', '还没有捕捉到元素'),
      el('div', 'empty-sub', '在页面上 Alt+点击 即可捕捉')
    );
    list.appendChild(empty);
    return;
  }
  state.elements.forEach((item, i) => list.appendChild(card(item, i)));
}

function card(item, i) {
  const div = el('div', 'card');
  div.style.animationDelay = Math.min(i * 35, 280) + 'ms';

  const head = el('div', 'card-head');
  const name = el('input', 'name');
  name.value = item.name || '';
  name.placeholder = '元素名（脚本调用用）';
  name.title = '输入后回车或失焦保存';
  name.addEventListener('change', () => {
    name.value = name.value.trim();
    update(item.id, { name: name.value });
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur();
  });
  const tag = el('span', 'badge tag', '<' + ((item.element && item.element.tag) || '?') + '>');
  head.append(name, tag);

  const badges = el('div', 'badges');
  const frameTxt = item.frame_path_unknown
    ? '⚠ iframe 未解析'
    : item.frame_path && item.frame_path.length
      ? 'iframe × ' + item.frame_path.length
      : '顶层';
  badges.appendChild(el('span', 'badge', frameTxt));
  const st = item.frame_path && item.frame_path[0] && item.frame_path[0].stable;
  if (st) {
    badges.appendChild(
      el('span', 'badge ' + (st.verified ? 'ok' : 'warn'),
        '稳定 · ' + (STABLE_KIND_LABEL[st.kind] || st.kind) + (st.verified ? '' : ' ⚠'))
    );
  }
  const v = item.verified || {};
  const verified = !!(v.css && v.xpath);
  badges.appendChild(el('span', 'badge ' + (verified ? 'ok' : 'warn'), verified ? '✓ 双校验' : '部分校验'));

  const locs = el('div', 'locs');
  locs.append(
    locRow('CSS', item.locators && item.locators.css),
    locRow('XPath', item.locators && item.locators.xpath)
  );
  const frameChain = frameChainLines(item, 'css');
  if (frameChain.length) {
    locs.append(locRow('帧链', frameChain.join(' → ')));
  }

  const actions = el('div', 'actions');

  const locateBtn = actBtn('', 'icon-btn');
  locateBtn.title = '在页面上高亮闪烁对应元素';
  locateBtn.innerHTML = TARGET_ICON + '<span>定位</span>';
  locateBtn.addEventListener('click', () => locateElement(item));

  const cssBtn = actBtn('CSS', 'copy');
  cssBtn.title = '复制 CSS 选择器（iframe 内元素会先列各层 iframe 定位器）';
  cssBtn.addEventListener('click', () => copyFeedback(fullLocator(item, 'css'), cssBtn));

  const xpathBtn = actBtn('XPath', 'copy');
  xpathBtn.title = '复制 XPath 表达式（iframe 内元素会先列各层 iframe 定位器）';
  xpathBtn.addEventListener('click', () => copyFeedback(fullLocator(item, 'xpath'), xpathBtn));

  const jsonBtn = actBtn('JSON', 'copy');
  jsonBtn.title = '复制该元素的完整 JSON（含 Playwright / Selenium 等全部信息）';
  jsonBtn.addEventListener('click', () => copyFeedback(JSON.stringify(item, null, 2), jsonBtn));

  const delBtn = actBtn('', 'danger icon-btn');
  delBtn.title = '从元素库删除该元素';
  delBtn.innerHTML = TRASH_ICON + '<span>删除</span>';
  delBtn.addEventListener('click', () => del(item.id));

  actions.append(locateBtn, cssBtn, xpathBtn, jsonBtn, delBtn);

  div.append(head, badges, locs, actions);
  return div;
}

function locRow(label, value) {
  const row = el('div', 'loc');
  const lab = el('span', 'loc-label', label);
  const code = el('code');
  code.textContent = value || '—';
  code.title = value || '';
  row.append(lab, code);
  return row;
}

function actBtn(text, cls) {
  const b = el('button', cls || '');
  b.textContent = text;
  return b;
}

function update(id, patch) {
  // 就地更新本地 state：改名后立即生效，复制/导出 JSON 能马上拿到新值（避免异步竞态）
  const idx = (state.elements || []).findIndex((e) => e.id === id);
  if (idx >= 0) Object.assign(state.elements[idx], patch);
  chrome.runtime.sendMessage({ type: 'UPDATE_ELEMENT', id, patch });
}

function del(id) {
  chrome.runtime.sendMessage({ type: 'DELETE_ELEMENT', id });
  state.elements = state.elements.filter((e) => e.id !== id);
  render();
}

async function copy(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

async function copyFeedback(text, btn) {
  if (!text) return;
  await copy(text);
  const old = btn.textContent;
  btn.textContent = '✓';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = old;
    btn.classList.remove('copied');
  }, 1200);
}

async function locateElement(item) {
  const locators = item.locators || {};
  let resp = null;
  try {
    resp = await chrome.tabs.sendMessage(tabId, {
      type: 'LOCATE',
      framePath: item.frame_path || [],
      css: locators.css,
      xpath: locators.xpath
    }, { frameId: 0 });
  } catch (e) {
    showNotice('无法定位：当前页面没有注入捕捉脚本（chrome:// 或未授权的 file:// 页面）。', 'error');
    return;
  }
  if (resp && resp.found) {
    const idPart = resp.id ? ' #' + resp.id : '';
    showNotice('已定位：<' + resp.tag + '>' + idPart + '，正在页面中闪烁。', 'ok');
  } else {
    showNotice('未找到对应元素：页面可能已变化，或已不在捕捉时的页面。', 'warn');
  }
}

$('#pickBtn').addEventListener('click', async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'TOGGLE_PICK', tabId });
    if (resp && resp.ok) {
      state.picking = resp.picking;
      render();
    } else {
      showNotice(
        '无法启动拾取：页面没有注入捕捉脚本。chrome:// 内部页面不可用；file:// 页面需在扩展详情开启「允许访问文件网址」后刷新页面。',
        'error'
      );
    }
  } catch (e) {
    showNotice('扩展后台异常，请刷新页面后重试。', 'error');
  }
});

function frameSelectors(item) {
  return (item.frame_path || [])
    .map((f) => (f.stable && f.stable.css) || f.css || '')
    .filter(Boolean);
}

function frameChainLines(item, kind) {
  return (item.frame_path || [])
    .map((f) => (f.stable && f.stable[kind]) || f[kind] || '')
    .filter(Boolean);
}

function fullLocator(item, kind) {
  const lines = frameChainLines(item, kind);
  const leaf = (item.locators || {})[kind] || '';
  if (leaf) lines.push(leaf);
  return lines.join('\n');
}

function simpleElement(item) {
  const loc = item.locators || {};
  return {
    name: item.name || '',
    css: loc.css || '',
    xpath: loc.xpath || '',
    frames: frameSelectors(item)
  };
}

function buildExport(items, format) {
  if (format === 'text') {
    return items
      .map((item) => {
        const s = simpleElement(item);
        return [s.name, s.css, s.xpath, s.frames.join(',')].join('\t');
      })
      .join('\n') + (items.length ? '\n' : '');
  }
  if (format === 'simple') {
    return JSON.stringify(items.map(simpleElement), null, 2);
  }
  return JSON.stringify({ schema_version: '1', exported_at: new Date().toISOString(), elements: items }, null, 2);
}

function exportLibrary(clearAfter) {
  const items = state.elements || [];
  if (!items.length) {
    showNotice('元素库为空，无需导出。', 'warn');
    return;
  }
  const fmt = EXPORT_FORMATS[exportFormat] || EXPORT_FORMATS.text;
  const blob = new Blob([buildExport(items, exportFormat)], { type: fmt.mime });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const filename = 'elements_' + stamp + '.' + fmt.ext;
  chrome.downloads.download({ url, filename }, async () => {
    URL.revokeObjectURL(url);
    if (chrome.runtime.lastError) {
      showNotice('导出失败：' + (chrome.runtime.lastError.message || '下载被取消，元素库未清空。'), 'error');
      return;
    }
    if (clearAfter) {
      try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_ELEMENTS' });
      } catch (e) {}
      state.elements = [];
      render();
      showNotice('已导出 ' + filename + '，元素库已自动清空。', 'ok');
    } else {
      showNotice('已导出 ' + filename + '。', 'ok');
    }
  });
}

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get({ autoClearOnExport: false, autoFocusOnCapture: false, exportFormat: 'text' });
    autoClear = !!data.autoClearOnExport;
    const chk = $('#autoClearChk');
    if (chk) chk.checked = autoClear;
    autoFocus = !!data.autoFocusOnCapture;
    const focusChk = $('#autoFocusChk');
    if (focusChk) focusChk.checked = autoFocus;
    exportFormat = EXPORT_FORMATS[data.exportFormat] ? data.exportFormat : 'text';
    const fmt = $('#exportFormat');
    if (fmt) fmt.value = exportFormat;
  } catch (e) {}
}

$('#exportBtn').addEventListener('click', () => exportLibrary(autoClear));

$('#exportFormat').addEventListener('change', async () => {
  exportFormat = $('#exportFormat').value;
  try {
    await chrome.storage.local.set({ exportFormat });
  } catch (e) {}
});

$('#autoClearChk').addEventListener('change', async () => {
  autoClear = $('#autoClearChk').checked;
  try {
    await chrome.storage.local.set({ autoClearOnExport: autoClear });
  } catch (e) {}
});

$('#autoFocusChk').addEventListener('change', async () => {
  autoFocus = $('#autoFocusChk').checked;
  try {
    await chrome.storage.local.set({ autoFocusOnCapture: autoFocus });
  } catch (e) {}
});

$('#clearBtn').addEventListener('click', async () => {
  if (!confirm('确定清空全部捕捉记录？')) return;
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_ELEMENTS' });
  } catch (e) {}
  state.elements = [];
  render();
});

$('#copyAllBtn').addEventListener('click', async () => {
  const items = state.elements || [];
  if (!items.length) {
    showNotice('元素库为空，没有可复制的内容。', 'warn');
    return;
  }
  const fmt = EXPORT_FORMATS[exportFormat] || EXPORT_FORMATS.text;
  await copyFeedback(buildExport(items, exportFormat), $('#copyAllBtn'));
  showNotice('已复制全部 ' + items.length + ' 个元素（' + fmt.label + '）。', 'ok');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ELEMENTS_UPDATED') queryState();
});

chrome.tabs.onActivated.addListener(updateActiveTab);
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === tabId && (changeInfo.url || changeInfo.status === 'complete')) updateActiveTab();
});

// 焦点在侧边栏时，B / Esc 也能控制页面拾取（否则按键到不了网页）
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (typing) return;
  if ((e.key === 'b' || e.key === 'B') && state.picking) {
    chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_BROWSE' }, { frameId: 0 }).catch(() => {});
  } else if (e.key === 'Escape' && state.picking) {
    chrome.runtime.sendMessage({ type: 'STOP_PICK', tabId })
      .then((resp) => {
        if (resp && resp.ok) {
          state.picking = false;
          render();
        }
      })
      .catch(() => {});
  }
});

// 显示扩展版本（manifest 里的真实版本号）
try {
  const mv = chrome.runtime.getManifest && chrome.runtime.getManifest();
  if (mv && mv.version) $('#version').textContent = 'v' + mv.version;
} catch (e) {}

updateActiveTab();
loadSettings();
