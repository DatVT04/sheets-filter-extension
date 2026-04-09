// ── State ──────────────────────────────────────────────
let conditions = [];
let selectedColor = '#fef08a';
let conditionIdCounter = 0;
let currentTabId = null;

const OPERATORS = [
  { value: 'smart',        label: '🔍 tìm thông minh' },
  { value: 'contains',     label: 'chứa' },
  { value: 'not_contains', label: 'không chứa' },
  { value: 'equals',       label: '= bằng' },
  { value: 'not_equals',   label: '≠ khác' },
  { value: 'gt',           label: '> lớn hơn' },
  { value: 'lt',           label: '< nhỏ hơn' },
  { value: 'gte',          label: '≥ lớn hơn bằng' },
  { value: 'lte',          label: '≤ nhỏ hơn bằng' },
  { value: 'empty',        label: 'trống' },
  { value: 'not_empty',    label: 'không trống' },
  { value: 'starts_with',  label: 'bắt đầu bằng' },
  { value: 'ends_with',    label: 'kết thúc bằng' },
];

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkIfOnSheets();
  loadSavedState();
  setupColorSwatches();

  if (conditions.length === 0) addCondition();

  document.getElementById('addConditionBtn').addEventListener('click', addCondition);
  document.getElementById('applyBtn').addEventListener('click', applyFilter);
  document.getElementById('clearBtn').addEventListener('click', clearFilter);
  document.getElementById('controls-toggle').addEventListener('click', toggleControls);
});

// ── Check tab ──────────────────────────────────────────
async function checkIfOnSheets() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  const isSheets = tab?.url?.includes('docs.google.com/spreadsheets');
  document.getElementById('notSheets').style.display   = isSheets ? 'none'  : 'flex';
  document.getElementById('mainUI').style.display      = isSheets ? 'flex'  : 'none';
  document.getElementById('statusDot').classList.toggle('active', isSheets);
}

// ── Storage ────────────────────────────────────────────
function saveState() {
  chrome.storage.local.set({ conditions, selectedColor });
}

function loadSavedState() {
  chrome.storage.local.get(['conditions', 'selectedColor', 'controlsCollapsed'], (data) => {
    if (data.conditions?.length) {
      conditions = data.conditions;
      renderConditions();
    }
    if (data.selectedColor) {
      selectedColor = data.selectedColor;
      document.querySelectorAll('.swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === selectedColor);
      });
    }
    if (data.controlsCollapsed) {
      document.getElementById('controls').classList.add('collapsed');
      document.getElementById('controls-toggle').classList.add('collapsed');
    }
  });
}

// ── Color swatches ─────────────────────────────────────
function setupColorSwatches() {
  document.getElementById('colorSwatches').addEventListener('click', (e) => {
    const swatch = e.target.closest('.swatch');
    if (!swatch) return;
    selectedColor = swatch.dataset.color;
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    swatch.classList.add('selected');
    saveState();
  });
}

// ── Conditions ─────────────────────────────────────────
function addCondition(logic = 'AND') {
  const cond = {
    id: ++conditionIdCounter,
    column: 'A',
    operator: 'contains',
    value: '',
    logic: conditions.length === 0 ? null : logic,
  };
  conditions.push(cond);
  renderConditions();
  saveState();
}

function removeCondition(id) {
  conditions = conditions.filter(c => c.id !== id);
  if (conditions.length > 0) conditions[0].logic = null;
  renderConditions();
  saveState();
}

function renderConditions() {
  const list = document.getElementById('conditions-list');
  list.innerHTML = '';

  conditions.forEach((cond, idx) => {
    const card = document.createElement('div');
    card.className = 'condition-card';
    card.dataset.id = cond.id;

    const needsValue = !['empty', 'not_empty'].includes(cond.operator);

    card.innerHTML = `
      ${idx > 0 ? `<span class="logic-badge ${cond.logic === 'OR' ? 'or' : ''}" data-id="${cond.id}" title="Click để đổi AND/OR">${cond.logic}</span>` : ''}
      <div class="condition-row">
        <input type="text" class="col-input" value="${cond.column}" placeholder="Cột" data-id="${cond.id}" maxlength="3">
        <select class="op-select" data-id="${cond.id}">
          ${OPERATORS.map(op => `<option value="${op.value}" ${op.value === cond.operator ? 'selected' : ''}>${op.label}</option>`).join('')}
        </select>
        <input type="text" class="val-input" value="${cond.value}" placeholder="Giá trị" data-id="${cond.id}" ${needsValue ? '' : 'disabled style="opacity:0.3"'}>
        <button class="remove-btn" data-id="${cond.id}" title="Xóa">×</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.col-input').forEach(el => {
    el.addEventListener('input', (e) => updateCondition(+e.target.dataset.id, 'column', e.target.value.toUpperCase()));
  });
  list.querySelectorAll('.op-select').forEach(el => {
    el.addEventListener('change', (e) => {
      updateCondition(+e.target.dataset.id, 'operator', e.target.value);
      renderConditions();
    });
  });
  list.querySelectorAll('.val-input').forEach(el => {
    el.addEventListener('input', (e) => updateCondition(+e.target.dataset.id, 'value', e.target.value));
  });
  list.querySelectorAll('.remove-btn').forEach(el => {
    el.addEventListener('click', (e) => removeCondition(+e.target.dataset.id));
  });
  list.querySelectorAll('.logic-badge').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = +e.target.dataset.id;
      const cond = conditions.find(c => c.id === id);
      if (cond) {
        cond.logic = cond.logic === 'AND' ? 'OR' : 'AND';
        saveState();
        renderConditions();
      }
    });
  });
}

function updateCondition(id, field, value) {
  const cond = conditions.find(c => c.id === id);
  if (cond) { cond[field] = value; saveState(); }
}

// ── Apply filter (auto-detects DOM vs clipboard mode) ──
async function applyFilter() {
  const btn = document.getElementById('applyBtn');
  btn.textContent = '⏳ Đang xử lý...';
  btn.disabled = true;

  const validConditions = getValidConditions();
  if (validConditions.length === 0) {
    showToast('⚠️ Hãy điền ít nhất 1 điều kiện hợp lệ');
    btn.textContent = '▶ Áp dụng';
    btn.disabled = false;
    return;
  }

  if (!currentTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
  }

  // Step 1: try DOM mode
  chrome.tabs.sendMessage(currentTabId, {
    action: 'applyFilter',
    conditions: validConditions,
    color: selectedColor,
  }, async (domResponse) => {
    if (chrome.runtime.lastError) {
      btn.textContent = '▶ Áp dụng';
      btn.disabled = false;
      showToast('❌ Lỗi kết nối. Thử reload trang!');
      return;
    }

    // DOM mode succeeded
    if (domResponse?.success) {
      btn.textContent = '▶ Áp dụng';
      btn.disabled = false;
      showStats(domResponse);
      showRankedResults(domResponse);
      showToast(`✅ Highlight ${domResponse.matched}/${domResponse.total} dòng`);
      return;
    }

    // Step 2: canvas mode detected → auto read clipboard
    if (domResponse?.canvasMode) {
      btn.textContent = '⏳ Đọc Clipboard...';

      let clipboardText = '';
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch {
        btn.textContent = '▶ Áp dụng';
        btn.disabled = false;
        showToast('⚠️ Cần Ctrl+A → Ctrl+C trong Sheet trước, rồi nhấn lại.');
        return;
      }

      if (!clipboardText || !clipboardText.includes('\t')) {
        btn.textContent = '▶ Áp dụng';
        btn.disabled = false;
        showToast('⚠️ Clipboard trống. Ctrl+A → Ctrl+C trong Sheet rồi nhấn lại.');
        return;
      }

      chrome.tabs.sendMessage(currentTabId, {
        action: 'applyFilterFromClipboard',
        conditions: validConditions,
        color: selectedColor,
        clipboardText,
      }, (response) => {
        btn.textContent = '▶ Áp dụng';
        btn.disabled = false;

        if (chrome.runtime.lastError) {
          showToast('❌ Lỗi kết nối. Thử reload trang!');
          return;
        }
        if (response?.success) {
          showStats(response);
          showRankedResults(response);
          showToast(`✅ Tìm được ${response.matched}/${response.total} dòng`);
        } else {
          showToast('❌ ' + (response?.error || 'Có lỗi xảy ra'));
        }
      });
      return;
    }

    btn.textContent = '▶ Áp dụng';
    btn.disabled = false;
    showToast('❌ ' + (domResponse?.error || 'Có lỗi xảy ra'));
  });
}

// ── Helpers ────────────────────────────────────────────
function getValidConditions() {
  return conditions.filter(c => {
    if (['empty', 'not_empty'].includes(c.operator)) return c.column.trim();
    return c.column.trim() && c.value.trim() !== '';
  });
}

// ── Toggle controls panel ──────────────────────────────
function toggleControls() {
  const toggle   = document.getElementById('controls-toggle');
  const controls = document.getElementById('controls');
  const collapsed = controls.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed', collapsed);
  chrome.storage.local.set({ controlsCollapsed: collapsed });
}

// ── Navigate to row in Sheets ──────────────────────────
function navigateToRow(rowNum) {
  if (!currentTabId) return;
  chrome.tabs.sendMessage(currentTabId, { action: 'navigateToRow', rowNum });
}

// ── Show stats ─────────────────────────────────────────
function showStats(response) {
  document.getElementById('statMatched').textContent = response.matched;
  document.getElementById('statTotal').textContent   = response.total;
  document.getElementById('statCols').textContent    = response.cols;
  document.getElementById('statsBar').classList.add('visible');
}

// ── Ranked results ─────────────────────────────────────
function buildHighlightedHTML(text, highlights) {
  if (!highlights || highlights.length === 0) return escapeHTML(text);

  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const h of sorted) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.start + last.len) {
      last.len = Math.max(last.len, h.start + h.len - last.start);
    } else {
      merged.push({ ...h });
    }
  }

  let html = '';
  let i = 0;
  let mIdx = 0;
  while (i < text.length && mIdx < merged.length) {
    const m = merged[mIdx];
    if (i < m.start) {
      html += escapeHTML(text.slice(i, m.start));
      i = m.start;
    } else {
      const end = Math.min(m.start + m.len, text.length);
      html += `<mark>${escapeHTML(text.slice(i, end))}</mark>`;
      i = end;
      mIdx++;
    }
  }
  if (i < text.length) html += escapeHTML(text.slice(i));
  return html;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function indexToColLetter(idx) {
  let letter = '';
  idx += 1;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    idx = Math.floor((idx - 1) / 26);
  }
  return letter;
}

function showRankedResults(response) {
  const panel     = document.getElementById('rankedResults');
  const list      = document.getElementById('rankedList');
  const emptyEl   = document.getElementById('resultsEmpty');
  const hasResults = response.rankedResults?.length > 0;

  emptyEl.style.display = hasResults ? 'none' : 'flex';

  if (!hasResults) {
    panel.style.display = 'none';
    return;
  }

  const hasSmartCondition = response.hasSmartCondition;
  list.innerHTML = '';

  response.rankedResults.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'ranked-row';
    row.dataset.rownum = item.rowNum;
    row.title = `Click để nhảy đến dòng ${item.rowNum}`;

    const cellHTMLs = Object.entries(item.preview).map(([colIdx, text]) => {
      const highlights = item.highlights?.[colIdx];
      const cellHTML   = buildHighlightedHTML(text, highlights);
      const colLetter  = indexToColLetter(+colIdx);
      return `<span class="ranked-col-label">${colLetter}:</span> <span class="ranked-cell">${cellHTML}</span>`;
    });

    const scoreTag = hasSmartCondition
      ? `<span class="ranked-score">${item.score}pt</span>`
      : '';

    row.innerHTML = `
      <div class="ranked-meta">
        <span class="ranked-rownum">Dòng ${item.rowNum}</span>
        ${scoreTag}
        <span class="goto-icon">↗</span>
      </div>
      <div class="ranked-cells">${cellHTMLs.join('<br>')}</div>
    `;

    // Click → navigate to that row in the sheet
    row.addEventListener('click', () => {
      navigateToRow(item.rowNum);
      // Brief visual feedback
      row.style.background = 'rgba(124,106,247,0.18)';
      setTimeout(() => { row.style.background = ''; }, 400);
    });

    list.appendChild(row);
  });

  const total   = response.rankedResults.length;
  const matched = response.matched;
  document.getElementById('rankedHeaderLabel').textContent =
    `${total}${matched > total ? `/${matched}` : ''} dòng khớp${hasSmartCondition ? ' · xếp theo độ khớp' : ''}`;
  panel.style.display = 'flex';
}

// ── Clear ──────────────────────────────────────────────
async function clearFilter() {
  if (!currentTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
  }
  chrome.tabs.sendMessage(currentTabId, { action: 'clearFilter' }, () => {
    if (chrome.runtime.lastError) {
      showToast('❌ Lỗi kết nối. Thử reload trang!');
      return;
    }
    document.getElementById('statsBar').classList.remove('visible');
    document.getElementById('rankedResults').style.display = 'none';
    document.getElementById('resultsEmpty').style.display  = 'flex';
    showToast('🗑️ Đã xóa toàn bộ highlight');
  });
}

// ── Toast ──────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
