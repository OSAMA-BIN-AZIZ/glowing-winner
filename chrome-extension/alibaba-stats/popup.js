document.addEventListener('DOMContentLoaded', async () => {
  const { nextRunAt } = await chrome.storage.local.get('nextRunAt');
  document.querySelector('#nextRun').textContent = nextRunAt
    ? `下次自动运行：${new Date(nextRunAt).toLocaleString()}`
    : '尚未设置定时任务，请先保存设置。';
});

document.querySelector('#runNow').addEventListener('click', async () => {
  const status = document.querySelector('#status');
  const button = document.querySelector('#runNow');
  status.textContent = '正在采集...';
  button.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'RUN_NOW' });
    status.textContent = JSON.stringify(response, null, 2);
  } catch (error) {
    status.textContent = `采集失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
});
