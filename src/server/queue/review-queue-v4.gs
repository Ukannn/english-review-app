
function scheduledBuildDailyQueueV4() {
  return buildDailyQueueV4ForDate_(new Date());
}

function buildTomorrowDailyQueueV4() {
  return buildDailyQueueV4ForDate_(tomorrowDate_());
}

function previewTomorrowDailyQueueV4() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  ensureDynamicQuestionCountSchemaV4_(ss);
  var targetDate = tomorrowDate_();
  var settings = readQuestionCountSettingsV4_(ss, formatDateKey_(targetDate));
  var batchCount = Math.min(settings.targetCount, ER4.maxBatchQuestionCount);
  var plan = calculateDailyQueuePlan_(ss, targetDate, batchCount);
  validatePlan_(plan);
  return {
    ok: true,
    date: formatDateKey_(targetDate),
    dailyTarget: settings.targetCount,
    batchCount: batchCount,
    dueCount: plan.dueCount,
    selectedDueCount: plan.selectedDueCount,
    newCount: plan.newCount,
    backlogCount: plan.backlogCount,
    readyCandidateCount: plan.readyCandidateCount,
    items: plan.items
  };
}

function buildDailyQueueV4ForDate_(targetDate) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    ensureCandidateMetadataColumns_(ss);
    ensureDynamicQuestionCountSchemaV4_(ss);
    return ensureQueueForDateV4Unlocked_(ss, targetDate, 'automatic queue build');
  } finally {
    lock.releaseLock();
  }
}

function ensureQueueForDateV4Unlocked_(ss, targetDate, reason) {
  var queueSheet = ensureDynamicQuestionCountSchemaV4_(ss);
  var dateKey = formatDateKey_(targetDate);
  var initialSettings = readQuestionCountSettingsV4_(ss, dateKey);
  var activeMaterialRequest = findActiveCandidateGenerationRequestV4_(ss, dateKey);
  if (
    activeMaterialRequest &&
    Number(activeMaterialRequest.requestedCount) !== Number(initialSettings.targetCount)
  ) {
    supersedeCandidateGenerationRequestsV4_(ss, dateKey);
  }
  processCandidateGenerationInboxV4_(ss, dateKey);
  var existing = findQueueForDateV4_(ss, dateKey);
  if (existing && existing.status === 'presented') {
    var presentedResult = reconcilePresentedQueueTargetV4_(
      ss,
      existing,
      initialSettings.targetCount,
      reason || 'daily target reconciliation'
    );
    if (presentedResult) return presentedResult;
    existing = findQueueForDateV4_(ss, dateKey);
  }

  var settings = readQuestionCountSettingsV4_(ss, dateKey);
  var completed = completedQuestionsForDateV4_(ss, dateKey, '');
  if (completed >= settings.targetCount) {
    supersedeCandidateGenerationRequestsV4_(ss, dateKey);
    if (existing && existing.status === 'planned') {
      supersedeQueueV4_(ss, existing, '', 'requested count already met');
    }
    return {
      ok: true,
      date: dateKey,
      state: 'daily_target_met',
      dailyTarget: settings.targetCount,
      completed: completed,
      reused: Boolean(existing)
    };
  }

  var remaining = settings.targetCount - completed;
  var batchCount = Math.min(remaining, ER4.maxBatchQuestionCount);
  if (existing && existing.status === 'planned' && existing.plannedCount === batchCount) {
    supersedeCandidateGenerationRequestsV4_(ss, dateKey);
    validateMaterializedQueueV4_(existing.rows.map(function(item) { return item.values; }), existing.queueId);
    var reusedSummary = summarizeQueueRowsV4_(
      existing.rows.map(function(item) { return item.values; }),
      existing.queueId,
      true
    );
    reusedSummary.dailyTarget = settings.targetCount;
    reusedSummary.completedBeforeBatch = completed;
    reusedSummary.remainingAfterBatch = Math.max(0, remaining - batchCount);
    return reusedSummary;
  }
  var plan = calculateDailyQueuePlan_(ss, targetDate, batchCount);
  if (Number(plan.candidateShortfall) > 0) {
    var request = ensureCandidateGenerationRequestV4_(ss, dateKey, plan, settings.targetCount);
    return {
      ok: true,
      state: 'candidate_shortfall',
      date: dateKey,
      dailyTarget: settings.targetCount,
      completed: completed,
      batchCount: batchCount,
      dueCount: plan.selectedDueCount,
      readyCandidateCount: plan.readyCandidateCount,
      shortfallCount: plan.candidateShortfall,
      requestId: request.requestId,
      requestStatus: request.status,
      reusedRequest: request.reused
    };
  }
  validatePlan_(plan);
  supersedeCandidateGenerationRequestsV4_(ss, dateKey);
  var queueId = allocateQueueIdV4_(queueSheet, dateKey);
  var queueKind = completed > 0 ? 'supplemental' : 'primary';
  appendQueuePlanV4_(
    queueSheet,
    dateKey,
    queueId,
    plan,
    queueKind,
    Number(queueId.slice(-3)) || 1,
    reason || 'daily target queue build'
  );
  if (existing && existing.status === 'planned') {
    supersedeQueueV4_(
      ss,
      existing,
      queueId,
      reason || 'requested count changed before session start'
    );
  }
  var written = readQueueRowsById_(queueSheet, queueId);
  validateMaterializedQueueV4_(written, queueId);
  var summary = summarizeQueueRowsV4_(written, queueId, false);
  summary.dailyTarget = settings.targetCount;
  summary.completedBeforeBatch = completed;
  summary.remainingAfterBatch = Math.max(0, remaining - batchCount);
  return summary;
}

function queueIdentityKeyV4_(phraseId, candidateId) {
  phraseId = stringValue_(phraseId);
  candidateId = stringValue_(candidateId);
  return phraseId ? 'P:' + phraseId : 'C:' + candidateId;
}

function reconcilePresentedQueueTargetV4_(ss, queue, dailyTarget, reason) {
  validateMaterializedQueueV4_(
    queue.rows.map(function(item) { return item.values; }),
    queue.queueId
  );
  var completedBeforeSession = completedQuestionsForDateV4_(ss, queue.dateKey, queue.sessionId);
  var lockedCount = countLockedDraftsV4_(ss, queue.sessionId);
  var desiredForSession = Math.max(
    lockedCount,
    Math.max(0, Number(dailyTarget) - completedBeforeSession)
  );

  if (desiredForSession === 0 && lockedCount === 0) {
    supersedeCandidateGenerationRequestsV4_(ss, queue.dateKey);
    supersedeQueueV4_(ss, queue, '', reason || 'daily target already met');
    return {
      ok: true,
      state: 'daily_target_met',
      date: queue.dateKey,
      dailyTarget: Number(dailyTarget),
      completed: completedBeforeSession,
      reused: true
    };
  }

  if (desiredForSession <= queue.plannedCount) {
    supersedeCandidateGenerationRequestsV4_(ss, queue.dateKey);
    if (queue.adjustedTarget !== desiredForSession) {
      setQueueAdjustedTargetV4_(
        queue,
        desiredForSession,
        reason || 'question count changed during session'
      );
    }
    queue.adjustedTarget = desiredForSession;
    var activePositions = activeQuestionPositionsV4_(ss, queue);
    reconcileQueueActivePositionsV4_(
      ss,
      queue,
      activePositions,
      reason || 'question count changed during session'
    );
    var current = findQueueBySessionV4_(ss, queue.sessionId);
    var currentSummary = summarizeQueueRowsV4_(
      current.rows.map(function(item) { return item.values; }),
      current.queueId,
      true
    );
    currentSummary.dailyTarget = Number(dailyTarget);
    currentSummary.completedBeforeBatch = completedBeforeSession;
    currentSummary.remainingAfterBatch = 0;
    return currentSummary;
  }

  var plan = calculateDailyQueuePlan_(ss, parseDateKey_(queue.dateKey), desiredForSession);
  var occupied = {};
  queue.rows.forEach(function(item) {
    occupied[queueIdentityKeyV4_(
      item.values[queue.headers['Phrase ID']],
      item.values[queue.headers['Candidate ID']]
    )] = true;
  });
  var additions = plan.items.filter(function(item) {
    return !occupied[queueIdentityKeyV4_(item.phraseId, item.candidateId)];
  });
  var needed = desiredForSession - queue.plannedCount;
  if (additions.length < needed) {
    var shortfall = needed - additions.length;
    var requestPlan = {
      items: queue.rows.map(function() { return {}; }).concat(additions),
      candidateShortfall: shortfall
    };
    var request = ensureCandidateGenerationRequestV4_(
      ss,
      queue.dateKey,
      requestPlan,
      Number(dailyTarget)
    );
    return {
      ok: true,
      state: 'candidate_shortfall',
      date: queue.dateKey,
      dailyTarget: Number(dailyTarget),
      completed: completedBeforeSession,
      batchCount: desiredForSession,
      dueCount: plan.selectedDueCount,
      readyCandidateCount: plan.readyCandidateCount,
      shortfallCount: shortfall,
      requestId: request.requestId,
      requestStatus: request.status,
      reusedRequest: request.reused
    };
  }

  supersedeCandidateGenerationRequestsV4_(ss, queue.dateKey);
  extendPresentedQueueV4_(
    queue,
    additions.slice(0, needed),
    desiredForSession,
    reason || 'question count increased during session'
  );
  var extended = findQueueBySessionV4_(ss, queue.sessionId);
  var summary = summarizeQueueRowsV4_(
    extended.rows.map(function(item) { return item.values; }),
    extended.queueId,
    false
  );
  summary.dailyTarget = Number(dailyTarget);
  summary.completedBeforeBatch = completedBeforeSession;
  summary.remainingAfterBatch = 0;
  summary.extendedBy = needed;
  return summary;
}

function extendPresentedQueueV4_(queue, additions, targetCount, reason) {
  if (!queue.sessionId || queue.status !== 'presented') {
    throw new Error('Only one presented Session Queue can be extended in place.');
  }
  targetCount = normalizeQuestionCount_(targetCount, queue.plannedCount);
  var expectedAdditions = targetCount - queue.plannedCount;
  if (expectedAdditions < 1 || additions.length !== expectedAdditions) {
    throw new Error('Presented Queue extension cardinality mismatch.');
  }
  var presentedAt = queue.rows[0].values[queue.headers['Presented At']];
  if (!isDateValue_(presentedAt)) throw new Error('Presented Queue is missing Presented At.');
  var revision = Math.max.apply(null, queue.rows.map(function(item) {
    return Number(item.values[queue.headers['Plan Revision']]) || 1;
  })) + 1;
  var createdAt = new Date();
  var startPosition = queue.plannedCount;
  var rows = additions.map(function(item, index) {
    return [
      parseDateKey_(queue.dateKey),
      queue.queueId,
      startPosition + index + 1,
      item.selectionType,
      item.phraseId || '',
      item.candidateId || '',
      item.chunk,
      item.chineseCue || '',
      item.topic || '',
      item.difficulty || '',
      item.naturalExample || '',
      item.originalNextReview || '',
      item.priorityReason,
      'presented',
      queue.sessionId,
      createdAt,
      '',
      ER4.contractVersion,
      presentedAt,
      targetCount,
      targetCount,
      queue.queueKind || 'primary',
      revision,
      '',
      '',
      reason || 'question count increased during session'
    ];
  });
  var startRow = Math.max(queue.sheet.getLastRow() + 1, 2);
  queue.sheet.getRange(startRow, 1, rows.length, DQ3_QUEUE_HEADERS.length).setValues(rows);
  queue.sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  queue.sheet.getRange(startRow, 12, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  queue.sheet.getRange(startRow, 16, rows.length, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  queue.sheet.getRange(startRow, 18, rows.length, 1).setNumberFormat('@');
  queue.sheet.getRange(startRow, 19, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  queue.sheet.getRange(startRow, 20, rows.length, 2).setNumberFormat('0');
  queue.sheet.getRange(startRow, 23, rows.length, 1).setNumberFormat('0');
  queue.sheet.getRange(startRow, 25, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  queue.rows.forEach(function(item) {
    queue.sheet.getRange(item.rowNumber, queue.headers['Planned Count'] + 1).setValue(targetCount);
    queue.sheet.getRange(item.rowNumber, queue.headers['Adjusted Target'] + 1).setValue(targetCount);
    queue.sheet.getRange(item.rowNumber, queue.headers['Plan Revision'] + 1).setValue(revision);
    queue.sheet.getRange(item.rowNumber, queue.headers['Change Reason'] + 1).setValue(reason || '');
  });
  SpreadsheetApp.flush();
}

function appendQueuePlanV4_(queueSheet, dateKey, queueId, plan, queueKind, revision, reason) {
  var createdAt = new Date();
  var plannedCount = normalizeQuestionCount_(plan.targetCount, ER4.legacyQuestionCount);
  var rows = plan.items.map(function(item, index) {
    return [
      parseDateKey_(dateKey),
      queueId,
      index + 1,
      item.selectionType,
      item.phraseId || '',
      item.candidateId || '',
      item.chunk,
      item.chineseCue || '',
      item.topic || '',
      item.difficulty || '',
      item.naturalExample || '',
      item.originalNextReview || '',
      item.priorityReason,
      'planned',
      '',
      createdAt,
      '',
      ER4.contractVersion,
      '',
      plannedCount,
      plannedCount,
      queueKind || 'primary',
      Number(revision) || 1,
      '',
      '',
      reason || ''
    ];
  });
  var startRow = Math.max(queueSheet.getLastRow() + 1, 2);
  queueSheet.getRange(startRow, 1, rows.length, DQ3_QUEUE_HEADERS.length).setValues(rows);
  queueSheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  queueSheet.getRange(startRow, 12, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  queueSheet.getRange(startRow, 16, rows.length, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  queueSheet.getRange(startRow, 18, rows.length, 1).setNumberFormat('@');
  queueSheet.getRange(startRow, 19, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  queueSheet.getRange(startRow, 20, rows.length, 2).setNumberFormat('0');
  queueSheet.getRange(startRow, 23, rows.length, 1).setNumberFormat('0');
  queueSheet.getRange(startRow, 25, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  SpreadsheetApp.flush();
}

function allocateQueueIdV4_(queueSheet, dateKey) {
  var values = queueSheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var prefix = 'DQ-' + dateKey.replace(/-/g, '') + '-';
  var maxSequence = 0;
  for (var i = 1; i < values.length; i++) {
    var queueId = stringValue_(values[i][headers['Queue ID']]);
    if (queueId.indexOf(prefix) !== 0) continue;
    var suffix = queueId.slice(prefix.length);
    if (/^\d{3}$/.test(suffix)) maxSequence = Math.max(maxSequence, Number(suffix));
  }
  return prefix + String(maxSequence + 1).padStart(3, '0');
}

function validateMaterializedQueueV4_(rows, queueId) {
  var plannedCount = queuePlannedCountFromRows_(rows);
  if (rows.length !== plannedCount) {
    throw new Error(
      queueId + ' must contain exactly ' + plannedCount +
      ' rows; found ' + rows.length + '.'
    );
  }
  var positions = {};
  var identities = {};
  rows.forEach(function(row) {
    var position = Number(row[2]);
    var phraseId = stringValue_(row[4]);
    var candidateId = stringValue_(row[5]);
    var selectionType = stringValue_(row[3]);
    var contract = stringValue_(row[17]);
    var status = stringValue_(row[13]).toLowerCase();
    if (position < 1 || position > plannedCount || positions[position]) {
      throw new Error(queueId + ' has an invalid or duplicate position: ' + position + '.');
    }
    positions[position] = true;
    if (['overdue', 'due_today', 'new'].indexOf(selectionType) === -1) {
      throw new Error(queueId + ' has an unsupported Selection Type.');
    }
    var identity = phraseId ? 'P:' + phraseId : 'C:' + candidateId;
    if (identity === 'C:' || identities[identity]) {
      throw new Error(queueId + ' has an invalid or duplicate identity: ' + identity + '.');
    }
    identities[identity] = true;
    if (contract !== ER4.contractVersion) {
      throw new Error(queueId + ' contains a non-v4 contract row.');
    }
    if (['planned', 'presented', 'committed', 'deferred', 'superseded'].indexOf(status) === -1) {
      throw new Error(queueId + ' has an invalid Queue Status: ' + status + '.');
    }
  });
  queueAdjustedTargetFromRowsV4_(rows, plannedCount);
}

function queueAdjustedTargetFromRowsV4_(rows, plannedCount) {
  plannedCount = plannedCount || queuePlannedCountFromRows_(rows);
  var column = DQ3_QUEUE_HEADERS.indexOf('Adjusted Target');
  var values = {};
  rows.forEach(function(row) {
    var raw = column >= 0 ? stringValue_(row[column]) : '';
    if (raw !== '') values[Number(raw)] = true;
  });
  var targets = Object.keys(values).map(Number);
  if (targets.length > 1) throw new Error('Queue rows do not share one Adjusted Target.');
  var target = targets.length ? targets[0] : plannedCount;
  if (!isFinite(target) || Math.floor(target) !== target || target < 0 || target > plannedCount) {
    throw new Error('Queue Adjusted Target must be an integer from 0 to Planned Count.');
  }
  return target;
}

function summarizeQueueRowsV4_(rows, queueId, reused) {
  var due = 0;
  var fresh = 0;
  rows.forEach(function(row) {
    if (stringValue_(row[3]) === 'new') fresh++;
    else due++;
  });
  return {
    ok: true,
    queueId: queueId,
    date: formatDateKey_(rows[0][0]),
    count: rows.length,
    plannedCount: queuePlannedCountFromRows_(rows),
    adjustedTarget: queueAdjustedTargetFromRowsV4_(rows),
    queueKind: stringValue_(rows[0][DQ3_QUEUE_HEADERS.indexOf('Queue Kind')]) || 'primary',
    dueCount: due,
    newCount: fresh,
    status: stringValue_(rows[0][13]),
    reused: reused,
    contractVersion: ER4.contractVersion
  };
}

function normalizeDailyQuestionCountV4_(value, fallback) {
  var fallbackCount = Number(fallback);
  if (!isFinite(fallbackCount)) fallbackCount = ER4.legacyQuestionCount;
  var raw = stringValue_(value);
  var count = raw === '' ? fallbackCount : Number(value);
  if (
    !isFinite(count) || Math.floor(count) !== count ||
    count < ER4.minQuestionCount || count > ER4.maxDailyQuestionCount
  ) {
    throw new Error(
      'Daily question target must be an integer between ' + ER4.minQuestionCount +
      ' and ' + ER4.maxDailyQuestionCount + '.'
    );
  }
  return count;
}

function readQuestionCountSettingsV4_(ss, dateKey) {
  var legacy = readConfigValueV4_(ss, 'max_questions_per_session');
  var defaultRaw = readConfigValueV4_(ss, 'default_question_count') || legacy || ER4.legacyQuestionCount;
  var defaultCount = normalizeDailyQuestionCountV4_(defaultRaw, ER4.legacyQuestionCount);
  var overrideDate = readConfigValueV4_(ss, 'question_count_override_date');
  var overrideRaw = readConfigValueV4_(ss, 'question_count_override_value');
  var hasOverride = overrideDate === dateKey && stringValue_(overrideRaw) !== '';
  var targetCount = hasOverride
    ? normalizeDailyQuestionCountV4_(overrideRaw, defaultCount)
    : defaultCount;
  return {
    date: dateKey,
    defaultCount: defaultCount,
    targetCount: targetCount,
    hasOverride: hasOverride,
    minCount: ER4.minQuestionCount,
    maxCount: ER4.maxDailyQuestionCount,
    maxBatchCount: ER4.maxBatchQuestionCount
  };
}

function completedQuestionsForDateV4_(ss, dateKey, excludedSessionId) {
  var sheet = requireSheet_(ss, 'Session Log');
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, [
    'Session ID', 'Date', 'Questions Logged', 'Database Write Status',
    'Readback Status', 'Contract Version'
  ], 'Session Log');
  var total = 0;
  for (var i = 1; i < values.length; i++) {
    var sessionId = stringValue_(values[i][headers['Session ID']]);
    if (!sessionId || sessionId === stringValue_(excludedSessionId)) continue;
    if (!isDateValue_(values[i][headers.Date]) || formatDateKey_(values[i][headers.Date]) !== dateKey) continue;
    if (
      stringValue_(values[i][headers['Database Write Status']]).toLowerCase() !== 'verified' ||
      stringValue_(values[i][headers['Readback Status']]).toLowerCase() !== 'verified' ||
      stringValue_(values[i][headers['Contract Version']]) !== ER4.contractVersion
    ) continue;
    total += Math.max(0, Number(values[i][headers['Questions Logged']]) || 0);
  }
  return total;
}

function ensureCandidateGenerationRequestV4_(ss, dateKey, plan, requestedCount) {
  var sheet = ensureV4Sheet_(
    ss,
    ER4.candidateGenerationSheet,
    ER4_CANDIDATE_GENERATION_HEADERS,
    [180, 105, 110, 110, 105, 80, 240, 220, 120, 220, 300, 280, 150, 100, 300, 260, 190, 120, 140, 170, 170, 125, 105]
  );
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var activeRequestRows = [];
  for (var i = 1; i < values.length; i++) {
    if (
      Number(values[i][headers.Position]) === 0 &&
      dashboardDateKeyV4_(values[i][headers['Queue Date']]) === dateKey &&
      ['requested', 'staged'].indexOf(
        stringValue_(values[i][headers['Generation Status']]).toLowerCase()
      ) !== -1 &&
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion
    ) {
      activeRequestRows.push({ rowNumber: i + 1, values: values[i] });
    }
  }
  if (activeRequestRows.length > 1) {
    throw new Error('More than one active candidate-generation request exists for ' + dateKey + '.');
  }
  var shortfall = Math.max(0, Number(plan.candidateShortfall) || 0);
  if (activeRequestRows.length === 1) {
    var active = activeRequestRows[0];
    var sameShortfall = Number(active.values[headers['Shortfall Count']]) === shortfall;
    var sameRequested = Number(active.values[headers['Requested Count']]) === Number(requestedCount);
    if (sameShortfall && sameRequested) {
      return {
        requestId: stringValue_(active.values[headers['Request ID']]),
        status: stringValue_(active.values[headers['Generation Status']]).toLowerCase(),
        reused: true
      };
    }
    var oldRequestId = stringValue_(active.values[headers['Request ID']]);
    for (var oldIndex = 1; oldIndex < values.length; oldIndex++) {
      if (stringValue_(values[oldIndex][headers['Request ID']]) === oldRequestId) {
        sheet.getRange(oldIndex + 1, headers['Generation Status'] + 1).setValue('superseded');
      }
    }
  }

  var requestId = 'CGR-' + dateKey.replace(/-/g, '') + '-' + Utilities.getUuid().slice(0, 8);
  sheet.appendRow([
    requestId,
    parseDateKey_(dateKey),
    Number(requestedCount),
    Number(plan.items.length),
    shortfall,
    0,
    '',
    '',
    '',
    'Web App shortage request',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'requested',
    new Date(),
    '',
    '',
    ER4.contractVersion
  ]);
  var rowNumber = sheet.getLastRow();
  sheet.getRange(rowNumber, headers['Queue Date'] + 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(rowNumber, headers['Created At'] + 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(rowNumber, headers['Contract Version'] + 1)
    .setNumberFormat('@')
    .setValue(ER4.contractVersion);
  SpreadsheetApp.flush();
  return { requestId: requestId, status: 'requested', reused: false };
}

function processCandidateGenerationInboxV4_(ss, dateKey) {
  var sheet = requireSheet_(ss, ER4.candidateGenerationSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_CANDIDATE_GENERATION_HEADERS, ER4.candidateGenerationSheet);
  var requests = {};
  for (var i = 1; i < values.length; i++) {
    var contract = stringValue_(values[i][headers['Contract Version']]);
    if (contract !== ER4.contractVersion) continue;
    var requestDate = dashboardDateKeyV4_(values[i][headers['Queue Date']]);
    if (dateKey && requestDate !== dateKey) continue;
    var requestId = stringValue_(values[i][headers['Request ID']]);
    if (!requestId) continue;
    if (!requests[requestId]) requests[requestId] = [];
    requests[requestId].push({ rowNumber: i + 1, values: values[i] });
  }
  var active = Object.keys(requests).filter(function(requestId) {
    return requests[requestId].some(function(item) {
      return Number(item.values[headers.Position]) === 0 &&
        ['requested', 'staged'].indexOf(
          stringValue_(item.values[headers['Generation Status']]).toLowerCase()
        ) !== -1;
    });
  });
  if (!active.length) return { ok: true, processed: 0 };
  if (active.length > 1) {
    throw new Error('Candidate Generation Inbox contains more than one active request.');
  }
  var rows = requests[active[0]];
  var requestRow = rows.filter(function(item) {
    return Number(item.values[headers.Position]) === 0;
  })[0];
  if (!requestRow) throw new Error('Candidate-generation request metadata is missing.');
  var shortfall = Number(requestRow.values[headers['Shortfall Count']]);
  if (!isFinite(shortfall) || shortfall < 1 || shortfall > ER4.maxCandidateGenerationCount) {
    throw new Error('Candidate-generation Shortfall Count is invalid.');
  }
  var staged = rows.filter(function(item) {
    return Number(item.values[headers.Position]) > 0 &&
      stringValue_(item.values[headers['Generation Status']]).toLowerCase() === 'staged';
  });
  if (!staged.length) {
    return { ok: true, processed: 0, requestId: active[0], waiting: true };
  }
  if (staged.length !== shortfall) {
    throw new Error(
      'Candidate-generation batch must contain exactly ' + shortfall +
      ' staged rows; found ' + staged.length + '.'
    );
  }
  var positions = {};
  var batchIds = {};
  var normalizedInBatch = {};
  staged.forEach(function(item) {
    var row = item.values;
    var position = Number(row[headers.Position]);
    if (position < 1 || position > shortfall || positions[position]) {
      throw new Error('Candidate-generation batch has an invalid or duplicate position.');
    }
    positions[position] = true;
    var batchId = stringValue_(row[headers['Generation Batch ID']]);
    if (!batchId) throw new Error('Candidate-generation batch ID is blank.');
    batchIds[batchId] = true;
    var candidate = stringValue_(row[headers.Candidate]);
    var key = normalizeChunk_(candidate);
    var difficulty = stringValue_(row[headers.Difficulty]).toLowerCase();
    if (!candidate || !key || normalizedInBatch[key]) {
      throw new Error('Candidate-generation batch contains a blank or duplicate Candidate.');
    }
    normalizedInBatch[key] = true;
    if (stringValue_(row[headers['Candidate Type']]).toLowerCase() !== 'chunk') {
      throw new Error('Generated material must use Candidate Type=chunk.');
    }
    if (['easy', 'medium', 'hard'].indexOf(difficulty) === -1) {
      throw new Error('Generated material has an invalid Difficulty.');
    }
    ['Chinese Cue', 'Context', 'Why Useful', 'Topic', 'Natural Example'].forEach(function(header) {
      if (!stringValue_(row[headers[header]])) {
        throw new Error('Generated material is missing ' + header + ' at position ' + position + '.');
      }
    });
  });
  if (Object.keys(batchIds).length !== 1) {
    throw new Error('Candidate-generation rows must share one Generation Batch ID.');
  }

  var phraseSheet = requireSheet_(ss, DQ3.phraseSheet);
  var phraseValues = phraseSheet.getDataRange().getValues();
  var phraseHeaders = headerMap_(phraseValues[0]);
  var occupied = {};
  for (var p = 1; p < phraseValues.length; p++) {
    var phraseChunk = normalizeChunk_(phraseValues[p][phraseHeaders.Chunk]);
    var canonical = normalizeChunk_(phraseValues[p][phraseHeaders['Canonical Pattern']]);
    if (phraseChunk) occupied[phraseChunk] = { type: 'phrase', id: stringValue_(phraseValues[p][phraseHeaders.ID]) };
    if (canonical) occupied[canonical] = { type: 'phrase', id: stringValue_(phraseValues[p][phraseHeaders.ID]) };
  }

  var candidateSheet = requireSheet_(ss, DQ3.candidateSheet);
  var candidateValues = candidateSheet.getDataRange().getValues();
  var candidateHeaders = headerMap_(candidateValues[0]);
  var nextCandidateNumber = 0;
  for (var c = 1; c < candidateValues.length; c++) {
    var candidateId = stringValue_(candidateValues[c][candidateHeaders['Candidate ID']]);
    if (candidateId) nextCandidateNumber = Math.max(nextCandidateNumber, numericSuffixV4_(candidateId, 'CAN-'));
    var candidateKey = normalizeChunk_(candidateValues[c][candidateHeaders.Candidate]);
    if (candidateKey) occupied[candidateKey] = { type: 'candidate', id: candidateId };
  }

  staged.sort(function(a, b) {
    return Number(a.values[headers.Position]) - Number(b.values[headers.Position]);
  });
  var candidateRows = [];
  var committed = [];
  var duplicates = [];
  staged.forEach(function(item) {
    var row = item.values;
    var key = normalizeChunk_(row[headers.Candidate]);
    if (occupied[key]) {
      duplicates.push({ item: item, existing: occupied[key] });
      return;
    }
    nextCandidateNumber++;
    var candidateId = 'CAN-' + String(nextCandidateNumber).padStart(4, '0');
    occupied[key] = { type: 'candidate', id: candidateId };
    candidateRows.push([
      candidateId,
      parseDateKey_(dashboardDateKeyV4_(requestRow.values[headers['Queue Date']])),
      stringValue_(row[headers.Candidate]),
      'chunk',
      stringValue_(row[headers.Source]) || 'ChatGPT personalized on-demand',
      stringValue_(row[headers.Context]),
      stringValue_(row[headers['Why Useful']]),
      'ready',
      '',
      '',
      '',
      '',
      stringValue_(row[headers['Chinese Cue']]),
      stringValue_(row[headers.Topic]),
      stringValue_(row[headers.Difficulty]).toLowerCase(),
      stringValue_(row[headers['Natural Example']]),
      stringValue_(row[headers['Common Mistake']]),
      'ai_fallback',
      '',
      '',
      '',
      'fallback'
    ]);
    committed.push({ item: item, candidateId: candidateId });
  });
  if (candidateRows.length) {
    var startRow = candidateSheet.getLastRow() + 1;
    candidateSheet.getRange(startRow, 1, candidateRows.length, 22).setValues(candidateRows);
    candidateSheet.getRange(startRow, 2, candidateRows.length, 1).setNumberFormat('yyyy-mm-dd');
  }
  var committedAt = new Date();
  committed.forEach(function(result) {
    sheet.getRange(result.item.rowNumber, headers['Generation Status'] + 1).setValue('committed');
    sheet.getRange(result.item.rowNumber, headers['Committed At'] + 1)
      .setValue(committedAt)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(result.item.rowNumber, headers['Candidate ID'] + 1).setValue(result.candidateId);
  });
  duplicates.forEach(function(result) {
    sheet.getRange(result.item.rowNumber, headers['Generation Status'] + 1).setValue('duplicate');
    sheet.getRange(result.item.rowNumber, headers['Committed At'] + 1)
      .setValue(committedAt)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(result.item.rowNumber, headers['Candidate ID'] + 1).setValue(result.existing.id || '');
  });
  sheet.getRange(requestRow.rowNumber, headers['Generation Status'] + 1).setValue('committed');
  sheet.getRange(requestRow.rowNumber, headers['Committed At'] + 1)
    .setValue(committedAt)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  SpreadsheetApp.flush();

  var candidateReadback = candidateSheet.getDataRange().getValues();
  var readyReadbackCount = {};
  for (var readbackIndex = 1; readbackIndex < candidateReadback.length; readbackIndex++) {
    var readbackId = stringValue_(candidateReadback[readbackIndex][candidateHeaders['Candidate ID']]);
    if (
      readbackId &&
      stringValue_(candidateReadback[readbackIndex][candidateHeaders.Status]).toLowerCase() === 'ready'
    ) readyReadbackCount[readbackId] = (readyReadbackCount[readbackId] || 0) + 1;
  }
  committed.forEach(function(result) {
    if (readyReadbackCount[result.candidateId] !== 1) {
      throw new Error('Generated Candidate readback failed: ' + result.candidateId + '.');
    }
  });
  return {
    ok: true,
    processed: 1,
    requestId: active[0],
    committedCount: committed.length,
    duplicateCount: duplicates.length
  };
}

function getQuestionCountControlV4() {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  ensureDynamicQuestionCountSchemaV4_(ss);
  return buildQuestionCountControlV4_(ss, formatDateKey_(new Date()));
}

function setQuestionCountV4(count, mode) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    ensureCandidateMetadataColumns_(ss);
    ensureDynamicQuestionCountSchemaV4_(ss);
    count = normalizeDailyQuestionCountV4_(count, ER4.legacyQuestionCount);
    var requestedInputCount = count;
    mode = stringValue_(mode).toLowerCase();
    if (['today', 'future', 'both'].indexOf(mode) === -1) {
      throw new Error('Question-count update mode must be today, future, or both.');
    }
    var dateKey = formatDateKey_(new Date());
    var queue = findQueueForDateV4_(ss, dateKey);
    var completed = completedQuestionsForDateV4_(ss, dateKey, '');
    var locked = queue && queue.status === 'presented'
      ? countLockedDraftsV4_(ss, queue.sessionId)
      : 0;
    var effectiveTodayCount = Math.max(count, completed + locked);
    var adjustmentResult = null;

    if (mode === 'future' || mode === 'both') {
      writeConfigValueV4_(
        ss,
        'default_question_count',
        count,
        'Mutable default for future sessions; one Daily Queue supports the full 1–150 range.'
      );
    }
    if (mode === 'today' || mode === 'both') {
      writeConfigValueV4_(
        ss,
        'question_count_override_date',
        dateKey,
        'Asia/Shanghai date for the current one-day requested-count override.'
      );
      writeConfigValueV4_(
        ss,
        'question_count_override_value',
        effectiveTodayCount,
        'Effective requested count; never lower than work already locked or formally completed today.'
      );

      if (completed >= effectiveTodayCount) supersedeCandidateGenerationRequestsV4_(ss, dateKey);
      if (queue && queue.status === 'planned') {
        var remaining = Math.max(0, effectiveTodayCount - completed);
        if (remaining === 0) {
          supersedeCandidateGenerationRequestsV4_(ss, dateKey);
          supersedeQueueV4_(ss, queue, '', 'requested count already met');
          queue = null;
        } else {
          var replacementCount = remaining;
          if (replacementCount !== queue.plannedCount) {
            var replacementPlan = calculateDailyQueuePlan_(ss, parseDateKey_(dateKey), replacementCount);
            if (Number(replacementPlan.candidateShortfall) > 0) {
              adjustmentResult = ensureCandidateGenerationRequestV4_(
                ss,
                dateKey,
                replacementPlan,
                effectiveTodayCount
              );
            } else {
              validatePlan_(replacementPlan);
              supersedeCandidateGenerationRequestsV4_(ss, dateKey);
              var replacementId = allocateQueueIdV4_(queue.sheet, dateKey);
              appendQueuePlanV4_(
                queue.sheet,
                dateKey,
                replacementId,
                replacementPlan,
                completed > 0 ? 'supplemental' : 'primary',
                Number(replacementId.slice(-3)) || 1,
                'question count changed before session start'
              );
              supersedeQueueV4_(
                ss,
                queue,
                replacementId,
                'question count changed before session start'
              );
              queue = null;
            }
          } else {
            supersedeCandidateGenerationRequestsV4_(ss, dateKey);
          }
        }
      } else if (queue && queue.status === 'presented') {
        adjustmentResult = reconcilePresentedQueueTargetV4_(
          ss,
          queue,
          effectiveTodayCount,
          'question count changed during session'
        );
      }
      if ((!queue || queue.status === 'committed') && !adjustmentResult) {
        adjustmentResult = ensureQueueForDateV4Unlocked_(
          ss,
          parseDateKey_(dateKey),
          'question count changed by user'
        );
      }
    }
    invalidateLearningDashboardCacheV4_();
    var control = buildQuestionCountControlV4_(ss, dateKey);
    control.ok = true;
    control.requestedInputCount = requestedInputCount;
    control.effectiveTodayCount = control.requestedCount;
    control.raisedToCompletedCount = control.requestedCount > requestedInputCount;
    if (adjustmentResult && adjustmentResult.requestId) {
      control.shortfallRequestId = adjustmentResult.requestId;
    }
    return control;
  } finally {
    lock.releaseLock();
  }
}

function buildQuestionCountControlV4_(ss, dateKey) {
  var settings = readQuestionCountSettingsV4_(ss, dateKey);
  var queue = findQueueForDateV4_(ss, dateKey);
  var completed = completedQuestionsForDateV4_(ss, dateKey, '');
  var locked = queue && queue.status === 'presented'
    ? countLockedDraftsV4_(ss, queue.sessionId)
    : 0;
  var request = findActiveCandidateGenerationRequestV4_(ss, dateKey);
  return {
    ok: true,
    date: dateKey,
    defaultCount: settings.defaultCount,
    requestedCount: settings.targetCount,
    hasTodayOverride: settings.hasOverride,
    minCount: settings.minCount,
    maxCount: settings.maxCount,
    maxBatchCount: settings.maxBatchCount,
    completed: completed,
    queueId: queue ? queue.queueId : '',
    queueStatus: queue ? queue.status : 'missing',
    queueKind: queue ? queue.queueKind : '',
    plannedCount: queue ? queue.plannedCount : 0,
    adjustedTarget: queue ? queue.adjustedTarget : 0,
    lockedCount: locked,
    shortfallRequestId: request ? request.requestId : '',
    shortfallCount: request ? request.shortfallCount : 0,
    shortfallStatus: request ? request.status : ''
  };
}

function writeConfigValueV4_(ss, key, value, note) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][0]) === key) {
      var range = sheet.getRange(i + 1, 1, 1, 3);
      range.setValues([[key, value, note || stringValue_(values[i][2])]]);
      if (key === 'question_count_override_date') {
        sheet.getRange(i + 1, 2).setNumberFormat('@').setValue(stringValue_(value));
      }
      return;
    }
  }
  sheet.appendRow([key, value, note || '']);
  if (key === 'question_count_override_date') {
    sheet.getRange(sheet.getLastRow(), 2).setNumberFormat('@').setValue(stringValue_(value));
  }
}

function setQueueAdjustedTargetV4_(queue, target, reason) {
  target = Number(target);
  if (!isFinite(target) || Math.floor(target) !== target || target < 0 || target > queue.plannedCount) {
    throw new Error('Adjusted session target is outside the current daily set.');
  }
  queue.rows.forEach(function(item) {
    queue.sheet.getRange(item.rowNumber, queue.headers['Adjusted Target'] + 1).setValue(target);
    queue.sheet.getRange(item.rowNumber, queue.headers['Change Reason'] + 1).setValue(reason || '');
  });
  SpreadsheetApp.flush();
}

function countLockedDraftsV4_(ss, sessionId) {
  if (!sessionId) return 0;
  return readDraftsForSessionV4_(ss, sessionId).filter(function(draft) {
    return isProtectedDraftV4_(draft, sessionId);
  }).length;
}

function isProtectedDraftV4_(draft, sessionId) {
  if (isDraftRevealedV4_(draft, sessionId)) return true;
  return Boolean(
    draft &&
    stringValue_(draft.submitStatus).toLowerCase() === 'submitted' &&
    stringValue_(draft.submissionId) &&
    stringValue_(draft.answer) &&
    stringValue_(draft.answerHash)
  );
}

function selectActiveQuestionPositionsV4_(queuePositions, target, lockedPositions) {
  var active = {};
  var positions = [];
  if (!isFinite(target) || Math.floor(target) !== target || target < 0) {
    throw new Error('The active question target is invalid.');
  }
  (lockedPositions || []).forEach(function(rawPosition) {
    var position = Number(rawPosition);
    if (!isFinite(position) || Math.floor(position) !== position || active[position]) return;
    active[position] = true;
    positions.push(position);
  });
  target = Math.max(target, positions.length);
  (queuePositions || []).slice().sort(function(a, b) { return Number(a) - Number(b); })
    .forEach(function(rawPosition) {
    var position = Number(rawPosition);
    if (positions.length >= target || active[position]) return;
    active[position] = true;
    positions.push(position);
  });
  positions.sort(function(a, b) { return a - b; });
  return {
    positions: positions,
    byPosition: active,
    count: positions.length,
    target: target
  };
}

function activeQuestionPositionsV4_(ss, queue) {
  var target = queue.adjustedTarget === undefined || queue.adjustedTarget === null
    ? Number(queue.plannedCount || queue.rows.length)
    : Number(queue.adjustedTarget);
  var lockedPositions = queue.sessionId
    ? readDraftsForSessionV4_(ss, queue.sessionId).filter(function(draft) {
      return isProtectedDraftV4_(draft, queue.sessionId);
    }).map(function(draft) { return draft.position; })
    : [];
  return selectActiveQuestionPositionsV4_(
    queue.rows.map(function(item) {
      return Number(item.values[queue.headers.Position]);
    }),
    target,
    lockedPositions
  );
}

function activeQueueRowsV4_(queue) {
  if (!queue || !queue.rows) return [];
  var activeStatus = stringValue_(queue.status).toLowerCase();
  return queue.rows.filter(function(item) {
    return stringValue_(item.values[queue.headers['Queue Status']]).toLowerCase() === activeStatus;
  });
}

function activeQueueCompositionV4_(queue) {
  var rows = activeQueueRowsV4_(queue);
  return {
    due: rows.filter(function(item) {
      return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() !== 'new';
    }).length,
    fresh: rows.filter(function(item) {
      return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() === 'new';
    }).length
  };
}

function reconcileQueueActivePositionsV4_(ss, queue, activePositions, reason) {
  var active = activePositions.byPosition;
  var queueStatus = queue.status === 'planned' ? 'planned' : 'presented';
  var changedQueueRows = 0;
  queue.rows.forEach(function(item) {
    var position = Number(item.values[queue.headers.Position]);
    var currentStatus = stringValue_(item.values[queue.headers['Queue Status']]).toLowerCase();
    var nextStatus = active[position]
      ? (currentStatus === 'deferred' ? queueStatus : currentStatus)
      : (['planned', 'presented'].indexOf(currentStatus) !== -1 ? 'deferred' : currentStatus);
    if (nextStatus === currentStatus) return;
    queue.sheet.getRange(item.rowNumber, queue.headers['Queue Status'] + 1).setValue(nextStatus);
    queue.sheet.getRange(item.rowNumber, queue.headers['Change Reason'] + 1)
      .setValue(reason || 'question count changed during session');
    changedQueueRows++;
  });

  var questionSheet = requireSheet_(ss, ER4.questionSheet);
  var questionValues = questionSheet.getDataRange().getValues();
  var questionHeaders = headerMap_(questionValues[0]);
  var changedQuestionRows = 0;
  for (var q = 1; q < questionValues.length; q++) {
    if (
      stringValue_(questionValues[q][questionHeaders['Queue ID']]) !== queue.queueId ||
      stringValue_(questionValues[q][questionHeaders['Contract Version']]) !== ER4.contractVersion
    ) continue;
    var questionPosition = Number(questionValues[q][questionHeaders.Position]);
    var questionStatus = stringValue_(
      questionValues[q][questionHeaders['Question Status']]
    ).toLowerCase();
    var nextQuestionStatus = questionStatus;
    if (!active[questionPosition] && ['staged', 'ready', 'bound'].indexOf(questionStatus) !== -1) {
      nextQuestionStatus = 'deferred';
    } else if (active[questionPosition] && questionStatus === 'deferred') {
      nextQuestionStatus = stringValue_(questionValues[q][questionHeaders['Session ID']])
        ? 'bound'
        : (stringValue_(questionValues[q][questionHeaders['Content Hash']]) ? 'ready' : 'staged');
    }
    if (nextQuestionStatus !== questionStatus) {
      questionSheet.getRange(q + 1, questionHeaders['Question Status'] + 1)
        .setValue(nextQuestionStatus);
      changedQuestionRows++;
    }
  }

  var changedDraftRows = 0;
  if (queue.sessionId) {
    var draftSheet = requireSheet_(ss, ER4.draftSheet);
    var draftValues = draftSheet.getDataRange().getValues();
    var draftHeaders = headerMap_(draftValues[0]);
    for (var d = 1; d < draftValues.length; d++) {
      if (stringValue_(draftValues[d][draftHeaders['Session ID']]) !== queue.sessionId) continue;
      var draftPosition = Number(draftValues[d][draftHeaders.Position]);
      var draftStatus = stringValue_(draftValues[d][draftHeaders['Submit Status']]).toLowerCase();
      if (!active[draftPosition] && draftStatus === 'draft') {
        draftSheet.getRange(d + 1, draftHeaders['Submit Status'] + 1).setValue('deferred');
        changedDraftRows++;
      }
    }
  }
  if (changedQueueRows || changedQuestionRows || changedDraftRows) SpreadsheetApp.flush();
  return {
    queueRows: changedQueueRows,
    questionRows: changedQuestionRows,
    draftRows: changedDraftRows
  };
}

function supersedeQueueV4_(ss, queue, replacementId, reason) {
  var supersededAt = new Date();
  queue.rows.forEach(function(item) {
    queue.sheet.getRange(item.rowNumber, queue.headers['Queue Status'] + 1).setValue('superseded');
    queue.sheet.getRange(item.rowNumber, queue.headers['Superseded By'] + 1).setValue(replacementId || '');
    queue.sheet.getRange(item.rowNumber, queue.headers['Superseded At'] + 1)
      .setValue(supersededAt)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    queue.sheet.getRange(item.rowNumber, queue.headers['Change Reason'] + 1).setValue(reason || '');
  });
  var questionSheet = requireSheet_(ss, ER4.questionSheet);
  var questionValues = questionSheet.getDataRange().getValues();
  var questionHeaders = headerMap_(questionValues[0]);
  for (var i = 1; i < questionValues.length; i++) {
    if (
      stringValue_(questionValues[i][questionHeaders['Queue ID']]) === queue.queueId &&
      ['staged', 'ready', 'bound'].indexOf(
        stringValue_(questionValues[i][questionHeaders['Question Status']]).toLowerCase()
      ) !== -1
    ) {
      questionSheet.getRange(i + 1, questionHeaders['Question Status'] + 1).setValue('rejected');
    }
  }
  if (queue.sessionId) {
    var draftSheet = requireSheet_(ss, ER4.draftSheet);
    var draftValues = draftSheet.getDataRange().getValues();
    var draftHeaders = headerMap_(draftValues[0]);
    for (var d = 1; d < draftValues.length; d++) {
      if (
        stringValue_(draftValues[d][draftHeaders['Session ID']]) === queue.sessionId &&
        stringValue_(draftValues[d][draftHeaders['Submit Status']]).toLowerCase() === 'draft'
      ) {
        draftSheet.getRange(d + 1, draftHeaders['Submit Status'] + 1).setValue('deferred');
      }
    }
  }
  SpreadsheetApp.flush();
}

function findActiveCandidateGenerationRequestV4_(ss, dateKey) {
  var sheet = ss.getSheetByName(ER4.candidateGenerationSheet);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (
      Number(values[i][headers.Position]) === 0 &&
      dashboardDateKeyV4_(values[i][headers['Queue Date']]) === dateKey &&
      ['requested', 'staged'].indexOf(
        stringValue_(values[i][headers['Generation Status']]).toLowerCase()
      ) !== -1 &&
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion
    ) {
      matches.push(values[i]);
    }
  }
  if (matches.length > 1) throw new Error('More than one active material-shortfall request exists.');
  if (!matches.length) return null;
  return {
    requestId: stringValue_(matches[0][headers['Request ID']]),
    requestedCount: Number(matches[0][headers['Requested Count']]) || 0,
    shortfallCount: Number(matches[0][headers['Shortfall Count']]) || 0,
    status: stringValue_(matches[0][headers['Generation Status']]).toLowerCase()
  };
}

function supersedeCandidateGenerationRequestsV4_(ss, dateKey) {
  var sheet = ss.getSheetByName(ER4.candidateGenerationSheet);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var activeIds = {};
  for (var i = 1; i < values.length; i++) {
    if (
      Number(values[i][headers.Position]) === 0 &&
      dashboardDateKeyV4_(values[i][headers['Queue Date']]) === dateKey &&
      ['requested', 'staged'].indexOf(
        stringValue_(values[i][headers['Generation Status']]).toLowerCase()
      ) !== -1 &&
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion
    ) {
      activeIds[stringValue_(values[i][headers['Request ID']])] = true;
    }
  }
  var changed = 0;
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var requestId = stringValue_(values[rowIndex][headers['Request ID']]);
    var status = stringValue_(values[rowIndex][headers['Generation Status']]).toLowerCase();
    if (activeIds[requestId] && ['requested', 'staged'].indexOf(status) !== -1) {
      sheet.getRange(rowIndex + 1, headers['Generation Status'] + 1).setValue('superseded');
      changed++;
    }
  }
  if (changed) SpreadsheetApp.flush();
  return changed;
}
