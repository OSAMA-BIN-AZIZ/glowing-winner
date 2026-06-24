const DEFAULT_SETTINGS = {
  runHour: 17,
  runMinute: 0,
  outputTarget: 'wps',
  outputPrefix: 'alibaba-daily-stats',
  waitAfterLoadMs: 8000,
  wps: {
    enabled: true,
    accessToken: '',
    fileToken: '',
    sheetIndex: 0,
    startRow: 1,
    startColumn: 0,
    includeHeader: true,
    downloadCsvBackup: false
  },
  shops: [
    {
      name: '店铺A',
      url: 'https://www.alibaba.com/',
      inquirySelector: '',
      tmSelector: ''
    },
    {
      name: '店铺B',
      url: 'https://www.alibaba.com/',
      inquirySelector: '',
      tmSelector: ''
    },
    {
      name: '店铺C',
      url: 'https://www.alibaba.com/',
      inquirySelector: '',
      tmSelector: ''
    }
  ]
};

const ALARM_NAME = 'daily-alibaba-stats';
const WPS_API_ORIGIN = 'https://developer.kdocs.cn';
const CSV_HEADER = ['日期', '店铺', '询盘数', 'TM数', '来源页面', '状态', '采集时间'];

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  const normalizedSettings = normalizeSettings(settings);
  if (!settings) {
    await chrome.storage.sync.set({ settings: normalizedSettings });
  }
  await scheduleDailyAlarm(normalizedSettings);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await scheduleDailyAlarm(settings);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await runCollection('alarm');
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'RUN_NOW') {
    runCollection('manual')
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'RESCHEDULE') {
    getSettings()
      .then(scheduleDailyAlarm)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'OPEN_SELECTOR_PICKER') {
    openSelectorPicker(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function openSelectorPicker(payload) {
  const tab = await chrome.tabs.create({ url: payload.url, active: true });
  await waitForTabComplete(tab.id);
  await delay(1000);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await chrome.tabs.sendMessage(tab.id, {
    type: 'START_SELECTOR_PICK',
    payload: {
      shopIndex: payload.shopIndex,
      field: payload.field,
      shopName: payload.shopName
    }
  });
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return normalizeSettings(settings);
}

function normalizeSettings(settings = {}) {
  const shops = Array.isArray(settings.shops) ? settings.shops : [];
  const wps = { ...DEFAULT_SETTINGS.wps, ...(settings.wps || {}) };
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    outputTarget: settings.outputTarget || (settings.wps?.enabled ? 'wps' : DEFAULT_SETTINGS.outputTarget),
    wps: {
      ...wps,
      sheetIndex: clampNumber(wps.sheetIndex, 0, 1000, DEFAULT_SETTINGS.wps.sheetIndex),
      startRow: clampNumber(wps.startRow, 0, 1000000, DEFAULT_SETTINGS.wps.startRow),
      startColumn: clampNumber(wps.startColumn, 0, 16383, DEFAULT_SETTINGS.wps.startColumn)
    },
    shops: DEFAULT_SETTINGS.shops.map((defaultShop, index) => ({
      ...defaultShop,
      ...(shops[index] || {})
    }))
  };
}

async function scheduleDailyAlarm(settings) {
  const nextRun = getNextRunTime(settings.runHour, settings.runMinute);
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, {
    when: nextRun.getTime(),
    periodInMinutes: 24 * 60
  });
  await chrome.storage.local.set({ nextRunAt: nextRun.toISOString() });
}

function getNextRunTime(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(
    clampNumber(hour, 0, 23, DEFAULT_SETTINGS.runHour),
    clampNumber(minute, 0, 59, DEFAULT_SETTINGS.runMinute),
    0,
    0
  );
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function runCollection(trigger) {
  const settings = await getSettings();
  const waitAfterLoadMs = clampNumber(settings.waitAfterLoadMs, 1000, 120000, DEFAULT_SETTINGS.waitAfterLoadMs);
  const date = formatDate(new Date());
  const records = [];

  for (const shop of settings.shops.filter((item) => item.name && item.url)) {
    const record = await collectShop(shop, waitAfterLoadMs, date);
    records.push(record);
  }

  const totals = records.reduce(
    (acc, item) => {
      acc.inquiries += Number(item.inquiries || 0);
      acc.tm += Number(item.tm || 0);
      return acc;
    },
    { inquiries: 0, tm: 0 }
  );

  records.push({
    date,
    shop: '合计',
    inquiries: totals.inquiries,
    tm: totals.tm,
    sourceUrl: '',
    status: '汇总',
    collectedAt: new Date().toISOString()
  });

  const output = await writeOutput(settings, date, records);
  await saveRunHistory({ trigger, date, output, records });
  return { date, count: records.length, output, records };
}

async function writeOutput(settings, date, records) {
  if (settings.outputTarget === 'wps') {
    const wpsResult = await writeWpsSheet(settings.wps, records);
    if (settings.wps.downloadCsvBackup) {
      await downloadCsv(settings.outputPrefix, date, records);
    }
    return {
      type: 'wps',
      message: `已写入 WPS 云文档 ${wpsResult.updatedCells} 个单元格`,
      ...wpsResult
    };
  }

  await downloadCsv(settings.outputPrefix, date, records);
  return { type: 'csv', message: '已下载 CSV 文件' };
}

async function collectShop(shop, waitAfterLoadMs, date) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: shop.url, active: false });
    await waitForTabComplete(tab.id);
    await delay(waitAfterLoadMs);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXTRACT_ALIBABA_STATS',
      shop
    });

    return {
      date,
      shop: shop.name,
      inquiries: response?.inquiries ?? '',
      tm: response?.tm ?? '',
      sourceUrl: shop.url,
      status: response?.status || '已读取',
      collectedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      date,
      shop: shop.name,
      inquiries: '',
      tm: '',
      sourceUrl: shop.url,
      status: `失败：${error.message}`,
      collectedAt: new Date().toISOString()
    };
  } finally {
    if (tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  }
}

async function writeWpsSheet(wps, records) {
  if (!wps.accessToken || !wps.fileToken) {
    throw new Error('请先在设置页填写 WPS access_token 和 file_token');
  }

  const rows = recordsToRows(records, wps.includeHeader);
  const ranges = rows.flatMap((row, rowIndex) => row.map((value, columnIndex) => ({
    op_type: 'formula',
    row_from: wps.startRow + rowIndex,
    row_to: wps.startRow + rowIndex,
    col_from: wps.startColumn + columnIndex,
    col_to: wps.startColumn + columnIndex,
    formula: String(value ?? '')
  })));

  const url = new URL(`/api/v1/openapi/ksheet/${encodeURIComponent(wps.fileToken)}/sheets/${wps.sheetIndex}/cells`, WPS_API_ORIGIN);
  url.searchParams.set('access_token', wps.accessToken);

  const response = await fetch(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ranges })
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`WPS 写入失败（HTTP ${response.status}）：${responseText || response.statusText}`);
  }

  return {
    updatedCells: ranges.length,
    startRow: wps.startRow,
    startColumn: wps.startColumn,
    response: parseJsonSafely(responseText)
  };
}

function recordsToRows(records, includeHeader) {
  const rows = records.map((item) => [
    item.date,
    item.shop,
    item.inquiries,
    item.tm,
    item.sourceUrl,
    item.status,
    item.collectedAt
  ]);
  return includeHeader ? [CSV_HEADER, ...rows] : rows;
}

async function waitForTabComplete(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (tab?.status === 'complete') {
    return;
  }

  await new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveRunHistory(run) {
  const { runHistory = [] } = await chrome.storage.local.get('runHistory');
  runHistory.unshift(run);
  await chrome.storage.local.set({ runHistory: runHistory.slice(0, 30), lastRun: run });
}

async function downloadCsv(prefix, date, records) {
  const csv = toCsv(records);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  try {
    await chrome.downloads.download({
      url,
      filename: `${sanitizeFilename(prefix) || DEFAULT_SETTINGS.outputPrefix}-${date}.csv`,
      conflictAction: 'uniquify',
      saveAs: false
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toCsv(records) {
  return recordsToRows(records, true).map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function parseJsonSafely(value) {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch (_error) {
    return value;
  }
}
