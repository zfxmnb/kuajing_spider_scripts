// ==UserScript==
// @name         企业微信收集表历史记录批量删除
// @namespace    http://tampermonkey.net/
// @version      2026-08-26
// @description  在企业微信收集表“已填写”页面按时间范围限速删除历史记录
// @author       You
// @match        https://doc.weixin.qq.com/forms/*
// @run-at       document-end
// @grant        none
// @noframes
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// ==/UserScript==

(function () {
  'use strict';
  const DEBUG_MODE = true;

  const TOOLBAR_ID = 'wedoc-batch-delete-toolbar';
  const STYLE_ID = 'wedoc-batch-delete-style';
  const PREVIEW_MODAL_ID = 'wedoc-batch-delete-preview';
  const INSTANCE_ATTRIBUTE = 'data-wedoc-batch-delete-installed';
  const PAGE_SIZE = 100;
  const MAX_PAGE_REQUESTS = 10000;
  const MIN_DELETE_INTERVAL_MS = 500;
  const MAX_DELETE_INTERVAL_MS = 1000;
  const MAX_DELETE_RETRIES = 3;
  const RETRY_BASE_DELAY_MS = 1000;
  const RISK_CONTROL_PATTERN = /(?:风控|频繁|稍后再试|请求过快|too many|rate limit|risk)/i;
  const NORMAL_RANGE_OPTIONS = [
    { value: 'before-1-month', label: '一个月前', type: 'before-months', months: 1 },
    { value: 'before-2-months', label: '两个月前', type: 'before-months', months: 2 },
    { value: 'before-3-months', label: '三个月前', type: 'before-months', months: 3 },
    { value: 'before-6-months', label: '半年前', type: 'before-months', months: 6 },
    { value: 'before-12-months', label: '一年前', type: 'before-months', months: 12 }
  ];
  const DEBUG_RANGE_OPTIONS = [
    { value: 'today', label: '今天', type: 'today' },
    { value: 'before-today', label: '一天前', type: 'before-today' },
    { value: 'all', label: '全部', type: 'all' }
  ];
  const RANGE_OPTIONS = DEBUG_MODE ? [...NORMAL_RANGE_OPTIONS, ...DEBUG_RANGE_OPTIONS] : NORMAL_RANGE_OPTIONS;

  // 防止油猴重复执行时创建多个独立删除任务。
  if (document.documentElement.hasAttribute(INSTANCE_ATTRIBUTE) || document.getElementById(TOOLBAR_ID)) {
    return;
  }
  document.documentElement.setAttribute(INSTANCE_ATTRIBUTE, 'true');

  const runtime = {
    phase: 'idle',
    activeFormId: '',
    loadedFormId: '',
    stopRequested: false,
    metadataRequestId: 0,
    earliestText: '正在查询最早记录…',
    metadataError: false,
    statusText: '准备就绪',
    progressText: '',
    retryText: '',
    querySummaryText: '请先选择时间范围并查询',
    queryResult: null,
    expanded: false,
    closePreview: null,
    toolbar: null,
    panelElement: null,
    toggleButton: null,
    earliestElement: null,
    statusElement: null,
    progressElement: null,
    retryElement: null,
    querySummaryElement: null,
    retryMetadataButton: null,
    rangeSelect: null,
    queryButton: null,
    deleteButton: null,
    stopButton: null
  };

  class ApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = options.status ?? 0;
      this.fatal = options.fatal ?? false;
    }
  }

  class StopRequestedError extends Error {
    constructor() {
      super('用户已停止删除');
      this.name = 'StopRequestedError';
    }
  }

  function getFormId() {
    const match = window.location.pathname.match(/^\/forms\/([^/]+)/);
    if (!match) {
      return '';
    }

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return '';
    }
  }

  function isResultPage() {
    return window.location.hash.includes('/result');
  }

  function getRecordTimestamp(record) {
    const timestamp = Number(record?.ctime ?? record?.time);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }

  function getAnswerId(record) {
    const answerId = String(record?.answer_id ?? '').trim();
    return /^\d+$/.test(answerId) && answerId !== '0' ? answerId : null;
  }

  function findEarliestTimestamp(timestamps) {
    let earliestTimestamp = null;
    for (const timestamp of timestamps) {
      if (earliestTimestamp === null || timestamp < earliestTimestamp) {
        earliestTimestamp = timestamp;
      }
    }
    return earliestTimestamp;
  }

  function formatLocalTime(timestamp) {
    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) {
      return '未知时间';
    }

    const pad = (value) => String(value).padStart(2, '0');
    return [date.getFullYear(), '-', pad(date.getMonth() + 1), '-', pad(date.getDate()), ' ', pad(date.getHours()), ':', pad(date.getMinutes()), ':', pad(date.getSeconds())].join(
      ''
    );
  }

  function subtractCalendarMonths(sourceDate, months) {
    const result = new Date(sourceDate);
    const originalDay = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() - months);
    const daysInTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(originalDay, daysInTargetMonth));
    return result;
  }

  function buildTimeRange(option, now = new Date()) {
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    if (option.type === 'before-months') {
      const cutoff = subtractCalendarMonths(now, option.months);
      const cutoffTimestamp = Math.floor(cutoff.getTime() / 1000);
      return {
        label: option.label,
        description: `早于 ${formatLocalTime(cutoffTimestamp)}`,
        matches: (timestamp) => timestamp < cutoffTimestamp
      };
    }

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayTimestamp = Math.floor(startOfToday.getTime() / 1000);
    if (option.type === 'before-today') {
      return {
        label: option.label,
        description: `早于 ${formatLocalTime(startOfTodayTimestamp)}`,
        matches: (timestamp) => timestamp < startOfTodayTimestamp
      };
    }
    if (option.type === 'today') {
      return {
        label: option.label,
        description: `${formatLocalTime(startOfTodayTimestamp)} 至 ${formatLocalTime(nowTimestamp)}`,
        matches: (timestamp) => timestamp >= startOfTodayTimestamp && timestamp <= nowTimestamp
      };
    }
    if (option.type === 'all') {
      return {
        label: option.label,
        description: '全部有效记录',
        matches: () => true
      };
    }

    throw new ApiError('未知的时间范围', { fatal: true });
  }

  function getSelectedRangeOption() {
    const selectedValue = runtime.rangeSelect?.value ?? NORMAL_RANGE_OPTIONS[0].value;
    return RANGE_OPTIONS.find((option) => option.value === selectedValue) ?? NORMAL_RANGE_OPTIONS[0];
  }

  function buildDetailUrl(formId, params) {
    const url = new URL('/formcol/detail', window.location.origin);
    url.search = new URLSearchParams({
      f: 'json',
      form_id: formId,
      ...params
    }).toString();
    return url.toString();
  }

  async function fetchJson(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        ...options
      });
    } catch (error) {
      throw new ApiError(`网络请求失败：${error instanceof Error ? error.message : '未知错误'}`);
    }

    if (!response.ok) {
      const fatal = [401, 403, 429].includes(response.status) || response.status < 500;
      throw new ApiError(`接口返回 HTTP ${response.status}`, {
        status: response.status,
        fatal
      });
    }

    try {
      return await response.json();
    } catch {
      throw new ApiError('接口未返回有效 JSON', { fatal: true });
    }
  }

  function validateApiResponse(data, operation) {
    if (!data || typeof data !== 'object' || !data.head || typeof data.head.ret !== 'number') {
      throw new ApiError(`${operation}响应结构异常`, { fatal: true });
    }

    if (data.head.ret !== 0) {
      const message = String(data.head.msg || `${operation}失败，错误码 ${data.head.ret}`);
      throw new ApiError(message, { fatal: RISK_CONTROL_PATTERN.test(message) });
    }

    return data;
  }

  async function fetchStats(formId) {
    const url = buildDetailUrl(formId, { lang: 'zh', func: '2' });
    const data = validateApiResponse(await fetchJson(url), '查询填写数量');
    const fillCount = Number(data.body?.stat_info?.fill_cnt ?? 0);
    if (!Number.isInteger(fillCount) || fillCount < 0) {
      throw new ApiError('填写数量响应结构异常', { fatal: true });
    }

    return {
      fillCount,
      sid: typeof data.param?.sid === 'string' ? data.param.sid : ''
    };
  }

  async function fetchRecordPage(formId, start) {
    const url = buildDetailUrl(formId, {
      start: String(start),
      limit: String(PAGE_SIZE),
      func: '3',
      list_type: '0'
    });
    const data = validateApiResponse(await fetchJson(url), '查询已填写记录');
    const users = data.body?.stat_info?.user_list?.user;
    if (users != null && !Array.isArray(users)) {
      throw new ApiError('已填写记录响应结构异常', { fatal: true });
    }

    return {
      records: users ?? [],
      hasMore: data.body?.has_more === true,
      sid: typeof data.param?.sid === 'string' ? data.param.sid : ''
    };
  }

  function getRecordDeduplicationKey(record, fallbackIndex) {
    const answerId = getAnswerId(record);
    if (answerId) {
      return `answer:${answerId}`;
    }

    const timestamp = getRecordTimestamp(record) ?? 'invalid-time';
    const vid = String(record?.vid ?? '');
    const name = String(record?.name ?? '');
    return `fallback:${timestamp}:${vid}:${name}:${fallbackIndex}`;
  }

  async function fetchRecordPagesUntilEnd(formId, initialStart) {
    const recordsByKey = new Map();
    let start = initialStart;
    let sid = '';

    for (let requestIndex = 0; requestIndex < MAX_PAGE_REQUESTS; requestIndex += 1) {
      const page = await fetchRecordPage(formId, start);
      if (page.sid) {
        sid = page.sid;
      }

      for (const [recordIndex, record] of page.records.entries()) {
        const key = getRecordDeduplicationKey(record, start + recordIndex);
        if (!recordsByKey.has(key)) {
          recordsByKey.set(key, record);
        }
      }

      if (!page.hasMore) {
        return { records: Array.from(recordsByKey.values()), sid };
      }

      // start 是扫描游标而不是返回数组下标，必须按请求窗口推进以跨过过滤或删除形成的空洞。
      start += PAGE_SIZE;
    }

    throw new ApiError('分页请求超过安全上限，已停止扫描', { fatal: true });
  }

  async function fetchAllRecords(formId) {
    const stats = await fetchStats(formId);
    if (stats.fillCount === 0) {
      return { records: [], sid: stats.sid, fillCount: 0 };
    }

    const pages = await fetchRecordPagesUntilEnd(formId, 0);
    return {
      records: pages.records,
      sid: pages.sid || stats.sid,
      fillCount: stats.fillCount
    };
  }

  function isChronologicallyOrdered(timestamps, direction) {
    for (let index = 1; index < timestamps.length; index += 1) {
      if (direction === 'ascending' && timestamps[index] < timestamps[index - 1]) {
        return false;
      }
      if (direction === 'descending' && timestamps[index] > timestamps[index - 1]) {
        return false;
      }
    }
    return true;
  }

  async function fetchEarliestRecord(formId) {
    const stats = await fetchStats(formId);
    if (stats.fillCount === 0) {
      return { fillCount: 0, timestamp: null };
    }

    const firstPage = await fetchRecordPage(formId, 0);
    const firstTimestamps = firstPage.records.map(getRecordTimestamp).filter((timestamp) => timestamp !== null);
    if (firstTimestamps.length === 0) {
      const allRecords = await fetchAllRecords(formId);
      const validTimestamps = allRecords.records.map(getRecordTimestamp).filter((timestamp) => timestamp !== null);
      return {
        fillCount: stats.fillCount,
        timestamp: findEarliestTimestamp(validTimestamps)
      };
    }

    if (stats.fillCount <= firstPage.records.length) {
      return { fillCount: stats.fillCount, timestamp: findEarliestTimestamp(firstTimestamps) };
    }

    const ascending = isChronologicallyOrdered(firstTimestamps, 'ascending');
    const descending = isChronologicallyOrdered(firstTimestamps, 'descending');
    if (ascending && !descending) {
      return { fillCount: stats.fillCount, timestamp: firstTimestamps[0] };
    }

    if (descending) {
      const tailStart = Math.max(0, stats.fillCount - PAGE_SIZE);
      const tailPages = await fetchRecordPagesUntilEnd(formId, tailStart);
      const tailTimestamps = tailPages.records.map(getRecordTimestamp).filter((timestamp) => timestamp !== null);
      if (tailTimestamps.length > 0) {
        return {
          fillCount: stats.fillCount,
          timestamp: findEarliestTimestamp(tailTimestamps)
        };
      }
    }

    const allRecords = await fetchAllRecords(formId);
    const validTimestamps = allRecords.records.map(getRecordTimestamp).filter((timestamp) => timestamp !== null);
    return {
      fillCount: stats.fillCount,
      timestamp: findEarliestTimestamp(validTimestamps)
    };
  }

  function collectCandidates(records, timeRange) {
    const candidatesById = new Map();
    let skippedCount = 0;

    for (const record of records) {
      const answerId = getAnswerId(record);
      const timestamp = getRecordTimestamp(record);
      if (!answerId || timestamp === null) {
        skippedCount += 1;
        continue;
      }
      if (!timeRange.matches(timestamp)) {
        continue;
      }

      const existing = candidatesById.get(answerId);
      if (!existing || timestamp < existing.timestamp) {
        const rawName = String(record?.name ?? '').trim();
        candidatesById.set(answerId, {
          answerId,
          timestamp,
          name: rawName || '未命名填写人'
        });
      }
    }

    const candidates = Array.from(candidatesById.values()).sort((left, right) => left.timestamp - right.timestamp);
    return { candidates, skippedCount };
  }

  function buildDeleteUrl(sid) {
    const url = new URL('/formcol/answer_page', window.location.origin);
    url.search = new URLSearchParams({ sid, wedoc_xsrf: '1' }).toString();
    return url.toString();
  }

  async function deleteRecord(formId, sid, answerId) {
    const formData = new FormData();
    formData.append('form_id', formId);
    formData.append('modify_answer_id', answerId);
    formData.append('type', '7');
    formData.append('f', 'json');

    const data = await fetchJson(buildDeleteUrl(sid), {
      method: 'POST',
      body: formData
    });
    const message = JSON.stringify(data).slice(0, 2000);
    if (RISK_CONTROL_PATTERN.test(message)) {
      throw new ApiError('接口返回风控或请求频繁提示', { fatal: true });
    }
    validateApiResponse(data, `删除记录 ${answerId}`);
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : '未知错误';
  }

  function setPhase(phase, statusText) {
    runtime.phase = phase;
    if (phase !== 'idle') {
      runtime.expanded = true;
    }
    if (statusText) {
      runtime.statusText = statusText;
    }
    render();
  }

  function render() {
    if (!runtime.toolbar?.isConnected) {
      return;
    }

    runtime.earliestElement.textContent = runtime.earliestText;
    runtime.statusElement.textContent = runtime.statusText;
    runtime.progressElement.textContent = runtime.progressText;
    runtime.progressElement.hidden = runtime.progressText.length === 0;
    runtime.retryElement.textContent = runtime.retryText;
    runtime.retryElement.hidden = runtime.retryText.length === 0;
    runtime.querySummaryElement.textContent = runtime.querySummaryText;
    runtime.panelElement.hidden = !runtime.expanded;
    runtime.toggleButton.setAttribute('aria-expanded', String(runtime.expanded));
    let toggleText = '历史清理';
    if (runtime.expanded) {
      toggleText = '收起清理面板';
    } else if (['deleting', 'stopping'].includes(runtime.phase)) {
      toggleText = '删除中…';
    }
    runtime.toggleButton.textContent = toggleText;

    const isIdle = runtime.phase === 'idle';
    runtime.rangeSelect.disabled = !isIdle;
    runtime.queryButton.disabled = !isIdle;
    runtime.deleteButton.disabled = !isIdle || !runtime.queryResult?.candidates.length;
    runtime.deleteButton.textContent = runtime.queryResult?.candidates.length ? `删除 ${runtime.queryResult.candidates.length} 条` : '删除';
    runtime.stopButton.hidden = !['deleting', 'stopping'].includes(runtime.phase);
    runtime.stopButton.disabled = runtime.phase === 'stopping';
    runtime.retryMetadataButton.hidden = !isIdle || !runtime.metadataError;
  }

  async function refreshEarliestRecord(formId) {
    const requestId = runtime.metadataRequestId + 1;
    runtime.metadataRequestId = requestId;
    runtime.metadataError = false;
    runtime.earliestText = '正在查询最早记录…';
    render();

    try {
      const result = await fetchEarliestRecord(formId);
      if (requestId !== runtime.metadataRequestId || formId !== getFormId()) {
        return;
      }

      if (result.fillCount === 0) {
        runtime.earliestText = '暂无已填写记录';
      } else if (result.timestamp === null) {
        runtime.earliestText = `共 ${result.fillCount} 条记录，但没有有效时间`;
      } else {
        runtime.earliestText = `最早记录：${formatLocalTime(result.timestamp)}（共 ${result.fillCount} 条）`;
      }
    } catch (error) {
      if (requestId !== runtime.metadataRequestId) {
        return;
      }
      runtime.metadataError = true;
      runtime.earliestText = `最早记录查询失败：${getErrorMessage(error)}`;
    } finally {
      render();
    }
  }

  function randomDeleteInterval() {
    return Math.floor(MIN_DELETE_INTERVAL_MS + Math.random() * (MAX_DELETE_INTERVAL_MS - MIN_DELETE_INTERVAL_MS + 1));
  }

  async function waitBeforeNextDelete(milliseconds) {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      if (runtime.stopRequested) {
        throw new StopRequestedError();
      }
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(100, deadline - Date.now())));
    }
  }

  async function deleteWithRetry(formId, sid, candidate, completedCount, totalCount) {
    for (let attempt = 0; attempt <= MAX_DELETE_RETRIES; attempt += 1) {
      if (runtime.stopRequested) {
        throw new StopRequestedError();
      }

      runtime.retryText = attempt === 0 ? '' : `当前记录第 ${attempt} 次重试`;
      runtime.progressText = `已删除 ${completedCount}/${totalCount}，正在处理 ${formatLocalTime(candidate.timestamp)}`;
      render();

      try {
        await deleteRecord(formId, sid, candidate.answerId);
        runtime.retryText = '';
        return;
      } catch (error) {
        if (runtime.stopRequested) {
          throw new StopRequestedError();
        }
        if (error instanceof ApiError && error.fatal) {
          throw error;
        }
        if (attempt === MAX_DELETE_RETRIES) {
          throw new ApiError(`记录 ${candidate.answerId} 在 ${MAX_DELETE_RETRIES} 次重试后仍删除失败：${getErrorMessage(error)}`, { fatal: true });
        }

        const retryDelay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        runtime.retryText = `删除失败，${retryDelay / 1000} 秒后进行第 ${attempt + 1} 次重试`;
        render();
        await waitBeforeNextDelete(retryDelay);
      }
    }
  }

  async function finishTask(formId, summary, terminalPhase) {
    runtime.progressText = '';
    runtime.retryText = '';
    setPhase(terminalPhase, summary);
    await refreshEarliestRecord(formId);
    setPhase('idle', summary);
  }

  function isCurrentTaskPage(formId) {
    return getFormId() === formId && isResultPage();
  }

  function showCandidatePreview(options) {
    const { candidates, rangeDescription, skippedCount, titleText, confirmText, danger } = options;
    const displayCandidates = [...candidates].sort((left, right) => right.timestamp - left.timestamp);
    const selectedIds = new Set(candidates.map((candidate) => candidate.answerId));
    let closed = false;

    return new Promise((resolve) => {
      document.getElementById(PREVIEW_MODAL_ID)?.remove();
      const previouslyFocusedElement = document.activeElement;

      const overlay = document.createElement('div');
      overlay.id = PREVIEW_MODAL_ID;

      const dialog = document.createElement('section');
      dialog.className = 'wedoc-batch-delete-preview__dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', `${PREVIEW_MODAL_ID}-title`);

      const title = document.createElement('h2');
      title.id = `${PREVIEW_MODAL_ID}-title`;
      title.textContent = titleText;

      const summary = document.createElement('div');
      summary.className = 'wedoc-batch-delete-preview__summary';
      summary.textContent = `查询到 ${candidates.length} 条 · ${rangeDescription}`;

      const selectedSummary = document.createElement('div');
      selectedSummary.className = 'wedoc-batch-delete-preview__selected';

      const skipped = document.createElement('div');
      skipped.className = 'wedoc-batch-delete-preview__skipped';
      skipped.textContent = skippedCount > 0 ? `另有 ${skippedCount} 条记录因 answer_id 或时间无效而跳过` : '未发现需要跳过的无效记录';

      const selectionActions = document.createElement('div');
      selectionActions.className = 'wedoc-batch-delete-preview__selection-actions';

      const selectAllButton = document.createElement('button');
      selectAllButton.type = 'button';
      selectAllButton.textContent = '全选全部';

      const excludeAllButton = document.createElement('button');
      excludeAllButton.type = 'button';
      excludeAllButton.textContent = '剔除全部';
      selectionActions.append(selectAllButton, excludeAllButton);

      const list = document.createElement('ol');
      list.className = 'wedoc-batch-delete-preview__list';
      list.setAttribute('aria-label', '待删除记录列表');

      const footer = document.createElement('div');
      footer.className = 'wedoc-batch-delete-preview__footer';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'wedoc-batch-delete-preview__cancel';
      cancelButton.textContent = '取消';

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'wedoc-batch-delete-preview__confirm';
      if (danger) {
        confirmButton.classList.add('wedoc-batch-delete-preview__confirm--danger');
      }

      footer.append(cancelButton, confirmButton);
      dialog.append(title, summary, selectedSummary, skipped, selectionActions, list, footer);
      overlay.appendChild(dialog);

      const updateSelectedSummary = () => {
        selectedSummary.textContent = `保留 ${selectedIds.size}/${candidates.length} 条待删除记录；取消勾选即剔除`;
        confirmButton.textContent = `${confirmText} ${selectedIds.size} 条`;
      };

      const renderRecords = () => {
        const fragment = document.createDocumentFragment();

        for (const [recordIndex, candidate] of displayCandidates.entries()) {
          const item = document.createElement('li');

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = selectedIds.has(candidate.answerId);
          checkbox.setAttribute('aria-label', `保留记录 ${candidate.answerId}，${formatLocalTime(candidate.timestamp)}`);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              selectedIds.add(candidate.answerId);
            } else {
              selectedIds.delete(candidate.answerId);
            }
            updateSelectedSummary();
          });

          const recordContent = document.createElement('div');
          recordContent.className = 'wedoc-batch-delete-preview__record-content';

          const primary = document.createElement('div');
          primary.className = 'wedoc-batch-delete-preview__record-primary';
          primary.textContent = `${recordIndex + 1}. ${formatLocalTime(candidate.timestamp)} · ${candidate.name}`;

          const secondary = document.createElement('div');
          secondary.className = 'wedoc-batch-delete-preview__record-secondary';
          secondary.textContent = `answer_id: ${candidate.answerId}`;

          recordContent.append(primary, secondary);
          item.append(checkbox, recordContent);
          fragment.appendChild(item);
        }

        list.replaceChildren(fragment);
        list.scrollTop = 0;
        updateSelectedSummary();
      };

      const close = (confirmed) => {
        if (closed) {
          return;
        }
        closed = true;
        document.removeEventListener('keydown', handleKeydown);
        overlay.remove();
        runtime.closePreview = null;
        if (previouslyFocusedElement instanceof HTMLElement && previouslyFocusedElement.isConnected) {
          previouslyFocusedElement.focus();
        }
        resolve(confirmed ? candidates.filter((candidate) => selectedIds.has(candidate.answerId)) : null);
      };

      const handleKeydown = (event) => {
        if (event.key === 'Escape') {
          close(false);
        }
      };

      selectAllButton.addEventListener('click', () => {
        for (const candidate of displayCandidates) {
          selectedIds.add(candidate.answerId);
        }
        renderRecords();
      });
      excludeAllButton.addEventListener('click', () => {
        selectedIds.clear();
        renderRecords();
      });
      cancelButton.addEventListener('click', () => close(false));
      confirmButton.addEventListener('click', () => close(true));
      document.addEventListener('keydown', handleKeydown);
      runtime.closePreview = () => close(false);

      document.body.appendChild(overlay);
      renderRecords();
      window.requestAnimationFrame(() => cancelButton.focus());
    });
  }

  function clearQueryResult(summaryText = '请重新查询待删除记录') {
    runtime.queryResult = null;
    runtime.querySummaryText = summaryText;
    render();
  }

  async function queryRecords() {
    if (runtime.phase !== 'idle') {
      return;
    }

    const formId = getFormId();
    if (!formId || !isResultPage()) {
      runtime.statusText = '当前不在“已填写”结果页';
      render();
      return;
    }

    runtime.stopRequested = false;
    runtime.progressText = '';
    runtime.retryText = '';
    clearQueryResult('正在查询…');
    setPhase('scanning', '正在扫描符合条件的记录…');

    try {
      const rangeOption = getSelectedRangeOption();
      const timeRange = buildTimeRange(rangeOption);
      const result = await fetchAllRecords(formId);
      if (!isCurrentTaskPage(formId)) {
        throw new ApiError('页面已切换，任务已取消', { fatal: true });
      }

      const { candidates, skippedCount } = collectCandidates(result.records, timeRange);
      if (candidates.length === 0) {
        const skippedText = skippedCount > 0 ? `，另有 ${skippedCount} 条因数据无效被跳过` : '';
        runtime.querySummaryText = `查询到 0 条${skippedText}`;
        setPhase('idle', `“${rangeOption.label}”范围没有可删除记录`);
        return;
      }
      if (!result.sid) {
        throw new ApiError('查询响应中缺少删除所需的 sid', { fatal: true });
      }

      setPhase('confirming', '请核对查询结果并剔除不需要删除的记录');
      const selectedCandidates = await showCandidatePreview({
        candidates,
        rangeDescription: timeRange.description,
        skippedCount,
        titleText: '查询结果',
        confirmText: '保存列表',
        danger: false
      });
      if (selectedCandidates === null) {
        clearQueryResult('查询结果未保存');
        setPhase('idle', '已取消保存查询结果');
        return;
      }

      if (!isCurrentTaskPage(formId)) {
        throw new ApiError('页面已切换，任务已取消', { fatal: true });
      }

      runtime.queryResult = {
        formId,
        rangeValue: rangeOption.value,
        rangeLabel: rangeOption.label,
        rangeDescription: timeRange.description,
        sid: result.sid,
        skippedCount,
        totalCandidateCount: candidates.length,
        candidates: selectedCandidates
      };
      runtime.querySummaryText = `已保存 ${selectedCandidates.length}/${candidates.length} 条，剔除 ${candidates.length - selectedCandidates.length} 条`;
      setPhase('idle', '查询完成，可继续调整条件或执行删除');
    } catch (error) {
      clearQueryResult('查询失败，请重试');
      setPhase('idle', `查询失败：${getErrorMessage(error)}`);
    }
  }

  async function runDeletion() {
    if (runtime.phase !== 'idle') {
      return;
    }

    const queryResult = runtime.queryResult;
    const formId = getFormId();
    if (!queryResult || queryResult.formId !== formId || queryResult.rangeValue !== getSelectedRangeOption().value) {
      clearQueryResult();
      runtime.statusText = '查询条件已变化，请重新查询';
      render();
      return;
    }
    if (queryResult.candidates.length === 0) {
      runtime.statusText = '当前没有保留的待删除记录';
      render();
      return;
    }

    runtime.stopRequested = false;
    runtime.progressText = '';
    runtime.retryText = '';
    setPhase('confirming', '请再次核对最终删除列表');

    try {
      const selectedCandidates = await showCandidatePreview({
        candidates: queryResult.candidates,
        rangeDescription: queryResult.rangeDescription,
        skippedCount: queryResult.skippedCount,
        titleText: '第一次删除确认',
        confirmText: '确认删除',
        danger: true
      });
      if (selectedCandidates === null) {
        setPhase('idle', '已取消，未执行删除');
        return;
      }
      queryResult.candidates = selectedCandidates;
      runtime.querySummaryText = `最终保留 ${selectedCandidates.length}/${queryResult.totalCandidateCount} 条`;
      render();

      if (selectedCandidates.length === 0) {
        setPhase('idle', '所有记录均已剔除，未执行删除');
        return;
      }

      if (!isCurrentTaskPage(formId)) {
        throw new ApiError('页面已切换，任务已取消', { fatal: true });
      }

      runtime.statusText = '等待最终确认';
      render();
      const finalConfirmed = window.confirm(`最终确认：即将永久删除 ${selectedCandidates.length} 条记录。此操作不可恢复，是否开始？`);
      if (!finalConfirmed) {
        setPhase('idle', '已取消，未执行删除');
        return;
      }

      setPhase('deleting', '删除中，请勿关闭或刷新页面');
      let deletedCount = 0;
      for (const candidate of selectedCandidates) {
        if (runtime.stopRequested || !isCurrentTaskPage(formId)) {
          runtime.stopRequested = true;
          break;
        }

        await deleteWithRetry(formId, queryResult.sid, candidate, deletedCount, selectedCandidates.length);
        deletedCount += 1;
        const percentage = Math.floor((deletedCount / selectedCandidates.length) * 100);
        runtime.progressText = `已删除 ${deletedCount}/${selectedCandidates.length}（${percentage}%）`;
        render();

        if (deletedCount < selectedCandidates.length && !runtime.stopRequested) {
          await waitBeforeNextDelete(randomDeleteInterval());
        }
      }

      clearQueryResult('删除后请重新查询');
      if (runtime.stopRequested) {
        await finishTask(formId, `已停止：成功删除 ${deletedCount}/${selectedCandidates.length} 条，未继续发送删除请求`, 'completed');
        return;
      }

      await finishTask(formId, `删除完成：成功删除 ${deletedCount}/${selectedCandidates.length} 条`, 'completed');
      window.location.reload();
    } catch (error) {
      clearQueryResult('任务中断后请重新查询');
      if (error instanceof StopRequestedError) {
        await finishTask(formId, '已停止删除，未继续发送删除请求', 'completed');
        return;
      }
      await finishTask(formId, `删除任务已停止：${getErrorMessage(error)}`, 'error');
    }
  }

  function requestStop() {
    if (!['deleting', 'stopping'].includes(runtime.phase)) {
      return;
    }

    runtime.stopRequested = true;
    setPhase('stopping', '正在停止，当前请求完成后不会继续删除');
  }

  function findFilledTab() {
    const candidates = document.querySelectorAll('[role="tab"], button, a, span, div');
    for (const element of candidates) {
      if (element.closest(`#${TOOLBAR_ID}`)) {
        continue;
      }
      if (element.textContent?.trim() === '已填写') {
        return element;
      }
    }
    return null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOOLBAR_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483646;
        box-sizing: border-box;
        color: #1f2937;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.5;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__launcher {
        display: block;
        min-width: 88px;
        min-height: 34px;
        margin-left: auto;
        padding: 5px 12px;
        border: 1px solid #d1d5db;
        border-radius: 18px;
        background: #fff;
        color: #374151;
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.14);
        cursor: pointer;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__launcher:hover:not(:disabled) {
        background: #f9fafb;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__panel {
        box-sizing: border-box;
        width: min(320px, calc(100vw - 32px));
        max-height: calc(100vh - 74px);
        margin-bottom: 8px;
        overflow: auto;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 9px;
        background: #fff;
        color: #1f2937;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__panel[hidden] {
        display: none;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__title {
        margin-bottom: 6px;
        font-size: 14px;
        font-weight: 600;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__earliest,
      #${TOOLBAR_ID} .wedoc-batch-delete__status,
      #${TOOLBAR_ID} .wedoc-batch-delete__progress,
      #${TOOLBAR_ID} .wedoc-batch-delete__retry,
      #${TOOLBAR_ID} .wedoc-batch-delete__query-summary {
        margin-top: 4px;
        overflow-wrap: anywhere;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__query-summary {
        color: #4b5563;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__range {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
      }
      #${TOOLBAR_ID} select {
        box-sizing: border-box;
        width: 100%;
        min-height: 30px;
        padding: 3px 7px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #fff;
        color: #1f2937;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__retry {
        color: #b45309;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      #${TOOLBAR_ID} button {
        min-height: 30px;
        padding: 4px 9px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #fff;
        color: #374151;
        cursor: pointer;
      }
      #${TOOLBAR_ID} button:hover:not(:disabled) {
        background: #f9fafb;
      }
      #${TOOLBAR_ID} button:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
      #${TOOLBAR_ID} button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__stop {
        border-color: #d97706;
        color: #b45309;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__refresh {
        border-color: #6b7280;
        color: #4b5563;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__query {
        border-color: #2563eb;
        color: #1d4ed8;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__delete {
        border-color: #dc2626;
        background: #dc2626;
        color: #fff;
      }
      #${TOOLBAR_ID} .wedoc-batch-delete__delete:hover:not(:disabled) {
        background: #b91c1c;
      }
      #${PREVIEW_MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 20px;
        background: rgba(17, 24, 39, 0.46);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__dialog {
        box-sizing: border-box;
        width: min(680px, 100%);
        max-height: min(720px, calc(100vh - 40px));
        display: flex;
        flex-direction: column;
        padding: 18px;
        border-radius: 10px;
        background: #fff;
        color: #1f2937;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
      }
      #${PREVIEW_MODAL_ID} h2 {
        margin: 0;
        font-size: 18px;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__summary {
        margin-top: 8px;
        font-weight: 600;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__selected {
        margin-top: 5px;
        color: #1d4ed8;
        font-size: 13px;
        font-weight: 600;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__skipped {
        margin-top: 4px;
        color: #6b7280;
        font-size: 13px;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__list {
        flex: 1 1 auto;
        min-height: 140px;
        max-height: 480px;
        margin: 14px 0 0;
        padding: 0;
        overflow: auto;
        border: 1px solid #e5e7eb;
        border-radius: 7px;
        list-style: none;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__list li {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        padding: 8px 10px;
        border-bottom: 1px solid #f3f4f6;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__list li:last-child {
        border-bottom: 0;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__record-primary {
        overflow-wrap: anywhere;
        font-size: 13px;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__record-content {
        min-width: 0;
        flex: 1;
      }
      #${PREVIEW_MODAL_ID} input[type="checkbox"] {
        flex: 0 0 auto;
        margin-top: 3px;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__record-secondary {
        margin-top: 2px;
        color: #6b7280;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__selection-actions,
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__footer {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__selection-actions {
        justify-content: flex-end;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__footer {
        justify-content: flex-end;
      }
      #${PREVIEW_MODAL_ID} button {
        min-height: 32px;
        padding: 5px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #fff;
        color: #374151;
        cursor: pointer;
      }
      #${PREVIEW_MODAL_ID} button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__confirm {
        border-color: #2563eb;
        background: #2563eb;
        color: #fff;
      }
      #${PREVIEW_MODAL_ID} .wedoc-batch-delete-preview__confirm--danger {
        border-color: #dc2626;
        background: #dc2626;
        color: #fff;
      }
      #${PREVIEW_MODAL_ID} button:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function createToolbar() {
    const toolbar = document.createElement('section');
    toolbar.id = TOOLBAR_ID;
    toolbar.setAttribute('aria-label', '历史填写记录批量删除');

    const panel = document.createElement('div');
    panel.className = 'wedoc-batch-delete__panel';

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'wedoc-batch-delete__launcher';
    toggleButton.setAttribute('aria-controls', `${TOOLBAR_ID}-panel`);
    toggleButton.addEventListener('click', () => {
      runtime.expanded = !runtime.expanded;
      render();
    });
    panel.id = `${TOOLBAR_ID}-panel`;

    const title = document.createElement('div');
    title.className = 'wedoc-batch-delete__title';
    title.textContent = DEBUG_MODE ? '历史记录清理 · 调试模式' : '历史填写记录清理';

    const earliest = document.createElement('div');
    earliest.className = 'wedoc-batch-delete__earliest';

    const status = document.createElement('div');
    status.className = 'wedoc-batch-delete__status';
    status.setAttribute('aria-live', 'polite');

    const progress = document.createElement('div');
    progress.className = 'wedoc-batch-delete__progress';
    progress.setAttribute('aria-live', 'polite');

    const retry = document.createElement('div');
    retry.className = 'wedoc-batch-delete__retry';
    retry.setAttribute('aria-live', 'polite');

    const rangeField = document.createElement('label');
    rangeField.className = 'wedoc-batch-delete__range';
    rangeField.textContent = '删除范围';

    const rangeSelect = document.createElement('select');
    const appendOptions = (groupLabel, options) => {
      const group = document.createElement('optgroup');
      group.label = groupLabel;
      for (const option of options) {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        group.appendChild(optionElement);
      }
      rangeSelect.appendChild(group);
    };
    appendOptions('正式范围', NORMAL_RANGE_OPTIONS);
    if (DEBUG_MODE) {
      appendOptions('调试范围', DEBUG_RANGE_OPTIONS);
    }
    rangeSelect.addEventListener('change', () => {
      clearQueryResult('范围已变化，请重新查询');
      runtime.statusText = '查询条件已变化';
      render();
    });
    rangeField.appendChild(rangeSelect);

    const querySummary = document.createElement('div');
    querySummary.className = 'wedoc-batch-delete__query-summary';
    querySummary.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'wedoc-batch-delete__actions';

    const queryButton = document.createElement('button');
    queryButton.type = 'button';
    queryButton.className = 'wedoc-batch-delete__query';
    queryButton.textContent = '查询';
    queryButton.addEventListener('click', () => {
      void queryRecords();
    });
    actions.appendChild(queryButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'wedoc-batch-delete__delete';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      void runDeletion();
    });
    actions.appendChild(deleteButton);

    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'wedoc-batch-delete__stop';
    stopButton.textContent = '停止删除';
    stopButton.addEventListener('click', requestStop);
    actions.appendChild(stopButton);

    const retryMetadataButton = document.createElement('button');
    retryMetadataButton.type = 'button';
    retryMetadataButton.className = 'wedoc-batch-delete__refresh';
    retryMetadataButton.textContent = '刷新最早时间';
    retryMetadataButton.addEventListener('click', () => {
      const formId = getFormId();
      if (runtime.phase === 'idle' && formId) {
        void refreshEarliestRecord(formId);
      }
    });
    actions.appendChild(retryMetadataButton);

    panel.append(title, earliest, rangeField, querySummary, status, progress, retry, actions);
    toolbar.append(panel, toggleButton);
    runtime.toolbar = toolbar;
    runtime.panelElement = panel;
    runtime.toggleButton = toggleButton;
    runtime.earliestElement = earliest;
    runtime.statusElement = status;
    runtime.progressElement = progress;
    runtime.retryElement = retry;
    runtime.querySummaryElement = querySummary;
    runtime.retryMetadataButton = retryMetadataButton;
    runtime.rangeSelect = rangeSelect;
    runtime.queryButton = queryButton;
    runtime.deleteButton = deleteButton;
    runtime.stopButton = stopButton;
    render();
    return toolbar;
  }

  function ensureToolbar() {
    const formId = getFormId();
    if (runtime.toolbar?.isConnected && runtime.activeFormId === formId && formId && isResultPage()) {
      return;
    }

    const filledTab = isResultPage() ? findFilledTab() : null;
    if (!formId || !filledTab) {
      runtime.closePreview?.();
      runtime.queryResult = null;
      runtime.querySummaryText = '页面已变化，请重新查询';
      if (['deleting', 'stopping'].includes(runtime.phase)) {
        requestStop();
      }
      if (runtime.toolbar?.isConnected) {
        runtime.loadedFormId = '';
        runtime.metadataRequestId += 1;
      }
      runtime.toolbar?.remove();
      return;
    }

    if (runtime.activeFormId && runtime.activeFormId !== formId) {
      runtime.closePreview?.();
      runtime.queryResult = null;
      runtime.querySummaryText = '表单已变化，请重新查询';
      if (['deleting', 'stopping'].includes(runtime.phase)) {
        requestStop();
      }
      runtime.loadedFormId = '';
      runtime.metadataRequestId += 1;
    }
    runtime.activeFormId = formId;

    if (!runtime.toolbar?.isConnected) {
      injectStyle();
      document.body.appendChild(createToolbar());
    }

    if (runtime.loadedFormId !== formId && runtime.phase === 'idle') {
      runtime.loadedFormId = formId;
      void refreshEarliestRecord(formId);
    }
  }

  let mountScheduled = false;
  const scheduleMount = () => {
    if (mountScheduled) {
      return;
    }
    mountScheduled = true;
    window.requestAnimationFrame(() => {
      mountScheduled = false;
      ensureToolbar();
    });
  };

  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', scheduleMount);
  window.addEventListener('popstate', scheduleMount);
  ensureToolbar();
})();
