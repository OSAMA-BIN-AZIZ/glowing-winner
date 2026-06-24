let pickerState;
let highlightElement;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'EXTRACT_ALIBABA_STATS') {
    const { shop } = message;
    const inquiries = readNumber(shop.inquirySelector);
    const tm = readNumber(shop.tmSelector);

    sendResponse({
      inquiries,
      tm,
      status: inquiries === '' && tm === '' ? '未匹配到选择器，请检查配置' : '已读取'
    });
    return true;
  }

  if (message?.type === 'START_SELECTOR_PICK') {
    startSelectorPicker(message.payload);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

function readNumber(selector) {
  if (!selector) {
    return '';
  }

  const element = document.querySelector(selector);
  if (!element) {
    return '';
  }

  const text = element.textContent || element.getAttribute('value') || '';
  const match = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? match[0] : text.trim();
}

function startSelectorPicker(payload) {
  stopSelectorPicker();
  pickerState = payload;
  ensurePickerHint();
  document.addEventListener('mouseover', handlePickerMouseOver, true);
  document.addEventListener('mouseout', handlePickerMouseOut, true);
  document.addEventListener('click', handlePickerClick, true);
  document.addEventListener('keydown', handlePickerKeydown, true);
}

function stopSelectorPicker() {
  document.removeEventListener('mouseover', handlePickerMouseOver, true);
  document.removeEventListener('mouseout', handlePickerMouseOut, true);
  document.removeEventListener('click', handlePickerClick, true);
  document.removeEventListener('keydown', handlePickerKeydown, true);
  clearHighlight();
  document.querySelector('#alibaba-stats-picker-hint')?.remove();
  pickerState = undefined;
}

function handlePickerMouseOver(event) {
  if (!pickerState || isPickerUi(event.target)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  highlight(event.target);
}

function handlePickerMouseOut(event) {
  if (!pickerState || isPickerUi(event.target)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function handlePickerClick(event) {
  if (!pickerState || isPickerUi(event.target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const selector = buildUniqueSelector(event.target);
  const sampleText = (event.target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  chrome.runtime.sendMessage({
    type: 'SELECTOR_PICKED',
    payload: {
      ...pickerState,
      selector,
      sampleText
    }
  });
  stopSelectorPicker();
}

function handlePickerKeydown(event) {
  if (event.key !== 'Escape') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  chrome.runtime.sendMessage({
    type: 'SELECTOR_PICK_CANCELLED',
    payload: pickerState
  });
  stopSelectorPicker();
}

function highlight(element) {
  if (highlightElement === element) {
    return;
  }
  clearHighlight();
  highlightElement = element;
  highlightElement.dataset.alibabaStatsPreviousOutline = highlightElement.style.outline || '';
  highlightElement.dataset.alibabaStatsPreviousCursor = highlightElement.style.cursor || '';
  highlightElement.style.outline = '3px solid #ff7a00';
  highlightElement.style.cursor = 'crosshair';
}

function clearHighlight() {
  if (!highlightElement) {
    return;
  }
  highlightElement.style.outline = highlightElement.dataset.alibabaStatsPreviousOutline || '';
  highlightElement.style.cursor = highlightElement.dataset.alibabaStatsPreviousCursor || '';
  delete highlightElement.dataset.alibabaStatsPreviousOutline;
  delete highlightElement.dataset.alibabaStatsPreviousCursor;
  highlightElement = undefined;
}

function ensurePickerHint() {
  const hint = document.createElement('div');
  hint.id = 'alibaba-stats-picker-hint';
  hint.textContent = '请点击要统计的数字，按 Esc 取消';
  hint.style.cssText = [
    'position: fixed',
    'z-index: 2147483647',
    'top: 16px',
    'left: 50%',
    'transform: translateX(-50%)',
    'background: #111827',
    'color: #fff',
    'padding: 10px 14px',
    'border-radius: 8px',
    'font-size: 14px',
    'box-shadow: 0 8px 24px rgba(0,0,0,.24)',
    'pointer-events: none'
  ].join(';');
  document.body.appendChild(hint);
}

function isPickerUi(element) {
  return element?.id === 'alibaba-stats-picker-hint';
}

function buildUniqueSelector(element) {
  if (element.id && isUniqueSelector(`#${cssEscape(element.id)}`)) {
    return `#${cssEscape(element.id)}`;
  }

  const stableAttributeSelector = getStableAttributeSelector(element);
  if (stableAttributeSelector && isUniqueSelector(stableAttributeSelector)) {
    return stableAttributeSelector;
  }

  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let part = current.tagName.toLowerCase();
    const classSelector = getStableClassSelector(current);
    if (classSelector) {
      part += classSelector;
    }

    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = [...parent.children].filter((child) => child.tagName === current.tagName);
      if (sameTagSiblings.length > 1) {
        part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
    }

    parts.unshift(part);
    const selector = parts.join(' > ');
    if (isUniqueSelector(selector)) {
      return selector;
    }
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function getStableAttributeSelector(element) {
  const attributes = ['data-testid', 'data-test', 'data-role', 'aria-label', 'name'];
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    if (value) {
      return `${element.tagName.toLowerCase()}[${attribute}="${cssEscape(value)}"]`;
    }
  }
  return '';
}

function getStableClassSelector(element) {
  const classes = [...element.classList].filter((className) => !/^\d/.test(className));
  return classes.slice(0, 2).map((className) => `.${cssEscape(className)}`).join('');
}

function isUniqueSelector(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch (_error) {
    return false;
  }
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
