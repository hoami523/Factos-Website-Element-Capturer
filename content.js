// Factos Website Factos Website Element Capturerr — content script（注入所有 frame，包括 iframe）
(() => {
  'use strict';

  // 扩展更新 / 重复注入时：先停掉页面里残留的旧实例（移除其监听与 UI），再运行新实例
  const previousInstance = window.__ecpInstance;
  if (previousInstance && typeof previousInstance.cleanup === 'function') {
    try { previousInstance.cleanup(); } catch (e) {}
  }

  const OVERLAY_ID = 'ecp-highlight';
  const WHOAMI = 'ecp_whoami';
  const WHOAMI_RES = 'ecp_whoami_res';
  const LOCATE_DOWN = 'ecp_locate_down';
  const LOCATE_RES = 'ecp_locate_res';
  const FRAME_TIMEOUT = 900;

  let picking = false;
  let highlightEl = null;
  let labelEl = null;
  let lastMoveTime = 0;
  let flashTimer = 0;
  let locateFlashTimer = 0;
  const frameRoutes = new Map();
  const locateRoutes = new Map();
  let widgetEl = null;
  let toastEl = null;
  let toastTimer = 0;
  let browseMode = false;
  let captureCount = 0;
  let namingOpen = false;
  let namingEl = null;
  let namingInput = null;
  let namingId = null;

  // ---------- 基础工具 ----------

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function cssEscape(s) {
    try {
      return CSS.escape(s);
    } catch (e) {
      return s;
    }
  }

  function cssAttrValue(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // XPath 字符串字面量转义（单引号用 concat 拆开）
  function xq(s) {
    s = String(s);
    if (s.indexOf("'") === -1) return s;
    return "concat('" + s.split("'").join("', \"'\", '") + "')";
  }

  function textOf(el) {
    if (el.querySelector('*')) return null;
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length > 60) return null;
    return t;
  }

  // 高亮/闪烁用色（与设计系统一致）
  const HL_COLOR = '#e5484d';
  const HL_BG = 'rgba(229, 72, 77, .10)';
  const OK_COLOR = '#12b37e';
  const OK_BG = 'rgba(18, 179, 126, .16)';

  // 注入式 UI 样式（全部用 data-ecp* 属性选择器隔离，避免污染宿主页面）
  const UI_CSS = `
  /* Factos Website Factos Website Element Capturerr — 注入式 UI */
  @keyframes ecpRise {
    from { opacity: 0; transform: translate(-50%, 14px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes ecpPop {
    from { opacity: 0; transform: translateY(12px) scale(.96); }
    to { opacity: 1; transform: none; }
  }
  @keyframes ecpFade { from { opacity: 0; } to { opacity: 1; } }

  [data-ecp-widget="pill"] {
    position: fixed;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    background: rgba(17, 19, 27, .88);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, .14);
    border-radius: 999px;
    padding: 8px 12px 8px 14px;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    box-shadow: 0 12px 32px -8px rgba(5, 8, 20, .5), inset 0 1px 0 rgba(255, 255, 255, .08);
    user-select: none;
    -webkit-user-select: none;
  }
  [data-ecp-widget="pill"] { left: 50%; bottom: 22px; transform: translateX(-50%); animation: ecpRise .34s cubic-bezier(.22, 1, .36, 1) both; }

  [data-ecp-widget="pill"] .ecp-pill-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
    display: inline-block;
  }
  [data-ecp-widget="pill"] .ecp-dot--green { background: #22c08a; box-shadow: 0 0 10px rgba(34, 192, 138, .55); }
  [data-ecp-widget="pill"] .ecp-dot--amber { background: #f0a13d; box-shadow: 0 0 10px rgba(240, 161, 61, .55); }

  [data-ecp-widget="pill"] .ecp-pill-text { white-space: nowrap; }

  [data-ecp-widget="pill"] button {
    flex: none;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, .28);
    background: rgba(255, 255, 255, .08);
    color: #fff;
    border-radius: 999px;
    padding: 3px 11px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    line-height: 1.4;
    transition: background .16s ease, border-color .16s ease, transform .14s cubic-bezier(.22, 1, .36, 1);
  }
  [data-ecp-widget="pill"] button:hover { background: rgba(255, 255, 255, .16); border-color: rgba(255, 255, 255, .5); }
  [data-ecp-widget="pill"] button:active { transform: scale(.94); }

  [data-ecp-widget="toast"] {
    position: fixed;
    left: 50%;
    bottom: 68px;
    transform: translateX(-50%);
    z-index: 2147483646;
    box-sizing: border-box;
    display: none;
    background: rgba(17, 19, 27, .92);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, .14);
    border-radius: 10px;
    padding: 8px 14px;
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    box-shadow: 0 12px 32px -8px rgba(5, 8, 20, .45);
    max-width: 76vw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    animation: ecpRise .3s cubic-bezier(.22, 1, .36, 1) both;
  }

  [data-ecp-naming="modal"] {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(13, 15, 22, .46);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    animation: ecpFade .22s ease both;
  }
  [data-ecp-naming="card"] {
    box-sizing: border-box;
    background: #fff;
    color: #181920;
    border-radius: 16px;
    box-shadow: 0 24px 70px -12px rgba(5, 8, 20, .5);
    width: 420px;
    max-width: 90vw;
    padding: 22px;
    animation: ecpPop .28s cubic-bezier(.22, 1, .36, 1) both;
  }
  [data-ecp-naming="title"] { margin: 0 0 4px; font-size: 16px; font-weight: 700; }
  [data-ecp-naming="desc"] { margin: 0 0 14px; font-size: 12px; color: #6f7588; }
  [data-ecp-naming="input"] {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d8dbe3;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 14px;
    color: #181920;
    outline: none;
    transition: border-color .18s ease, box-shadow .18s ease;
  }
  [data-ecp-naming="input"]:focus { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79, 70, 229, .16); }
  [data-ecp-naming="btns"] { display: flex; gap: 8px; margin-top: 16px; }
  [data-ecp-naming="btn"] {
    flex: 1;
    box-sizing: border-box;
    border-radius: 10px;
    padding: 9px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: transform .14s cubic-bezier(.22, 1, .36, 1), filter .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease;
  }
  [data-ecp-naming="btn"]:active { transform: scale(.97); }
  [data-ecp-naming-primary] {
    border: 1px solid transparent;
    background: linear-gradient(135deg, #6366f1, #4f46e5);
    color: #fff;
    box-shadow: 0 3px 10px -2px rgba(79, 70, 229, .45);
  }
  [data-ecp-naming-primary]:hover { filter: brightness(1.06); }
  [data-ecp-naming-ghost] {
    background: #fff;
    color: #3f4657;
    border: 1px solid #d8dbe3;
  }
  [data-ecp-naming-ghost]:hover { border-color: rgba(79, 70, 229, .4); color: #4f46e5; background: #eef0fe; }

  #ecp-highlight {
    position: fixed;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    opacity: 0;
    z-index: 2147483647;
    pointer-events: none;
    box-sizing: border-box;
    border: 2px solid #e5484d;
    background: rgba(229, 72, 77, .10);
    border-radius: 6px;
    box-shadow: 0 0 0 3px rgba(229, 72, 77, .14), 0 12px 32px -12px rgba(229, 72, 77, .45);
    will-change: transform, width, height, opacity;
    transition:
      transform .22s cubic-bezier(.16, 1, .3, 1),
      width .26s cubic-bezier(.16, 1, .3, 1),
      height .26s cubic-bezier(.16, 1, .3, 1),
      opacity .18s ease,
      border-color .2s ease,
      background-color .2s ease,
      box-shadow .2s ease;
  }
  [data-ecp="label"] {
    position: fixed;
    left: 0;
    top: 0;
    opacity: 0;
    z-index: 2147483647;
    pointer-events: none;
    box-sizing: border-box;
    background: rgba(20, 22, 32, .9);
    color: #fff;
    font: 11px/1.4 Consolas, Menlo, "SF Mono", monospace;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, .12);
    box-shadow: 0 4px 12px rgba(5, 8, 20, .25);
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    will-change: transform, opacity;
    transition: transform .22s cubic-bezier(.16, 1, .3, 1), opacity .18s ease;
  }
  `;

  function ensureUiStyle() {
    if (document.getElementById('ecp-ui-style')) return;
    const s = document.createElement('style');
    s.id = 'ecp-ui-style';
    s.textContent = UI_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------- 定位器生成 ----------

  function isUniqueCss(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch (e) {
      return false;
    }
  }

  function isUniqueXPath(xp) {
    try {
      const res = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return res.snapshotLength === 1;
    } catch (e) {
      return false;
    }
  }

  function cssPart(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + cssEscape(el.id);
    // 优先用稳定属性，其次类名，最后才退回位置序号
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'name', 'placeholder', 'aria-placeholder', 'aria-label', 'role']) {
      const v = el.getAttribute(attr);
      if (v) return tag + '[' + attr + '="' + cssAttrValue(v) + '"]';
    }
    const cls = Array.from(el.classList || [])
      .filter((c) => /^[a-zA-Z_][\w-]*$/.test(c))
      .slice(0, 2);
    if (cls.length) return tag + '.' + cls.map(cssEscape).join('.');
    const typeAttr = el.getAttribute('type');
    if (typeAttr) return tag + '[type="' + cssAttrValue(typeAttr) + '"]';
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
      if (same.length > 1) {
        return tag + ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
    }
    return tag;
  }

  function shortestUniquePath(el, tryCss) {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
      chain.unshift(cur);
      cur = cur.parentElement;
    }
    for (let depth = 1; depth <= chain.length; depth++) {
      const slice = chain.slice(chain.length - depth);
      const sel = slice.map(cssPart).join(' > ');
      const hit = tryCss(sel, 65 - depth * 4);
      if (hit) return hit;
    }
    return chain.map(cssPart).join(' > ') || 'html';
  }

  function xpathFull(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      let idx = 1;
      for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === cur.tagName) idx++;
      }
      const tag = cur.tagName.toLowerCase();
      parts.unshift(idx > 1 ? tag + '[' + idx + ']' : tag);
      cur = cur.parentElement;
    }
    return '/' + parts.join('/');
  }

  function relativeXPath(ancestor, el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== ancestor) {
      let idx = 1;
      for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === cur.tagName) idx++;
      }
      const tag = cur.tagName.toLowerCase();
      parts.unshift(idx > 1 ? tag + '[' + idx + ']' : tag);
      cur = cur.parentElement;
    }
    return cur === ancestor ? parts.join('/') : null;
  }

  function xpathAttrAnchor(el) {
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'name', 'aria-label', 'placeholder', 'aria-placeholder', 'type', 'role']) {
      const v = el.getAttribute(attr);
      if (v) return '@' + attr + "='" + xq(v) + "'";
    }
    return null;
  }

  function xpathFromId(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.id && document.getElementById(cur.id) === cur) {
        if (cur === el) return [];
        const anchor = "//" + cur.tagName.toLowerCase() + "[@id='" + xq(cur.id) + "']";
        const tag = el.tagName.toLowerCase();
        const out = [];
        // 1) 锚 + 后代轴 + 元素自身稳定属性：中间结构变化不敏感
        const attr = xpathAttrAnchor(el);
        if (attr) out.push(anchor + '//' + tag + '[' + attr + ']');
        // 2) 锚 + 后代轴 + 元素文本
        const own = textOf(el);
        if (own) out.push(anchor + "//" + tag + "[normalize-space(.)='" + xq(own) + "']");
        // 3) 锚 + 纯后代轴（仅当该标签在锚下唯一）
        out.push(anchor + '//' + tag);
        // 4) 锚 + 严格相对链兜底
        const rel = relativeXPath(cur, el);
        if (rel) out.push(anchor + '/' + rel);
        return out;
      }
      cur = cur.parentElement;
    }
    return [];
  }

  // 生成 CSS / XPath 候选并逐级校验唯一性
  function locateElement(el) {
    const candidates = [];
    const cssSeen = new Set();
    const xpSeen = new Set();

    const tryCss = (sel, score) => {
      if (!sel || cssSeen.has(sel)) return null;
      cssSeen.add(sel);
      if (isUniqueCss(sel)) {
        candidates.push({ type: 'css', value: sel, score });
        return sel;
      }
      return null;
    };

    const tryXp = (xp, score) => {
      if (!xp || xpSeen.has(xp)) return null;
      xpSeen.add(xp);
      if (isUniqueXPath(xp)) {
        candidates.push({ type: 'xpath', value: xp, score });
        return xp;
      }
      return null;
    };

    const tag = el.tagName.toLowerCase();
    let css = null;

    if (el.id) {
      css = tryCss('#' + cssEscape(el.id), 100) || css;
      css = tryCss(tag + '#' + cssEscape(el.id), 95) || css;
    }
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'name', 'aria-label', 'role']) {
      const v = el.getAttribute(attr);
      if (v) css = tryCss('[' + attr + '="' + cssAttrValue(v) + '"]', 90) || css;
    }
    for (const attr of ['placeholder', 'aria-placeholder']) {
      const v = el.getAttribute(attr);
      if (v) css = tryCss(tag + '[' + attr + '="' + cssAttrValue(v) + '"]', 85) || css;
    }
    const cls = Array.from(el.classList || []).filter((c) => /^[a-zA-Z_][\w-]*$/.test(c));
    if (cls.length) {
      css = tryCss(tag + '.' + cls.slice(0, 3).map(cssEscape).join('.'), 80) || css;
      css = tryCss('.' + cls.slice(0, 2).map(cssEscape).join('.'), 75) || css;
    }
    const typeAttr = el.getAttribute('type');
    if (typeAttr) css = tryCss(tag + '[type="' + cssAttrValue(typeAttr) + '"]', 70) || css;
    css = css || shortestUniquePath(el, tryCss);

    let xpath = null;
    if (el.id) xpath = tryXp('//' + tag + "[@id='" + xq(el.id) + "']", 100) || xpath;
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'name', 'aria-label', 'role']) {
      const v = el.getAttribute(attr);
      if (v) xpath = tryXp('//*[@' + attr + "='" + xq(v) + "']", 90) || xpath;
    }
    for (const attr of ['placeholder', 'aria-placeholder']) {
      const v = el.getAttribute(attr);
      if (v) xpath = tryXp('//' + tag + "[@" + attr + "='" + xq(v) + "']", 85) || xpath;
    }
    const ownText = textOf(el);
    if (ownText) {
      xpath = tryXp('//' + tag + "[normalize-space(.)='" + xq(ownText) + "']", 85) || xpath;
      if (ownText.length > 4) {
        xpath = tryXp('//' + tag + "[contains(normalize-space(.),'" + xq(ownText.slice(0, 24)) + "')]", 80) || xpath;
      }
    }
    if (!xpath) {
      for (const anchored of xpathFromId(el)) {
        xpath = tryXp(anchored, 70);
        if (xpath) break;
      }
    }
    xpath = xpath || tryXp(xpathFull(el), 45);

    const sorted = candidates.slice().sort((a, b) => b.score - a.score);
    return {
      css: css || xpathFull(el),
      xpath: xpath || xpathFull(el),
      cssVerified: !!css,
      xpathVerified: !!xpath,
      candidates: sorted.slice(0, 8)
    };
  }

  function describeElement(el) {
    const attrs = {};
    const keep = new Set(['name', 'role', 'placeholder', 'type', 'alt', 'title', 'href', 'value', 'for', 'src', 'target']);
    for (const attr of Array.from(el.attributes || [])) {
      const n = attr.name.toLowerCase();
      const v = attr.value;
      if (v && v.length <= 200 && (n.startsWith('data-') || n.startsWith('aria-') || keep.has(n))) {
        attrs[n] = v;
      }
    }
    const rect = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className : Array.from(el.classList).join(' ');
    const info = {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      class: cls || undefined,
      text: textOf(el) || undefined,
      attrs
    };
    if (!rect.width && !rect.height) info.hidden = true;
    return info;
  }

  // ---------- 输出表达式（Playwright / Selenium） ----------

  function frameLocatorExpr(framePath, leafLocator, stable) {
    let expr = 'page';
    for (const f of framePath) {
      const sel = stable && f.stable ? f.stable.css : f.css;
      expr += '.frameLocator(' + JSON.stringify(sel) + ')';
    }
    return expr + '.locator(' + JSON.stringify(leafLocator) + ')';
  }

  function seleniumExpr(framePath, leafLocator, stable) {
    let expr = 'driver';
    for (const f of framePath) {
      if (!stable && f.id) expr += '.switchTo().frame(' + JSON.stringify(f.id) + ')';
      else if (!stable && f.name) expr += '.switchTo().frame(' + JSON.stringify(f.name) + ')';
      else {
        const sel = stable && f.stable ? f.stable.css : f.css;
        expr += '.switchTo().frame(driver.findElement(By.css(' + JSON.stringify(sel) + ')))';
      }
    }
    const kind = leafLocator.startsWith('//') ? 'xpath' : 'css';
    return expr + '.findElement(By.' + kind + '(' + JSON.stringify(leafLocator) + '))';
  }

  function buildLocators(leaf, framePath) {
    return {
      css: leaf.css,
      xpath: leaf.xpath,
      playwright_css: frameLocatorExpr(framePath, leaf.css, false),
      playwright_xpath: frameLocatorExpr(framePath, leaf.xpath, false),
      selenium_css: seleniumExpr(framePath, leaf.css, false),
      selenium_xpath: seleniumExpr(framePath, leaf.xpath, false),
      playwright_css_stable: frameLocatorExpr(framePath, leaf.css, true),
      playwright_xpath_stable: frameLocatorExpr(framePath, leaf.xpath, true),
      selenium_css_stable: seleniumExpr(framePath, leaf.css, true),
      selenium_xpath_stable: seleniumExpr(framePath, leaf.xpath, true)
    };
  }

  // ---------- iframe 嵌套 frame 链（跨域 postMessage 协议） ----------

  function findFrameElement(win) {
    const frames = document.querySelectorAll('iframe, frame');
    for (const f of frames) {
      try {
        if (f.contentWindow === win) return f;
      } catch (e) {}
    }
    return null;
  }

  // 生成稳定的 frame 定位器：识别 name 中 $$ 分隔的动态后缀，
  // 或退而用 src 路径 / service 参数；所有候选都做唯一性校验。
  function stableFrameSelectors(el, loc) {
    const candidates = [];
    const seen = new Set();
    const push = (kind, css, xpath, verified) => {
      if (!css || seen.has(css)) return;
      seen.add(css);
      candidates.push({ kind, css, xpath, verified });
    };

    const name = el.getAttribute('name');
    if (name) {
      const m = /^([A-Za-z0-9_]+)\$\$/.exec(name);
      if (m) {
        // 例：cbsswebiframe_cbsBIL6531_2I$$2nx6aplmtjw → 前缀 cbsswebiframe_cbsBIL6531_2I
        const prefix = m[1];
        const css = 'iframe[name^="' + cssAttrValue(prefix) + '"]';
        push('name-prefix', css, "//iframe[starts-with(@name,'" + xq(prefix) + "')]", isUniqueCss(css));
      } else {
        // name 里没有动态分隔符，直接用完整 name（验证唯一）
        const css = 'iframe[name="' + cssAttrValue(name) + '"]';
        if (isUniqueCss(css)) {
          push('name', css, "//iframe[@name='" + xq(name) + "']", true);
        }
      }
    }

    if (el.id) {
      const css = 'iframe#' + cssEscape(el.id);
      if (isUniqueCss(css)) {
        push('id', css, "//iframe[@id='" + xq(el.id) + "']", true);
      }
    }

    const src = el.getAttribute('src');
    if (src && !/^(data|javascript|about):/i.test(src)) {
      try {
        const u = new URL(src, location.href);
        if (u.pathname && u.pathname.length > 1) {
          const css = 'iframe[src*="' + cssAttrValue(u.pathname) + '"]';
          push('src-path', css, "//iframe[contains(@src,'" + xq(u.pathname) + "')]", isUniqueCss(css));
        }
        const service = u.searchParams.get('service');
        if (service) {
          const css = 'iframe[src*="' + cssAttrValue(service) + '"]';
          push('src-service', css, "//iframe[contains(@src,'" + xq(service) + "')]", isUniqueCss(css));
        }
      } catch (e) {}
    }

    if (!candidates.length) {
      // 没有明显动态特征：保持捕捉时的定位器
      return {
        kind: 'unchanged',
        css: loc.css,
        xpath: loc.xpath,
        verified: true,
        alternatives: []
      };
    }

    const verified = candidates.filter((c) => c.verified);
    const best = (verified.length ? verified : candidates)[0];
    return {
      kind: best.kind,
      css: best.css,
      xpath: best.xpath,
      verified: best.verified,
      alternatives: candidates.filter((c) => c !== best)
    };
  }

  function frameEntry(iframeEl) {
    const loc = locateElement(iframeEl);
    return {
      tag: iframeEl.tagName.toLowerCase(),
      id: iframeEl.id || undefined,
      name: iframeEl.getAttribute('name') || undefined,
      src: iframeEl.getAttribute('src') || (iframeEl.hasAttribute('srcdoc') ? 'srcdoc' : undefined),
      css: loc.css,
      xpath: loc.xpath,
      stable: stableFrameSelectors(iframeEl, loc)
    };
  }

  function resolveFramePath() {
    return new Promise((resolve) => {
      if (window.top === window) {
        resolve({ chain: [], unknown: false });
        return;
      }
      const requestId = uuid();
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        frameRoutes.delete(requestId);
        resolve({ chain: [], unknown: true });
      }, FRAME_TIMEOUT);
      frameRoutes.set(requestId, {
        childWindow: null,
        resolve: (chain) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ chain: chain || [], unknown: false });
        },
        timer
      });
      try {
        window.parent.postMessage({ __ecp: true, type: WHOAMI, requestId, chain: [] }, '*');
      } catch (e) {
        frameRoutes.delete(requestId);
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve({ chain: [], unknown: true });
        }
      }
    });
  }

  function onWindowMessage(event) {
    const data = event.data;
    if (!data || data.__ecp !== true) return;

    if (data.type === WHOAMI) {
      const iframeEl = findFrameElement(event.source);
      if (!iframeEl) return;
      const entry = frameEntry(iframeEl);
      const chain = [entry].concat(data.chain || []);
      if (window.top === window) {
        try {
          event.source.postMessage({ __ecp: true, type: WHOAMI_RES, requestId: data.requestId, chain }, '*');
        } catch (e) {}
      } else {
        frameRoutes.set(data.requestId, {
          childWindow: event.source,
          resolve: null,
          timer: setTimeout(() => {
            frameRoutes.delete(data.requestId);
          }, FRAME_TIMEOUT)
        });
        try {
          window.parent.postMessage({ __ecp: true, type: WHOAMI, requestId: data.requestId, chain }, '*');
        } catch (e) {
          frameRoutes.delete(data.requestId);
        }
      }
    } else if (data.type === WHOAMI_RES) {
      const route = frameRoutes.get(data.requestId);
      if (!route) return;
      clearTimeout(route.timer);
      frameRoutes.delete(data.requestId);
      if (route.childWindow) {
        try {
          route.childWindow.postMessage({ __ecp: true, type: WHOAMI_RES, requestId: data.requestId, chain: data.chain }, '*');
        } catch (e) {}
      } else if (route.resolve) {
        route.resolve(data.chain || []);
      }
    } else if (data.type === LOCATE_DOWN) {
      // 父 frame 派发定位：event.source 是父窗口
      walkLocate(data.requestId, data.remaining, data.css, data.xpath, event.source, null);
    } else if (data.type === LOCATE_RES) {
      // 子 frame 回传定位结果：继续向上转发，或由顶层完成响应
      const route = locateRoutes.get(data.requestId);
      if (!route) return;
      clearTimeout(route.timer);
      locateRoutes.delete(data.requestId);
      if (route.parentSource) {
        try {
          route.parentSource.postMessage({ __ecp: true, type: LOCATE_RES, requestId: data.requestId, result: data.result }, '*');
        } catch (e) {}
      } else if (route.done) {
        route.done(data.result);
      }
    }
  }

  window.addEventListener('message', onWindowMessage, false);

  // ---------- 定位已捕捉元素（自上而下沿 frame_path 派发） ----------

  function handleLocateRequest(msg, sendResponse) {
    const requestId = uuid();
    const done = (result) => {
      try {
        sendResponse(result);
      } catch (e) {}
    };
    walkLocate(requestId, msg.framePath || [], msg.css, msg.xpath, null, done);
  }

  function walkLocate(requestId, remaining, css, xpath, parentSource, done) {
    const finish = (result) => {
      if (parentSource) {
        try {
          parentSource.postMessage({ __ecp: true, type: LOCATE_RES, requestId, result }, '*');
        } catch (e) {}
      } else if (done) {
        done(result);
      }
    };

    if (!remaining.length) {
      finish(locateAndFlash(css, xpath));
      return;
    }

    const entry = remaining[0];
    const sel = (entry.stable && entry.stable.css) || entry.css;
    let iframeEl = null;
    if (sel) {
      try {
        const list = document.querySelectorAll(sel);
        if (list.length === 1) iframeEl = list[0];
      } catch (e) {}
    }
    if (!iframeEl) {
      finish({ found: false, reason: 'frame' });
      return;
    }
    let childWindow = null;
    try {
      childWindow = iframeEl.contentWindow;
    } catch (e) {}
    if (!childWindow) {
      finish({ found: false, reason: 'frame' });
      return;
    }

    const route = { parentSource, done, timer: null };
    route.timer = setTimeout(() => {
      locateRoutes.delete(requestId);
      finish({ found: false, reason: 'timeout' });
    }, 1500);
    locateRoutes.set(requestId, route);

    try {
      childWindow.postMessage({
        __ecp: true,
        type: LOCATE_DOWN,
        requestId,
        remaining: remaining.slice(1),
        css,
        xpath
      }, '*');
    } catch (e) {
      clearTimeout(route.timer);
      locateRoutes.delete(requestId);
      finish({ found: false, reason: 'post' });
    }
  }

  function locateAndFlash(css, xpath) {
    let el = null;
    if (css) {
      try {
        const list = document.querySelectorAll(css);
        if (list.length === 1) el = list[0];
      } catch (e) {}
    }
    if (!el && xpath) {
      try {
        const res = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res.singleNodeValue && res.singleNodeValue.nodeType === 1) el = res.singleNodeValue;
      } catch (e) {}
    }
    if (!el) {
      return { found: false, reason: 'element' };
    }
    flashLocatedElement(el);
    return { found: true, tag: el.tagName.toLowerCase(), id: el.id || '' };
  }

  function flashLocatedElement(el) {
    const isVisible = () => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 &&
        r.bottom > 0 && r.top < window.innerHeight &&
        r.right > 0 && r.left < window.innerWidth;
    };
    const runFlash = () => {
      const rect = el.getBoundingClientRect();
      const h = currentOverlay();
      if (!h || (!rect.width && !rect.height)) return;
      clearTimeout(flashTimer);
      clearTimeout(locateFlashTimer);
      showHighlight(rect, summaryLabel(el));
      let pulse = 0;
      const step = () => {
        pulse++;
        h.style.borderColor = pulse % 2 ? OK_COLOR : HL_COLOR;
        h.style.background = pulse % 2 ? OK_BG : HL_BG;
        h.style.boxShadow = pulse % 2
          ? '0 0 0 3px rgba(18,179,126,.18), 0 12px 32px -12px rgba(18,179,126,.45)'
          : '0 0 0 3px rgba(229,72,77,.14), 0 12px 32px -12px rgba(229,72,77,.45)';
        if (pulse >= 5) {
          hideHighlight();
          return;
        }
        locateFlashTimer = setTimeout(step, 180);
      };
      step();
    };
    if (isVisible()) {
      runFlash();
    } else {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      } catch (e) {}
      setTimeout(runFlash, 350);
    }
  }

  // ---------- 强制命名弹窗（页面中央，仅顶层 frame） ----------

  function ensureNamingModal() {
    if (namingEl && namingEl.isConnected) return;
    const root = document.body || document.documentElement;
    if (!root) return;
    ensureUiStyle();

    namingEl = document.createElement('div');
    namingEl.setAttribute('data-ecp-naming', 'modal');

    const card = document.createElement('div');
    card.setAttribute('data-ecp-naming', 'card');

    const title = document.createElement('div');
    title.setAttribute('data-ecp-naming', 'title');
    title.textContent = '为元素命名';

    const desc = document.createElement('div');
    desc.id = 'ecp-naming-desc';
    desc.setAttribute('data-ecp-naming', 'desc');

    namingInput = document.createElement('input');
    namingInput.setAttribute('data-ecp-naming', 'input');
    namingInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmNaming();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        skipNaming();
      }
    });

    const btns = document.createElement('div');
    btns.setAttribute('data-ecp-naming', 'btns');

    const okBtn = document.createElement('button');
    okBtn.textContent = '确定 (Enter)';
    okBtn.setAttribute('data-ecp-naming', 'btn');
    okBtn.setAttribute('data-ecp-naming-primary', '');
    okBtn.addEventListener('click', () => confirmNaming());

    const skipBtn = document.createElement('button');
    skipBtn.textContent = '跳过 (Esc)';
    skipBtn.setAttribute('data-ecp-naming', 'btn');
    skipBtn.setAttribute('data-ecp-naming-ghost', '');
    skipBtn.addEventListener('click', () => skipNaming());

    btns.append(okBtn, skipBtn);
    card.append(title, desc, namingInput, btns);
    namingEl.appendChild(card);
    root.appendChild(namingEl);
  }

  function openNamingModal(element) {
    if (!isTopFrame()) return;
    ensureNamingModal();
    if (!namingEl) return;
    namingOpen = true;
    namingId = element && element.id;
    namingInput.value = (element && (element.suggestedName || element.name)) || '';
    const tag = element && element.element && element.element.tag ? '<' + element.element.tag + '>' : '';
    const d = namingEl.querySelector('#ecp-naming-desc');
    if (d) d.textContent = '捕捉到 ' + tag + '，输入名称后回车确认；Esc 跳过（使用自动名称）。';
    namingEl.style.display = 'flex';
    try {
      window.focus();
    } catch (e) {}
    namingInput.focus();
    namingInput.select();
  }

  function closeNamingModal() {
    namingOpen = false;
    if (namingEl) namingEl.style.display = 'none';
  }

  function confirmNaming() {
    const name = (namingInput.value || '').trim();
    const id = namingId;
    closeNamingModal();
    if (id && name) {
      try {
        chrome.runtime.sendMessage({ type: 'NAME_ELEMENT', id, name });
      } catch (e) {}
    }
  }

  function skipNaming() {
    closeNamingModal();
  }

  // ---------- 页面拾取浮层（仅顶层 frame） ----------

  function isTopFrame() {
    return window.top === window;
  }

  function ensureWidget() {
    if (!isTopFrame()) return;
    const root = document.body || document.documentElement;
    if (!root) return;
    ensureUiStyle();
    if (!widgetEl || !widgetEl.isConnected) {
      widgetEl = document.createElement('div');
      widgetEl.setAttribute('data-ecp-widget', 'pill');
      widgetEl.className = 'ecp-pill';
      widgetEl.innerHTML =
        '<span class="ecp-pill-dot ecp-dot--green"></span>' +
        '<span id="ecp-w-text" class="ecp-pill-text">拾取模式 · Alt+点击捕捉</span>' +
        '<button id="ecp-w-browse" class="ecp-pill-btn">浏览</button>' +
        '<button id="ecp-w-stop" class="ecp-pill-btn">停止</button>';
      widgetEl.title = '拾取模式：Alt+点击=捕捉元素；普通点击=正常操作；B=切换浏览模式';
      root.appendChild(widgetEl);
      const browse = widgetEl.querySelector('#ecp-w-browse');
      if (browse) {
        browse.addEventListener('click', (e) => {
          e.stopPropagation();
          setBrowseMode(!browseMode);
        });
      }
      const stop = widgetEl.querySelector('#ecp-w-stop');
      if (stop) {
        stop.addEventListener('click', (e) => {
          e.stopPropagation();
          disablePick();
          try {
            chrome.runtime.sendMessage({ type: 'PICK_CANCELLED' });
          } catch (err) {}
        });
      }
    }
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('data-ecp-widget', 'toast');
      root.appendChild(toastEl);
    }
    renderWidget();
  }

  function removeWidget() {
    if (widgetEl) {
      widgetEl.remove();
      widgetEl = null;
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }

  function renderWidget() {
    if (!widgetEl || !widgetEl.isConnected) return;
    const dot = widgetEl.querySelector('.ecp-pill-dot');
    const text = widgetEl.querySelector('#ecp-w-text');
    const toggle = widgetEl.querySelector('#ecp-w-browse');
    if (browseMode) {
      if (dot) dot.className = 'ecp-pill-dot ecp-dot--amber';
      if (text) text.textContent = '浏览模式 · 页面操作已放行';
      if (toggle) toggle.textContent = '拾取';
    } else {
      if (dot) dot.className = 'ecp-pill-dot ecp-dot--green';
      if (text) text.textContent = '拾取模式 · Alt+点击捕捉 · ' + captureCount + ' 个';
      if (toggle) toggle.textContent = '浏览';
    }
  }

  function applyBrowseMode(on) {
    browseMode = on;
    renderWidget();
    if (on) hideHighlight();
  }

  function setBrowseMode(on) {
    applyBrowseMode(on);
    // 广播到所有 frame，避免只隐藏当前有焦点的这一层高亮
    try {
      chrome.runtime.sendMessage({ type: 'BROWSE_MODE_CHANGED', enabled: on });
    } catch (err) {}
  }

  function updateWidgetCount(count) {
    captureCount = count;
    ensureWidget();
    renderWidget();
  }

  function showToast(text) {
    if (!isTopFrame()) return;
    ensureWidget();
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.display = 'none';
    }, 2600);
  }

  function isWidgetEl(node) {
    return !!node && typeof node.closest === 'function' && !!node.closest('[data-ecp-widget], [data-ecp-naming]');
  }

  // ---------- 拾取模式与高亮 ----------

  function ensureOverlay() {
    const root = document.body || document.documentElement;
    if (!root) return;
    ensureUiStyle();
    if (!highlightEl || !highlightEl.isConnected) {
      highlightEl = document.createElement('div');
      highlightEl.id = OVERLAY_ID;
      highlightEl.setAttribute('data-ecp', 'overlay');
      root.appendChild(highlightEl);
    }
    if (!labelEl || !labelEl.isConnected) {
      labelEl = document.createElement('div');
      labelEl.setAttribute('data-ecp', 'label');
      root.appendChild(labelEl);
    }
  }

  function currentOverlay() {
    // 保证操作的是当前挂在页面上的高亮元素，而不是已被移除的旧引用
    if ((!highlightEl || !highlightEl.isConnected) && (document.body || document.documentElement)) {
      ensureOverlay();
    }
    return highlightEl;
  }

  function showHighlight(rect, label) {
    const h = currentOverlay();
    if (!h) return;
    // 每次显示都重置为默认红色，避免残留捕捉成功的绿色
    h.style.borderColor = HL_COLOR;
    h.style.background = HL_BG;
    h.style.boxShadow = '0 0 0 3px rgba(229,72,77,.14), 0 12px 32px -12px rgba(229,72,77,.45)';
    h.style.opacity = '1';
    h.style.width = Math.max(rect.width - 4, 0) + 'px';
    h.style.height = Math.max(rect.height - 4, 0) + 'px';
    h.style.transform = 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0)';
    if (labelEl) {
      labelEl.textContent = label || '';
      labelEl.style.opacity = label ? '1' : '0';
      if (label) {
        let lx = rect.left;
        let ly = rect.top - 18;
        if (ly < 0) ly = rect.bottom + 2;
        if (lx + 420 > window.innerWidth) lx = Math.max(0, window.innerWidth - 420);
        labelEl.style.transform = 'translate3d(' + lx + 'px,' + ly + 'px,0)';
      }
    }
  }

  function hideHighlight() {
    const h = currentOverlay();
    if (h) {
      clearTimeout(flashTimer);
      clearTimeout(locateFlashTimer);
      h.style.opacity = '0';
      h.style.borderColor = HL_COLOR;
      h.style.background = HL_BG;
    }
    if (labelEl) labelEl.style.opacity = '0';
  }

  function summaryLabel(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.classList && el.classList.length ? '.' + Array.from(el.classList).slice(0, 3).join('.') : '';
    return '<' + tag + id + cls + '>';
  }

  function isOverlay(el) {
    return el === highlightEl || (el && typeof el.getAttribute === 'function' && el.getAttribute('data-ecp') === 'overlay');
  }

  function onMouseMove(e) {
    const now = Date.now();
    if (now - lastMoveTime < 16) return;
    lastMoveTime = now;
    if (!picking) return;
    if (browseMode) {
      hideHighlight();
      return;
    }
    let el = null;
    try {
      el = document.elementFromPoint(e.clientX, e.clientY);
    } catch (err) {
      return;
    }
    if (!el || isOverlay(el) || isWidgetEl(el)) {
      hideHighlight();
      return;
    }
    // 悬停在 iframe 上时不显示本层高亮（由 iframe 内部自己高亮，避免双层/冻结残留）
    const tag = el.tagName && el.tagName.toLowerCase();
    if (tag === 'iframe' || tag === 'frame') {
      hideHighlight();
      return;
    }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) {
      hideHighlight();
      return;
    }
    showHighlight(r, summaryLabel(el));
  }

  function onMouseDown(e) {
    if (!picking || browseMode || isOverlay(e.target) || isWidgetEl(e.target)) return;
    if (e.altKey) {
      // Alt+点击 = 捕捉：先阻止页面默认行为（焦点变化、导航等），由 click 统一处理
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function onClick(e) {
    if (!picking || browseMode) return;
    const target = e.target;
    if (!target || target.nodeType !== 1 || isOverlay(target) || isWidgetEl(target)) return;
    if (!e.altKey) return; // 普通点击：正常放行，交给页面操作
    e.preventDefault();
    e.stopImmediatePropagation();
    captureElement(target);
  }

  function onKeyDown(e) {
    if (namingOpen) return;
    if (e.key === 'Escape' && picking) {
      disablePick();
      try {
        chrome.runtime.sendMessage({ type: 'PICK_CANCELLED' });
      } catch (err) {}
      return;
    }
    if (picking && (e.key === 'b' || e.key === 'B')) {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!typing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setBrowseMode(!browseMode);
      }
    }
  }

  function onScroll() {
    hideHighlight();
  }

  function flash() {
    if (browseMode) return; // 浏览模式下不闪绿（防御）
    const h = currentOverlay();
    if (!h) return;
    clearTimeout(flashTimer);
    clearTimeout(locateFlashTimer);
    h.style.borderColor = OK_COLOR;
    h.style.background = OK_BG;
    h.style.boxShadow = '0 0 0 3px rgba(18,179,126,.18), 0 12px 32px -12px rgba(18,179,126,.45)';
    flashTimer = setTimeout(() => {
      if (h) {
        h.style.borderColor = HL_COLOR;
        h.style.background = HL_BG;
        h.style.boxShadow = '0 0 0 3px rgba(229,72,77,.14), 0 12px 32px -12px rgba(229,72,77,.45)';
      }
    }, 400);
  }

  function captureElement(el) {
    const leaf = locateElement(el);
    const elementInfo = describeElement(el);
    const frameUrl = location.href;
    resolveFramePath().then(({ chain, unknown }) => {
      const payload = {
        type: 'CAPTURE_RESULT',
        payload: {
          id: uuid(),
          capturedAt: new Date().toISOString(),
          page: { url: frameUrl, title: document.title },
          frame: { url: frameUrl },
          frame_path: chain,
          frame_path_unknown: unknown,
          element: elementInfo,
          locators: buildLocators(leaf, chain),
          candidates: leaf.candidates,
          verified: { css: leaf.cssVerified, xpath: leaf.xpathVerified, at: new Date().toISOString() }
        }
      };
      try {
        chrome.runtime.sendMessage(payload);
      } catch (err) {}
      flash();
    });
  }

  function enablePick() {
    picking = true;
    browseMode = false;
    lastMoveTime = 0;
    ensureOverlay();
    if (isTopFrame()) ensureWidget();
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', onScroll, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
  }

  function disablePick() {
    picking = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', onScroll, true);
    hideHighlight();
    if (isTopFrame()) removeWidget();
  }

  // ---------- 消息与初始化 ----------

  function onRuntimeMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'PICK_MODE') {
      if (msg.enabled) enablePick();
      else disablePick();
      sendResponse({ ok: true });
    }
    if (msg.type === 'PICK_FEEDBACK' && isTopFrame()) {
      if (typeof msg.count === 'number') updateWidgetCount(msg.count);
      if (msg.toast) showToast(msg.toast);
      sendResponse({ ok: true });
    }
    if (msg.type === 'BROWSE_MODE') {
      applyBrowseMode(!!msg.enabled);
      sendResponse({ ok: true });
    }
    if (msg.type === 'TOGGLE_BROWSE' && isTopFrame()) {
      setBrowseMode(!browseMode);
      sendResponse({ ok: true });
    }
    if (msg.type === 'LOCATE' && isTopFrame()) {
      handleLocateRequest(msg, sendResponse);
      return true; // 异步响应（沿 frame 链下钻后再回传）
    }
    if (msg.type === 'NAMING_REQ' && isTopFrame()) {
      openNamingModal(msg.element || {});
      sendResponse({ ok: true });
    }
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  function syncPickState() {
    if (document.hidden) return;
    try {
      chrome.runtime.sendMessage({ type: 'GET_PICK_STATE' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.enabled) enablePick();
        else disablePick();
      });
    } catch (e) {}
  }

  function onVisibilityChange() {
    if (!document.hidden) syncPickState();
  }

  function onWindowFocus() {
    syncPickState();
  }

  function onPageShow() {
    syncPickState();
  }

  function cleanupAll() {
    clearTimeout(flashTimer);
    clearTimeout(locateFlashTimer);
    clearTimeout(toastTimer);
    for (const route of frameRoutes.values()) clearTimeout(route.timer);
    for (const route of locateRoutes.values()) clearTimeout(route.timer);
    frameRoutes.clear();
    locateRoutes.clear();
    disablePick();
    window.removeEventListener('message', onWindowMessage, false);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onWindowFocus);
    window.removeEventListener('pageshow', onPageShow);
    try {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    } catch (e) {}
    const removeEl = (el) => {
      try {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch (e) {}
    };
    removeEl(highlightEl);
    removeEl(labelEl);
    removeEl(widgetEl);
    removeEl(toastEl);
    removeEl(namingEl);
    const style = document.getElementById('ecp-ui-style');
    if (style) removeEl(style);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('pageshow', onPageShow);

  window.__ecpInstance = { cleanup: cleanupAll };

  try {
    chrome.runtime.sendMessage({ type: 'GET_PICK_STATE' }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp && resp.enabled) enablePick();
    });
  } catch (e) {}

})();
