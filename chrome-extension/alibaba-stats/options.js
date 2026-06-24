const DEFAULT_SHOP_COUNT = 3;
const shopsContainer = document.querySelector('#shops');
const statusElement = document.querySelector('#status');

document.addEventListener('DOMContentLoaded', restoreOptions);
document.querySelector('#save').addEventListener('click', saveOptions);
shopsContainer.addEventListener('click', handlePickButtonClick);
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

async function restoreOptions() {
  const { settings } = await chrome.storage.sync.get('settings');
  const current = settings || {
    runHour: 17,
    runMinute: 0,
    outputTarget: 'wps',
    outputPrefix: 'alibaba-daily-stats',
    waitAfterLoadMs: 8000,
    wps: {},
    shops: []
  };

  document.querySelector('#runHour').value = current.runHour ?? 17;
  document.querySelector('#runMinute').value = current.runMinute ?? 0;
  const wps = current.wps || {};
  document.querySelector('#outputTarget').value = current.outputTarget || (wps.enabled ? 'wps' : 'wps');
  document.querySelector('#outputPrefix').value = current.outputPrefix || 'alibaba-daily-stats';
  document.querySelector('#waitAfterLoadMs').value = current.waitAfterLoadMs || 8000;
  document.querySelector('#wpsAccessToken').value = wps.accessToken || '';
  document.querySelector('#wpsFileToken').value = wps.fileToken || '';
  document.querySelector('#wpsSheetIndex').value = wps.sheetIndex ?? 0;
  document.querySelector('#wpsStartRow').value = wps.startRow ?? 1;
  document.querySelector('#wpsStartColumn').value = wps.startColumn ?? 0;
  document.querySelector('#wpsIncludeHeader').value = String(wps.includeHeader ?? true);
  document.querySelector('#wpsDownloadCsvBackup').value = String(wps.downloadCsvBackup ?? false);

  const shops = [...(current.shops || [])];
  while (shops.length < DEFAULT_SHOP_COUNT) {
    shops.push({ name: `店铺${shops.length + 1}`, url: '', inquirySelector: '', tmSelector: '' });
  }

  shopsContainer.innerHTML = shops.slice(0, DEFAULT_SHOP_COUNT).map(renderShop).join('');
}

function renderShop(shop, index) {
  return `
    <section class="shop" data-index="${index}">
      <h2>店铺 ${index + 1}</h2>
      <label>店铺名称</label>
      <input class="shop-name" value="${escapeHtml(shop.name || '')}">
      <label>数据页面 URL</label>
      <input class="shop-url" value="${escapeHtml(shop.url || '')}" placeholder="https://...">
      <label>询盘数 CSS 选择器</label>
      <div class="selector-row">
        <input class="shop-inquiry" value="${escapeHtml(shop.inquirySelector || '')}" placeholder="点击右侧按钮后，在页面上点数字">
        <button type="button" class="pick-selector" data-field="inquirySelector">点选询盘数</button>
      </div>
      <label>TM 数 CSS 选择器</label>
      <div class="selector-row">
        <input class="shop-tm" value="${escapeHtml(shop.tmSelector || '')}" placeholder="点击右侧按钮后，在页面上点数字">
        <button type="button" class="pick-selector" data-field="tmSelector">点选 TM 数</button>
      </div>
    </section>
  `;
}


async function handlePickButtonClick(event) {
  const button = event.target.closest('.pick-selector');
  if (!button) {
    return;
  }

  const section = button.closest('.shop');
  const shopIndex = Number(section.dataset.index);
  const url = section.querySelector('.shop-url').value.trim();
  const shopName = section.querySelector('.shop-name').value.trim() || `店铺${shopIndex + 1}`;

  if (!url) {
    statusElement.textContent = '请先填写这个店铺的数据页面 URL';
    return;
  }

  await saveOptions();
  statusElement.textContent = `已打开 ${shopName} 页面，请点击要统计的数字，按 Esc 可取消`;
  const response = await chrome.runtime.sendMessage({
    type: 'OPEN_SELECTOR_PICKER',
    payload: {
      shopIndex,
      shopName,
      url,
      field: button.dataset.field
    }
  });

  if (!response?.ok) {
    statusElement.textContent = `打开点选模式失败：${response?.error || '未知错误'}`;
  }
}

function handleRuntimeMessage(message) {
  if (message?.type === 'SELECTOR_PICKED') {
    applyPickedSelector(message.payload);
  }

  if (message?.type === 'SELECTOR_PICK_CANCELLED') {
    statusElement.textContent = '已取消点选';
  }
}

async function applyPickedSelector(payload) {
  const section = document.querySelector(`.shop[data-index="${payload.shopIndex}"]`);
  if (!section) {
    return;
  }

  const input = payload.field === 'inquirySelector'
    ? section.querySelector('.shop-inquiry')
    : section.querySelector('.shop-tm');
  input.value = payload.selector;
  await saveOptions();
  statusElement.textContent = `已选择 ${payload.shopName || ''} 的${payload.field === 'inquirySelector' ? '询盘数' : 'TM 数'}：${payload.sampleText || payload.selector}`;
}

async function saveOptions() {
  const settings = {
    runHour: clampNumber(document.querySelector('#runHour').value, 0, 23, 17),
    runMinute: clampNumber(document.querySelector('#runMinute').value, 0, 59, 0),
    outputTarget: document.querySelector('#outputTarget').value,
    outputPrefix: sanitizeFilename(document.querySelector('#outputPrefix').value) || 'alibaba-daily-stats',
    waitAfterLoadMs: clampNumber(document.querySelector('#waitAfterLoadMs').value, 1000, 120000, 8000),
    wps: {
      enabled: document.querySelector('#outputTarget').value === 'wps',
      accessToken: document.querySelector('#wpsAccessToken').value.trim(),
      fileToken: document.querySelector('#wpsFileToken').value.trim(),
      sheetIndex: clampNumber(document.querySelector('#wpsSheetIndex').value, 0, 1000, 0),
      startRow: clampNumber(document.querySelector('#wpsStartRow').value, 0, 1000000, 1),
      startColumn: clampNumber(document.querySelector('#wpsStartColumn').value, 0, 16383, 0),
      includeHeader: document.querySelector('#wpsIncludeHeader').value === 'true',
      downloadCsvBackup: document.querySelector('#wpsDownloadCsvBackup').value === 'true'
    },
    shops: [...document.querySelectorAll('.shop')].map((section) => ({
      name: section.querySelector('.shop-name').value.trim(),
      url: section.querySelector('.shop-url').value.trim(),
      inquirySelector: section.querySelector('.shop-inquiry').value.trim(),
      tmSelector: section.querySelector('.shop-tm').value.trim()
    }))
  };

  await chrome.storage.sync.set({ settings });
  await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
  statusElement.textContent = '已保存，并重新设置定时任务';
  setTimeout(() => { statusElement.textContent = ''; }, 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[char]));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function sanitizeFilename(value) {
  return String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
}
