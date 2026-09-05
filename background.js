// Factos Website Factos Website Element Capturerr — service worker（MV3）

const DEFAULT_STATE = { elements: [], pickState: {} };

async function initSidePanel() {
  try {
    // 点击工具栏图标直接打开常驻侧边栏（Chrome 114+）
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {}
}

async function reinjectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js']
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function reinjectAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !/^(https?|file):/i.test(tab.url || '')) continue;
      try {
        await reinjectContent(tab.id);
      } catch (e) {}
    }
  } catch (e) {}
}

initSidePanel();
chrome.runtime.onInstalled.addListener(async (details) => {
  initSidePanel();
  // 更新/安装后，已打开页面里的旧内容脚本上下文会失效。
  // 主动重新注入，避免用户必须手动刷新页面才能继续拾取。
  if (details.reason === 'install' || details.reason === 'update') {
    reinjectAllTabs();
  }
});

async function setBadge(tabId, on) {
  try {
    if (on) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#f5222d' });
      await chrome.action.setBadgeText({ tabId, text: '拾取' });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (e) {
    // tab 已关闭等情况，忽略
  }
}

function suggestName(elementInfo) {
  const tagLabels = {
    button: '按钮', input: '输入框', select: '下拉', textarea: '文本域',
    a: '链接', label: '标签', img: '图片', div: '区域', span: '文本'
  };
  const info = elementInfo || {};
  const tag = info.tag || '元素';
  const label = tagLabels[tag] || tag;
  const attrs = info.attrs || {};
  const text = String(
    info.text || attrs.placeholder || attrs['aria-label'] || info.id || ''
  ).trim().slice(0, 12);
  return label + (text ? '-' + text : '');
}

function notifyUI() {
  chrome.runtime.sendMessage({ type: 'ELEMENTS_UPDATED' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'GET_STATE': {
      const tabId = msg.tabId;
      chrome.storage.local.get(DEFAULT_STATE, (data) => {
        const pickState = data.pickState || {};
        sendResponse({
          elements: data.elements || [],
          picking: tabId ? !!pickState[tabId] : false
        });
      });
      return true;
    }

    case 'TOGGLE_PICK': {
      const tabId = msg.tabId;
      if (!tabId) {
        sendResponse({ ok: false });
        return;
      }
      chrome.storage.local.get(DEFAULT_STATE, async (data) => {
        const pickState = data.pickState || {};
        const next = !pickState[tabId];
        pickState[tabId] = next;
        await chrome.storage.local.set({ pickState });
        await setBadge(tabId, next);
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'PICK_MODE', enabled: next });
        sendResponse({ ok: true, picking: next });
      } catch (e) {
        // 可能是扩展更新后旧内容脚本失效：先重新注入再重试一次
        let reinjected = false;
        try {
          reinjected = await reinjectContent(tabId);
        } catch (err) {}
        if (reinjected) {
          try {
            await chrome.tabs.sendMessage(tabId, { type: 'PICK_MODE', enabled: next });
            sendResponse({ ok: true, picking: next });
            return;
          } catch (e2) {}
        }
        // 页面确实没有内容脚本（如 chrome:// 页），回滚状态
        delete pickState[tabId];
        await chrome.storage.local.set({ pickState });
        await setBadge(tabId, false);
        sendResponse({ ok: false, reason: 'no-content-script' });
      }
      });
      return true;
    }

    case 'PICK_CANCELLED': {
      const tabId = sender.tab && sender.tab.id;
      if (!tabId) {
        sendResponse({ ok: false });
        return;
      }
      chrome.storage.local.get(DEFAULT_STATE, async (data) => {
        const pickState = data.pickState || {};
        delete pickState[tabId];
        await chrome.storage.local.set({ pickState });
        await setBadge(tabId, false);
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'PICK_MODE', enabled: false });
        } catch (e) {}
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'STOP_PICK': {
      // 供侧边栏在焦点不在页面时停止拾取（等价于页面里按 Esc）
      const tabId = msg.tabId;
      if (!tabId) {
        sendResponse({ ok: false });
        return;
      }
      chrome.storage.local.get(DEFAULT_STATE, async (data) => {
        const pickState = data.pickState || {};
        delete pickState[tabId];
        await chrome.storage.local.set({ pickState });
        await setBadge(tabId, false);
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'PICK_MODE', enabled: false });
        } catch (e) {}
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'BROWSE_MODE_CHANGED': {
      const tabId = sender.tab && sender.tab.id;
      if (!tabId) {
        sendResponse({ ok: false });
        return;
      }
      // 广播到该标签页所有 frame，让每一层的高亮一起隐藏/恢复
      chrome.tabs.sendMessage(tabId, { type: 'BROWSE_MODE', enabled: !!msg.enabled }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    case 'GET_PICK_STATE': {
      const tabId = sender.tab && sender.tab.id;
      chrome.storage.local.get(DEFAULT_STATE, (data) => {
        const pickState = data.pickState || {};
        sendResponse({ enabled: tabId ? !!pickState[tabId] : false });
      });
      return true;
    }

    case 'CAPTURE_RESULT': {
      const payload = msg.payload || {};
      const tab = sender.tab || {};
      if (tab.url) payload.page = Object.assign({}, payload.page, { url: tab.url });
      if (tab.title) payload.page = Object.assign({}, payload.page, { title: tab.title });
      chrome.storage.local.get(DEFAULT_STATE, async (data) => {
        const elements = Array.isArray(data.elements) ? data.elements : [];
        let maxN = 0;
        for (const e of elements) {
          const m = /^element_(\d+)$/.exec(e.name || '');
          if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
        }
        payload.name = 'element_' + (maxN + 1);
        elements.unshift(payload);
        if (elements.length > 500) elements.length = 500;
        await chrome.storage.local.set({ elements });
        notifyUI();
        // 强制命名设置：弹出页面中央命名窗（预填建议名并选中）
        const settings = await chrome.storage.local.get({ autoFocusOnCapture: false });
        if (settings.autoFocusOnCapture) {
          try {
            await chrome.tabs.sendMessage(sender.tab.id, {
              type: 'NAMING_REQ',
              element: {
                id: payload.id,
                name: payload.name,
                suggestedName: suggestName(payload.element),
                element: payload.element
              }
            }, { frameId: 0 });
          } catch (e) {}
        }
        const tag = payload.element && payload.element.tag;
        const frameCount = Array.isArray(payload.frame_path) ? payload.frame_path.length : 0;
        const toast =
          '✓ 已捕捉 ' + payload.name +
          (tag ? ' · <' + tag + '>' : '') +
          (frameCount ? ' · iframe×' + frameCount : '');
        try {
          await chrome.tabs.sendMessage(
            sender.tab.id,
            { type: 'PICK_FEEDBACK', toast, count: elements.length },
            { frameId: 0 }
          );
        } catch (e) {}
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'DELETE_ELEMENT': {
      const id = msg.id;
      chrome.storage.local.get(DEFAULT_STATE, async (data) => {
        const elements = (data.elements || []).filter((e) => e.id !== id);
        await chrome.storage.local.set({ elements });
        notifyUI();
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'UPDATE_ELEMENT': {
      const id = msg.id;
      const patch = msg.patch || {};
      chrome.storage.local.get(DEFAULT_STATE, async (data) => {
        const elements = (data.elements || []).map((e) => (e.id === id ? Object.assign({}, e, patch) : e));
        await chrome.storage.local.set({ elements });
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'NAME_ELEMENT': {
      const id = msg.id;
      const rawName = (msg.name || '').trim();
      if (!id || !rawName) {
        sendResponse({ ok: false, error: '缺少 id 或名称' });
        return;
      }
      chrome.storage.local.get(DEFAULT_STATE, async (data) => {
        const elements = data.elements || [];
        const others = elements.filter((e) => e.id !== id).map((e) => e.name);
        let name = rawName;
        let base = name;
        let n = 2;
        while (others.includes(name)) {
          name = base + '_' + n;
          n++;
        }
        const updated = elements.map((e) => {
          if (e.id === id) {
            return Object.assign({}, e, { name });
          }
          return e;
        });
        await chrome.storage.local.set({ elements: updated });
        notifyUI();
        sendResponse({ ok: true, name });
      });
      return true;
    }

    case 'CLEAR_ELEMENTS': {
      chrome.storage.local.set({ elements: [] }, () => {
        notifyUI();
        sendResponse({ ok: true });
      });
      return true;
    }

  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.local.get(DEFAULT_STATE);
  const pickState = data.pickState || {};
  if (pickState[tabId]) {
    delete pickState[tabId];
    await chrome.storage.local.set({ pickState });
  }
});
