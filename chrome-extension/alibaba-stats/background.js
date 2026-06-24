const DEFAULT_SETTINGS = {
  runHour: 17,
  runMinute: 0,
  outputPrefix: 'alibaba-daily-stats',
  waitAfterLoadMs: 8000,
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

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  }
  await scheduleDailyAlarm(settings || DEFAULT_SETTINGS);
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
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
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
  next.setHours(Number(hour), Number(minute), 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function runCollection(trigger) {
  const settings = await getSettings();
  const date = formatDate(new Date());
  const records = [];

  for (const shop of settings.shops.filter((item) => item.name && item.url)) {
    const record = await collectShop(shop, settings.waitAfterLoadMs, date);
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

  await saveRunHistory({ trigger, date, records });
  await downloadCsv(settings.outputPrefix, date, records);
  return { date, count: records.length, records };
}

async function collectShop(shop, waitAfterLoadMs, date) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: shop.url, active: false });
    await waitForTabComplete(tab.id);
    await delay(Number(waitAfterLoadMs) || 8000);
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

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
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
  await chrome.downloads.download({
    url,
    filename: `${prefix}-${date}.csv`,
    conflictAction: 'uniquify',
    saveAs: false
  });
}

function toCsv(records) {
  const header = ['日期', '店铺', '询盘数', 'TM数', '来源页面', '状态', '采集时间'];
  const rows = records.map((item) => [
    item.date,
    item.shop,
    item.inquiries,
    item.tm,
    item.sourceUrl,
    item.status,
    item.collectedAt
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
