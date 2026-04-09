// ── Content script chạy bên trong Google Sheets ───────

(function () {
  'use strict';

  // ── Smart matching utilities ───────────────────────────

  function removeAccents(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  // Levenshtein edit distance (returns early if > maxDist)
  function editDistance(a, b, maxDist) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    const row = Array.from({ length: lb + 1 }, (_, i) => i);
    for (let i = 1; i <= la; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= lb; j++) {
        const temp = row[j];
        row[j] = a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j], row[j - 1]);
        prev = temp;
      }
    }
    return row[lb];
  }

  // Score one keyword against one cell value.
  // Returns { score: 0-100, start: charIndex|-1, len: matchLen }
  // start/len refer to positions in the *normalized* text for highlight mapping.
  function matchKeyword(kw, text) {
    const nkw  = removeAccents(kw.toLowerCase());
    const ntext = removeAccents(text.toLowerCase());

    // 1. Exact original-case contains
    const exactIdx = text.toLowerCase().indexOf(kw.toLowerCase());
    if (exactIdx >= 0) return { score: 100, start: exactIdx, len: kw.length };

    // 2. Accent-normalized contains
    const normIdx = ntext.indexOf(nkw);
    if (normIdx >= 0) return { score: 80, start: normIdx, len: nkw.length };

    // 3. Word-level fuzzy (only for keywords ≥ 3 chars to avoid noise)
    if (nkw.length >= 3) {
      const textWords = ntext.split(/(\s+)/); // keep separators for position tracking
      let pos = 0;
      let best = { score: 0, start: -1, len: 0 };
      for (const fragment of textWords) {
        const word = fragment.replace(/\s+/, '');
        if (word.length >= 2) {
          const maxDist = nkw.length <= 4 ? 1 : 2;
          const d = editDistance(nkw, word, maxDist);
          if (d <= maxDist) {
            const s = d === 1 ? 50 : 30;
            if (s > best.score) best = { score: s, start: pos, len: fragment.length };
          }
        }
        pos += fragment.length;
      }
      if (best.score > 0) return best;
    }

    return { score: 0, start: -1, len: 0 };
  }

  // Evaluate smart condition: ALL keywords must match.
  // Returns { matches: bool, score: number, highlights: [{start, len}] }
  function evalSmart(cellValue, condValue) {
    const keywords = condValue.trim().split(/\s+/).filter(k => k.length > 0);
    if (keywords.length === 0) return { matches: false, score: 0, highlights: [] };

    let totalScore = 0;
    const highlights = [];
    for (const kw of keywords) {
      const m = matchKeyword(kw, cellValue);
      if (m.score === 0) return { matches: false, score: 0, highlights: [] };
      totalScore += m.score;
      if (m.start >= 0) highlights.push({ start: m.start, len: m.len });
    }
    return { matches: true, score: totalScore, highlights };
  }

  // ── Core operators ─────────────────────────────────────

  function colLetterToIndex(letter) {
    letter = letter.toUpperCase().trim();
    let idx = 0;
    for (let i = 0; i < letter.length; i++) {
      idx = idx * 26 + (letter.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  function evalCondition(cellValue, operator, condValue) {
    const cv  = removeAccents(String(cellValue).toLowerCase().trim());
    const tv  = removeAccents(String(condValue).toLowerCase().trim());
    const numCV = parseFloat(String(cellValue).replace(/,/g, ''));
    const numTV = parseFloat(String(condValue).replace(/,/g, ''));

    switch (operator) {
      case 'contains':     return cv.includes(tv);
      case 'not_contains': return !cv.includes(tv);
      case 'equals':       return cv === tv;
      case 'not_equals':   return cv !== tv;
      case 'gt':           return !isNaN(numCV) && !isNaN(numTV) && numCV > numTV;
      case 'lt':           return !isNaN(numCV) && !isNaN(numTV) && numCV < numTV;
      case 'gte':          return !isNaN(numCV) && !isNaN(numTV) && numCV >= numTV;
      case 'lte':          return !isNaN(numCV) && !isNaN(numTV) && numCV <= numTV;
      case 'empty':        return String(cellValue).trim() === '';
      case 'not_empty':    return String(cellValue).trim() !== '';
      case 'starts_with':  return cv.startsWith(tv);
      case 'ends_with':    return cv.endsWith(tv);
      case 'smart':        return evalSmart(cellValue, condValue).matches;
      default:             return false;
    }
  }

  function evalSingleCondition(rowData, cond) {
    const colIdx = colLetterToIndex(cond.column);
    const cellValue = rowData[colIdx] !== undefined ? rowData[colIdx] : '';
    return evalCondition(cellValue, cond.operator, cond.value);
  }

  function rowMatchesConditions(rowData, conditions) {
    if (conditions.length === 0) return false;
    let result = evalSingleCondition(rowData, conditions[0]);
    for (let i = 1; i < conditions.length; i++) {
      const cond = conditions[i];
      const val  = evalSingleCondition(rowData, cond);
      result = cond.logic === 'OR' ? result || val : result && val;
    }
    return result;
  }

  // Compute aggregate score for a matching row (used for ranking).
  // Returns 0 if no smart conditions present (rows treated equally).
  function computeRowScore(rowData, conditions) {
    let score = 0;
    let hasSmartCondition = false;
    for (const cond of conditions) {
      if (cond.operator === 'smart') {
        hasSmartCondition = true;
        const colIdx = colLetterToIndex(cond.column);
        const cellValue = rowData[colIdx] !== undefined ? rowData[colIdx] : '';
        score += evalSmart(cellValue, cond.value).score;
      }
    }
    return hasSmartCondition ? score : 0;
  }

  // Compute per-cell highlight positions for popup display.
  // Returns { colIndex: [{start, len}] }
  function computeHighlights(rowData, conditions) {
    const result = {};
    for (const cond of conditions) {
      if (cond.operator !== 'smart') continue;
      const colIdx = colLetterToIndex(cond.column);
      const cellValue = rowData[colIdx] !== undefined ? rowData[colIdx] : '';
      const { highlights } = evalSmart(cellValue, cond.value);
      if (highlights.length > 0) result[colIdx] = highlights;
    }
    return result;
  }

  // ── DOM reading ────────────────────────────────────────

  function readSheetRows() {
    const result = [];
    let rowEls = document.querySelectorAll('[role="row"]');
    if (rowEls.length === 0) rowEls = document.querySelectorAll('.waffle tr');
    if (rowEls.length === 0) rowEls = document.querySelectorAll('[aria-rowindex]');
    if (rowEls.length === 0) {
      const grid = document.querySelector('[role="grid"]');
      if (grid) rowEls = grid.querySelectorAll('[role="row"]');
    }

    rowEls.forEach((rowEl, rowIdx) => {
      const cells = rowEl.querySelectorAll('[role="gridcell"], [role="columnheader"], td, th');
      const rowData = [];
      cells.forEach(cell => rowData.push(cell.textContent.trim()));
      if (rowData.length > 0) result.push({ rowIdx, cells: rowData, el: rowEl });
    });
    return result;
  }

  // ── TSV parser (for clipboard mode) ───────────────────

  // RFC 4180-compatible TSV parser: handles quoted fields with embedded newlines.
  // Google Sheets wraps multiline cells in double-quotes when copying.

  function readQuotedField(text, start) {
    let i = start + 1; // skip opening quote
    let cell = '';
    while (i < text.length) {
      if (text[i] === '"' && text[i + 1] === '"') {
        cell += '"'; i += 2;
      } else if (text[i] === '"') {
        i++; break; // closing quote
      } else {
        cell += text[i++];
      }
    }
    return { cell: cell.trim(), end: i };
  }

  function readUnquotedField(text, start) {
    let i = start;
    let cell = '';
    while (i < text.length && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') {
      cell += text[i++];
    }
    return { cell: cell.trim(), end: i };
  }

  function skipNewline(text, i) {
    if (text[i] === '\r' && text[i + 1] === '\n') return i + 2;
    return i + 1;
  }

  function parseTSV(text) {
    const rows = [];
    let row = [];
    let i = 0;

    while (i < text.length) {
      const result = text[i] === '"'
        ? readQuotedField(text, i)
        : readUnquotedField(text, i);
      row.push(result.cell);
      i = result.end;

      if (i >= text.length) break;

      if (text[i] === '\t') {
        i++;
      } else {
        i = skipNewline(text, i);
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      }
    }
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  }

  // ── Highlight rows in DOM ──────────────────────────────

  const HIGHLIGHT_CLASS = 'sfp-highlight';

  function highlightRow(rowEl, color) {
    rowEl.querySelectorAll('[role="gridcell"], td').forEach(cell => {
      cell.setAttribute('data-sfp-orig-bg', cell.style.backgroundColor || '');
      cell.style.backgroundColor = color;
      cell.classList.add(HIGHLIGHT_CLASS);
    });
    rowEl.setAttribute('data-sfp-orig-bg', rowEl.style.backgroundColor || '');
    rowEl.style.backgroundColor = color;
    rowEl.classList.add(HIGHLIGHT_CLASS);
  }

  function clearAllHighlights() {
    document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(el => {
      el.style.backgroundColor = el.getAttribute('data-sfp-orig-bg') || '';
      el.classList.remove(HIGHLIGHT_CLASS);
      el.removeAttribute('data-sfp-orig-bg');
    });
  }

  // ── Build ranked results array ─────────────────────────

  function buildRankedResults(dataRows, conditions, headerRow) {
    const scored = [];
    dataRows.forEach((cells, idx) => {
      if (!rowMatchesConditions(cells, conditions)) return;
      const score = computeRowScore(cells, conditions);
      const highlights = computeHighlights(cells, conditions);
      // Only include cells that are referenced by conditions for display
      const relevantCols = [...new Set(conditions.map(c => colLetterToIndex(c.column)))];
      const preview = {};
      relevantCols.forEach(ci => {
        preview[ci] = cells[ci] || '';
      });
      scored.push({
        rowNum: idx + 2,       // +2: 1-based, skip header row
        score,
        preview,
        highlights,
        header: headerRow,
      });
    });

    // Sort by score descending (rows with equal score keep original order)
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // ── Persistent highlight state ─────────────────────────
  // Stored so we can reapply after Sheets re-renders its DOM on scroll.

  let activeConditions = null;
  let activeColor = null;

  function reapplyIfActive() {
    if (!activeConditions) return;
    const rows = readSheetRows();
    if (rows.length < 2) return;
    clearAllHighlights();
    rows.slice(1).forEach(({ cells, el }) => {
      if (rowMatchesConditions(cells, activeConditions)) highlightRow(el, activeColor);
    });
  }

  // Debounced reapply — Sheets triggers many mutations on scroll/render
  let reapplyTimer = null;
  function scheduleReapply() {
    if (!activeConditions) return;
    clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(reapplyIfActive, 300);
  }

  // Watch for Sheets re-rendering rows (scroll, sheet switch, etc.)
  const observer = new MutationObserver(scheduleReapply);
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Message handlers ───────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'applyFilter') {
      handleApplyFilter(msg.conditions, msg.color, sendResponse);
      return true;
    }
    if (msg.action === 'applyFilterFromClipboard') {
      handleApplyFilterFromClipboard(msg.conditions, msg.color, sendResponse, msg.clipboardText);
      return true;
    }
    if (msg.action === 'clearFilter') {
      handleClearFilter(sendResponse);
      return true;
    }
    if (msg.action === 'navigateToRow') {
      handleNavigateToRow(msg.rowNum);
      sendResponse({ success: true });
      return false;
    }
  });

  function handleApplyFilter(conditions, color, sendResponse) {
    try {
      clearAllHighlights();
      const rows = readSheetRows();

      if (rows.length === 0) {
        sendResponse({
          success: false,
          canvasMode: true,
          error: 'Sheet dang dung canvas mode. Hay dung che do Clipboard.',
        });
        return;
      }

      const usedCols = new Set(conditions.map(c => c.column.toUpperCase()));
      const headerRow = rows[0] ? rows[0].cells : [];
      const dataRows = rows.slice(1);
      let matchedCount = 0;

      const ranked = buildRankedResults(dataRows.map(r => r.cells), conditions, headerRow);
      matchedCount = ranked.length;

      // Highlight in DOM and persist state for reapply on re-render
      activeConditions = conditions;
      activeColor = color;
      dataRows.forEach(({ cells, el }) => {
        if (rowMatchesConditions(cells, conditions)) highlightRow(el, color);
      });

      sendResponse({
        success: true,
        matched: matchedCount,
        total: dataRows.length,
        cols: usedCols.size,
        rankedResults: ranked.slice(0, 50),
        hasSmartCondition: conditions.some(c => c.operator === 'smart'),
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  function handleApplyFilterFromClipboard(conditions, color, sendResponse, clipboardText) {
    try {
      const text = clipboardText || '';

      if (!text || !text.includes('\t')) {
        sendResponse({
          success: false,
          error: 'Clipboard khong co du lieu Sheet. Hay Ctrl+A, Ctrl+C roi thu lai.',
        });
        return;
      }

      const allRows = parseTSV(text);
      if (allRows.length <= 1) {
        sendResponse({
          success: false,
          error: 'Du lieu qua it. Hay chon toan bo sheet (Ctrl+A) roi copy.',
        });
        return;
      }

      const headerRow = allRows[0];
      const dataRows  = allRows.slice(1);
      const usedCols  = new Set(conditions.map(c => c.column.toUpperCase()));

      const ranked = buildRankedResults(dataRows, conditions, headerRow);

      // Try to highlight in DOM too if accessible, and persist for reapply
      const domRows = readSheetRows();
      if (domRows.length > 1) {
        activeConditions = conditions;
        activeColor = color;
        clearAllHighlights();
        domRows.slice(1).forEach(({ cells, el }) => {
          if (rowMatchesConditions(cells, conditions)) highlightRow(el, color);
        });
      }

      sendResponse({
        success: true,
        matched: ranked.length,
        total: dataRows.length,
        cols: usedCols.size,
        matchedRows: ranked.map(r => r.rowNum),
        rankedResults: ranked.slice(0, 50),
        hasSmartCondition: conditions.some(c => c.operator === 'smart'),
        mode: 'clipboard',
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  function handleClearFilter(sendResponse) {
    activeConditions = null;
    activeColor = null;
    clearAllHighlights();
    sendResponse({ success: true });
  }

  // ── Navigate to row ────────────────────────────────────
  // Google Sheets reads the URL hash and navigates when it contains &range=A{n}.
  // Updating location.hash fires hashchange which Sheets handles natively.
  function handleNavigateToRow(rowNum) {
    const address = `A${rowNum}`;

    // Parse current hash (format: #gid=123456789 or #gid=...&range=...)
    const rawHash = globalThis.location.hash.startsWith('#')
      ? globalThis.location.hash.slice(1)
      : globalThis.location.hash;

    const params = new URLSearchParams(rawHash);
    params.set('range', address);

    // Setting location.hash fires hashchange — Sheets intercepts this and scrolls
    globalThis.location.hash = params.toString();
  }

})();
