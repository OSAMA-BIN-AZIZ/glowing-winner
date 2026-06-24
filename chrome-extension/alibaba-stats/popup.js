document.addEventListener('DOMContentLoaded', async () => {
  const { nextRunAt } = await chrome.storage.local.get('nextRunAt');
  document.querySelector('#nextRun').textContent = nextRunAt
    ? `下次自动运行：${new Date(nextRunAt).toLocaleString()}`
    : '尚未设置定时任务，请先保存设置。';
});

document.querySelector('#runNow').addEventListener('click', async () => {
  const status = document.querySelector('#status');
  status.textContent = '正在采集...';
  const response = await chrome.runtime.sendMessage({ type: 'RUN_NOW' });
  status.textContent = JSON.stringify(response, null, 2);
});
