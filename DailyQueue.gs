/**
 * English Review Database v3.0
 *
 * Deterministic daily selection:
 *   1) all scheduled due items (active or mastered), capped at the frozen target;
 *   2) if due items are fewer than the frozen target, fill the remaining slots with
 *      Candidate Bank rows whose Status is "ready";
 *   3) never fill with non-due old Phrase Bank items;
 *   4) when due items exceed the current daily-set count, leave the unselected items overdue.
 *
 * Daily Queue is the durable audit record consumed by the ChatGPT task.
 */

var DQ3 = {
  timezone: 'Asia/Shanghai',
  contractVersion: '3.0',
  legacyQuestionCount: 20,
  minQuestionCount: 1,
  maxDailyQuestionCount: 150,
  // A Queue ID is one user-visible daily set. AI staging may still use
  // smaller internal segments, but the Queue itself supports the full range.
  maxBatchQuestionCount: 150,
  aiFallbackPoolTarget: 0,
  reviewEligibleStatuses: ['active', 'mastered'],
  phraseSheet: 'Phrase Bank',
  candidateSheet: 'Candidate Bank',
  queueSheet: 'Daily Queue',
  configSheet: 'Config',
  readmeSheet: 'README',
  triggerHandler: 'scheduledBuildDailyQueue'
};

var DQ3_QUEUE_HEADERS = [
  'Queue Date',
  'Queue ID',
  'Position',
  'Selection Type',
  'Phrase ID',
  'Candidate ID',
  'Chunk',
  '中文提示',
  'Topic',
  'Difficulty',
  'Natural Example',
  'Original Next Review',
  'Priority Reason',
  'Queue Status',
  'Session ID',
  'Created At',
  'Committed At',
  'Contract Version',
  'Presented At',
  'Planned Count',
  'Adjusted Target',
  'Queue Kind',
  'Plan Revision',
  'Superseded By',
  'Superseded At',
  'Change Reason'
];

var DQ3_CANDIDATE_EXTRA_HEADERS = [
  '中文提示',
  'Topic',
  'Difficulty',
  'Natural Example',
  'Common Mistake',
  'Origin Type',
  'Origin Context ID',
  'Selected Text',
  'Source URL',
  'Intake Priority'
];

function setupDailyQueueV3() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureCandidateMetadataColumns_(ss);
    ensureDailyQueueSheet_(ss);
    updateConfigV3_(ss);
    updateReadmeV3_(ss);
    installDailyQueueTrigger_();
    SpreadsheetApp.flush();
    return {
      ok: true,
      contractVersion: DQ3.contractVersion,
      queueSheet: DQ3.queueSheet,
      readyCandidates: countReadyCandidates_(ss),
      triggerHandler: DQ3.triggerHandler
    };
  } finally {
    lock.releaseLock();
  }
}

function scheduledBuildDailyQueue() {
  return buildDailyQueue();
}

function buildDailyQueue() {
  return buildDailyQueueForDate_(new Date());
}

function buildTomorrowDailyQueue() {
  return buildDailyQueueForDate_(tomorrowDate_());
}

function previewDailyQueue() {
  return previewDailyQueueForDate_(new Date());
}

function previewTomorrowDailyQueue() {
  return previewDailyQueueForDate_(tomorrowDate_());
}

function getTodayDailyQueue() {
  return getDailyQueueForDate_(new Date());
}

function getTomorrowDailyQueue() {
  return getDailyQueueForDate_(tomorrowDate_());
}

function buildDailyQueueForDate_(targetDate) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV3_(ss);
    ensureCandidateMetadataColumns_(ss);
    var queueSheet = ensureDailyQueueSheet_(ss);
    var dateKey = formatDateKey_(targetDate);
    var queueId = 'DQ-' + dateKey.replace(/-/g, '') + '-001';
    var existing = readQueueRowsById_(queueSheet, queueId);

    if (existing.length > 0) {
      validateMaterializedQueue_(existing, queueId);
      return summarizeQueueRows_(existing, queueId, true);
    }

    var questionCount = DQ3.legacyQuestionCount;
    var plan = calculateDailyQueuePlan_(ss, targetDate, questionCount);
    validatePlan_(plan);
    var createdAt = new Date();
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
        DQ3.contractVersion,
        '',
        questionCount,
        questionCount,
        'primary',
        1,
        '',
        '',
        'legacy v3 builder'
      ];
    });

    var startRow = Math.max(queueSheet.getLastRow() + 1, 2);
    queueSheet.getRange(startRow, 1, rows.length, DQ3_QUEUE_HEADERS.length).setValues(rows);
    queueSheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
    queueSheet.getRange(startRow, 12, rows.length, 1).setNumberFormat('yyyy-mm-dd');
    queueSheet.getRange(startRow, 16, rows.length, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    queueSheet.getRange(startRow, 20, rows.length, 2).setNumberFormat('0');
    queueSheet.getRange(startRow, 23, rows.length, 1).setNumberFormat('0');
    queueSheet.getRange(startRow, 25, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    SpreadsheetApp.flush();

    var written = readQueueRowsById_(queueSheet, queueId);
    validateMaterializedQueue_(written, queueId);
    return summarizeQueueRows_(written, queueId, false);
  } finally {
    lock.releaseLock();
  }
}

function previewDailyQueueForDate_(targetDate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV3_(ss);
  var plan = calculateDailyQueuePlan_(ss, targetDate, DQ3.legacyQuestionCount);
  validatePlan_(plan);
  return {
    ok: true,
    date: formatDateKey_(targetDate),
    dueCount: plan.dueCount,
    selectedDueCount: plan.selectedDueCount,
    newCount: plan.newCount,
    backlogCount: plan.backlogCount,
    readyCandidateCount: plan.readyCandidateCount,
    items: plan.items
  };
}

function calculateDailyQueuePlan_(ss, targetDate, questionCount) {
  questionCount = normalizeQuestionCount_(questionCount, DQ3.legacyQuestionCount);
  var phraseSheet = requireSheet_(ss, DQ3.phraseSheet);
  var candidateSheet = requireSheet_(ss, DQ3.candidateSheet);
  var targetKey = formatDateKey_(targetDate);
  var phraseValues = phraseSheet.getDataRange().getValues();
  var phraseHeaders = headerMap_(phraseValues[0]);
  requireHeaders_(phraseHeaders, [
    'ID',
    'Chunk',
    '中文提示',
    'Topic',
    'Difficulty',
    'Status',
    'Review Stage',
    'Next Review',
    'Natural Example',
    'Last Result',
    'Canonical Pattern'
  ], DQ3.phraseSheet);

  var phraseChunks = {};
  var dueItems = [];
  for (var r = 1; r < phraseValues.length; r++) {
    var row = phraseValues[r];
    var phraseId = stringValue_(row[phraseHeaders.ID]);
    var chunk = stringValue_(row[phraseHeaders.Chunk]);
    if (!phraseId || !chunk) continue;

    phraseChunks[normalizeChunk_(chunk)] = true;
    var canonical = stringValue_(row[phraseHeaders['Canonical Pattern']]);
    if (canonical) phraseChunks[normalizeChunk_(canonical)] = true;

    var status = stringValue_(row[phraseHeaders.Status]).toLowerCase();
    var nextReview = row[phraseHeaders['Next Review']];
    if (!isReviewEligibleStatus_(status) || !isDateValue_(nextReview)) continue;

    var nextKey = formatDateKey_(nextReview);
    if (nextKey > targetKey) continue;

    var lastResult = stringValue_(row[phraseHeaders['Last Result']]).toLowerCase();
    var stage = numberValue_(row[phraseHeaders['Review Stage']], 1);
    dueItems.push({
      selectionType: nextKey < targetKey ? 'overdue' : 'due_today',
      phraseId: phraseId,
      candidateId: '',
      chunk: chunk,
      chineseCue: stringValue_(row[phraseHeaders['中文提示']]),
      topic: stringValue_(row[phraseHeaders.Topic]),
      difficulty: stringValue_(row[phraseHeaders.Difficulty]),
      naturalExample: stringValue_(row[phraseHeaders['Natural Example']]),
      originalNextReview: nextReview,
      nextReviewKey: nextKey,
      resultRank: resultRank_(lastResult),
      lastResult: lastResult || 'none',
      stage: stage,
      status: status,
      priorityReason:
        (nextKey < targetKey ? 'overdue since ' : 'due today ') +
        nextKey + '; status=' + status +
        '; result=' + (lastResult || 'none') + '; stage=' + stage
    });
  }

  dueItems.sort(function(a, b) {
    return compareValues_(a.nextReviewKey, b.nextReviewKey) ||
      compareValues_(a.resultRank, b.resultRank) ||
      compareValues_(a.stage, b.stage) ||
      compareValues_(a.phraseId, b.phraseId);
  });

  var selectedDue = dueItems.slice(0, questionCount);
  var newCount = dueItems.length > questionCount
    ? 0
    : questionCount - selectedDue.length;

  var candidateValues = candidateSheet.getDataRange().getValues();
  var candidateHeaders = headerMap_(candidateValues[0]);
  requireHeaders_(candidateHeaders, [
    'Candidate ID',
    'Date Added',
    'Candidate',
    'Candidate Type',
    'Status',
    '中文提示',
    'Topic',
    'Difficulty',
    'Natural Example',
    'Origin Type',
    'Origin Context ID',
    'Selected Text',
    'Source URL',
    'Intake Priority'
  ], DQ3.candidateSheet);

  var readyCandidates = [];
  for (var c = 1; c < candidateValues.length; c++) {
    var candidateRow = candidateValues[c];
    var candidateId = stringValue_(candidateRow[candidateHeaders['Candidate ID']]);
    var candidateChunk = stringValue_(candidateRow[candidateHeaders.Candidate]);
    var candidateStatus = stringValue_(candidateRow[candidateHeaders.Status]).toLowerCase();
    var candidateType = stringValue_(candidateRow[candidateHeaders['Candidate Type']]).toLowerCase();
    if (!candidateId || !candidateChunk || candidateStatus !== 'ready' || candidateType !== 'chunk') continue;
    if (phraseChunks[normalizeChunk_(candidateChunk)]) continue;

    var cue = stringValue_(candidateRow[candidateHeaders['中文提示']]);
    var topic = stringValue_(candidateRow[candidateHeaders.Topic]);
    var difficulty = stringValue_(candidateRow[candidateHeaders.Difficulty]);
    var example = stringValue_(candidateRow[candidateHeaders['Natural Example']]);
    if (!cue || !topic || !difficulty || !example) {
      throw new Error('Ready candidate lacks required metadata: ' + candidateId);
    }

    var dateAdded = candidateRow[candidateHeaders['Date Added']];
    var dateAddedKey = isDateValue_(dateAdded) ? formatDateKey_(dateAdded) : '9999-12-31';
    var originType = normalizedCandidateOriginType_(
      candidateRow[candidateHeaders['Origin Type']]
    );
    var originContextId = stringValue_(candidateRow[candidateHeaders['Origin Context ID']]);
    var intakePriority = stringValue_(candidateRow[candidateHeaders['Intake Priority']]).toLowerCase();
    var isUserContext = originType === 'user_context';
    readyCandidates.push({
      selectionType: 'new',
      phraseId: '',
      candidateId: candidateId,
      chunk: candidateChunk,
      chineseCue: cue,
      topic: topic,
      difficulty: difficulty,
      naturalExample: example,
      originType: originType,
      originContextId: originContextId,
      intakePriority: intakePriority || 'normal',
      isUserContext: isUserContext,
      originalNextReview: '',
      dateAddedKey: dateAddedKey,
      priorityReason:
        candidateOriginLabel_(originType) +
        '; priority=' + (intakePriority || 'normal') +
        '; added=' + dateAddedKey +
        (originContextId ? '; context=' + originContextId : '')
    });
  }

  readyCandidates.sort(function(a, b) {
    return compareValues_(candidateOriginRank_(a.originType), candidateOriginRank_(b.originType)) ||
      compareValues_(candidateIntakePriorityRank_(a.intakePriority), candidateIntakePriorityRank_(b.intakePriority)) ||
      compareValues_(a.dateAddedKey, b.dateAddedKey) ||
      compareValues_(a.candidateId, b.candidateId);
  });

  var selectedCandidates = readyCandidates.slice(0, newCount);

  selectedCandidates.sort(function(a, b) {
    return compareValues_(candidateOriginRank_(a.originType), candidateOriginRank_(b.originType)) ||
      compareValues_(candidateIntakePriorityRank_(a.intakePriority), candidateIntakePriorityRank_(b.intakePriority)) ||
      compareValues_(a.dateAddedKey, b.dateAddedKey) ||
      compareValues_(a.candidateId, b.candidateId);
  });

  return {
    targetCount: questionCount,
    dueCount: dueItems.length,
    selectedDueCount: selectedDue.length,
    newCount: newCount,
    selectedNewCount: selectedCandidates.length,
    candidateShortfall: Math.max(0, newCount - selectedCandidates.length),
    backlogCount: Math.max(0, dueItems.length - questionCount),
    readyCandidateCount: readyCandidates.length,
    items: selectedDue.concat(selectedCandidates)
  };
}

function validatePlan_(plan) {
  var questionCount = normalizeQuestionCount_(plan && plan.targetCount, DQ3.legacyQuestionCount);
  if (plan.items.length !== questionCount) {
    if (Number(plan.candidateShortfall) > 0) {
      throw new Error(
        'Daily Queue blocked: target is ' + questionCount +
        ', needs ' + plan.newCount + ' ready candidates after due reviews, but only ' +
        plan.selectedNewCount + ' eligible candidates are available; shortfall=' +
        plan.candidateShortfall + '.'
      );
    }
    throw new Error(
      'Queue plan must contain exactly ' + questionCount +
      ' items; found ' + plan.items.length + '.'
    );
  }
  if (plan.dueCount <= questionCount && plan.selectedDueCount !== plan.dueCount) {
    throw new Error('Queue plan omitted a due item.');
  }
  if (plan.dueCount > questionCount && plan.newCount !== 0) {
    throw new Error('Queue plan added new content while due backlog exceeds the target.');
  }

  var keys = {};
  plan.items.forEach(function(item) {
    var key = item.phraseId ? 'P:' + item.phraseId : 'C:' + item.candidateId;
    if (!key || keys[key]) throw new Error('Duplicate or missing queue identity: ' + key);
    keys[key] = true;
  });
}

function validateMaterializedQueue_(rows, queueId) {
  var plannedCount = queuePlannedCountFromRows_(rows);
  if (rows.length !== plannedCount) {
    throw new Error(
      'Existing queue ' + queueId + ' is invalid: expected ' + plannedCount +
      ' rows, found ' + rows.length + '.'
    );
  }
  var positions = {};
  var identities = {};
  rows.forEach(function(row) {
    var position = Number(row[2]);
    var phraseId = stringValue_(row[4]);
    var candidateId = stringValue_(row[5]);
    var contract = stringValue_(row[17]);
    if (position < 1 || position > plannedCount || positions[position]) {
      throw new Error('Invalid or duplicate queue position in ' + queueId + ': ' + position);
    }
    positions[position] = true;
    var identity = phraseId ? 'P:' + phraseId : 'C:' + candidateId;
    if (identity === 'C:' || identities[identity]) {
      throw new Error('Invalid or duplicate queue identity in ' + queueId + ': ' + identity);
    }
    identities[identity] = true;
    if (!isContractVersion_(contract)) {
      throw new Error('Queue contract mismatch in ' + queueId + ': ' + contract);
    }
  });
}

function summarizeQueueRows_(rows, queueId, reused) {
  var due = 0;
  var fresh = 0;
  rows.forEach(function(row) {
    if (stringValue_(row[3]) === 'new') fresh++;
    else due++;
  });
  return {
    ok: true,
    queueId: queueId,
    rowCount: rows.length,
    plannedCount: queuePlannedCountFromRows_(rows),
    dueCount: due,
    newCount: fresh,
    reusedExistingQueue: reused
  };
}

function getDailyQueueForDate_(targetDate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = requireSheet_(ss, DQ3.queueSheet);
  var dateKey = formatDateKey_(targetDate);
  var queueId = 'DQ-' + dateKey.replace(/-/g, '') + '-001';
  var rows = readQueueRowsById_(sheet, queueId);
  validateMaterializedQueue_(rows, queueId);
  return {
    queueId: queueId,
    headers: DQ3_QUEUE_HEADERS,
    rows: rows
  };
}

function readQueueRowsById_(sheet, queueId) {
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][1]) === queueId) rows.push(values[i]);
  }
  rows.sort(function(a, b) { return Number(a[2]) - Number(b[2]); });
  return rows;
}

function ensureDailyQueueSheet_(ss) {
  var sheet = ss.getSheetByName(DQ3.queueSheet);
  if (!sheet) sheet = ss.insertSheet(DQ3.queueSheet);

  if (sheet.getMaxColumns() < DQ3_QUEUE_HEADERS.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      DQ3_QUEUE_HEADERS.length - sheet.getMaxColumns()
    );
  }

  var currentHeaders = sheet.getRange(1, 1, 1, DQ3_QUEUE_HEADERS.length).getValues()[0];
  var headerMismatch = DQ3_QUEUE_HEADERS.some(function(header, index) {
    var current = stringValue_(currentHeaders[index]);
    return Boolean(current && current !== header);
  });
  if (headerMismatch && sheet.getLastRow() > 1) {
    throw new Error('Daily Queue already contains data but one or more existing headers conflict.');
  }
  sheet.getRange(1, 1, 1, DQ3_QUEUE_HEADERS.length).setValues([DQ3_QUEUE_HEADERS]);
  sheet.getRange(2, 18, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, DQ3_QUEUE_HEADERS.length)
    .setBackground('#f1f3f4')
    .setFontColor('#202124')
    .setFontWeight('bold')
    .setWrap(true);

  var widths = [95, 150, 70, 105, 90, 100, 180, 160, 135, 85, 260, 125, 260, 100, 130, 150, 150, 105, 155, 105, 115, 110, 95, 160, 155, 260];
  widths.forEach(function(width, index) { sheet.setColumnWidth(index + 1, width); });

  var filter = sheet.getFilter();
  if (!filter || filter.getRange().getNumColumns() !== DQ3_QUEUE_HEADERS.length) {
    if (filter) filter.remove();
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), DQ3_QUEUE_HEADERS.length).createFilter();
  }
  return sheet;
}

function ensureCandidateMetadataColumns_(ss) {
  var sheet = requireSheet_(ss, DQ3.candidateSheet);
  var requiredColumns = 12 + DQ3_CANDIDATE_EXTRA_HEADERS.length;
  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredColumns - sheet.getMaxColumns());
  }
  var existing = sheet.getRange(1, 13, 1, DQ3_CANDIDATE_EXTRA_HEADERS.length).getValues()[0];
  var conflict = existing.some(function(value, index) {
    return value && stringValue_(value) !== DQ3_CANDIDATE_EXTRA_HEADERS[index];
  });
  if (conflict) throw new Error('Candidate Bank columns M:V contain unexpected headers.');

  sheet.getRange(1, 13, 1, DQ3_CANDIDATE_EXTRA_HEADERS.length)
    .setValues([DQ3_CANDIDATE_EXTRA_HEADERS]);
  sheet.getRange(1, 1, 1, requiredColumns)
    .setBackground('#f1f3f4')
    .setFontColor('#202124')
    .setFontWeight('bold')
    .setWrap(true);
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['promoted', 'existing', 'ready', 'rejected', 'suspended'], true)
    .setAllowInvalid(false)
    .setHelpText('Only ready chunk candidates may fill new Daily Queue slots.')
    .build();
  sheet.getRange(2, 8, sheet.getMaxRows() - 1, 1).setDataValidation(statusRule);
  var originRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      'user_context',
      'learning_evidence',
      'conversation_derived',
      'legacy',
      'ai_fallback'
    ], true)
    .setAllowInvalid(false)
    .setHelpText('Personal evidence is always selected before AI fallback content.')
    .build();
  sheet.getRange(2, 18, sheet.getMaxRows() - 1, 1).setDataValidation(originRule);
  var intakePriorityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['high', 'normal', 'fallback'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 22, sheet.getMaxRows() - 1, 1).setDataValidation(intakePriorityRule);
  [150, 120, 85, 260, 180, 150, 155, 220, 300, 120].forEach(function(width, index) {
    sheet.setColumnWidth(index + 13, width);
  });
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, sheet.getMaxRows(), requiredColumns).createFilter();
}

function updateConfigV3_(ss) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var rows = sheet.getDataRange().getValues();
  var rowByKey = {};
  for (var i = 1; i < rows.length; i++) {
    var key = stringValue_(rows[i][0]);
    if (key) rowByKey[key] = i + 1;
  }

  var updates = [
    ['status_values', 'active, mastered, suspended', 'Both active and mastered items remain eligible when Next Review is due; suspended items are excluded.'],
    ['question_disambiguation', 'target chunk must be uniquely cued without revealing the answer', 'If another common natural expression fully fits, add a semantic boundary or contrast cue.'],
    ['max_new_chunks_per_session', 150, 'New content may fill every slot left in the current daily set after due items are selected.'],
    ['max_active_intake_per_session', 150, 'One user-visible Daily Queue supports the full requested range of 1–150.'],
    ['priority_order', 'scheduled active/mastered due items; then ready Candidate Bank chunks ordered user_context → learning_evidence → conversation_derived → legacy → ai_fallback', 'Personal sources may fill every remaining new-item slot; there is no daily user_context cap.'],
    ['contract_version', DQ3.contractVersion, 'Required by every scheduled run; stop if Daily Queue is absent, incomplete, stale, or mismatched.'],
    ['due_definition', 'Status in {active, mastered} AND Next Review<=today', 'Mastered is a retention state, not retirement; suspended items remain excluded.'],
    ['mastered_review_policy', 'include mastered items when Next Review<=today', 'A later non-mastered primary answer resets Mastery Streak and returns the item to active.'],
    ['pending_review_count', 'COUNT of active or mastered Phrase Bank rows with Next Review<=today', 'Include overdue and due-today items; exclude suspended items.'],
    ['actual_start_source', 'Daily Queue Presented At', 'Required for sessions opened on or after 2026-07-28; capture one real Asia/Shanghai timestamp at scheduled_open and reuse it in Session Log; never estimate. Earlier committed history remains unchanged.'],
    ['new_chunk_gate', 'new_count=max(0,planned_count-selected_due_count); Candidate Status=ready', 'Personal-source ready candidates are selected first; an exact AI request is created only for a real shortfall.'],
    ['new_chunk_dynamic_limit', 'max(0,planned_count-selected_due_count)', 'planned_count is the full 1–150 user-visible daily set.'],
    ['daily_queue_sheet', DQ3.queueSheet, 'Materialized daily selection and audit ledger; ChatGPT must not recalculate or substitute items.'],
    ['daily_queue_builder', 'Apps Script buildDailyQueue', 'Daily trigger or Web App writes one 1–150 row daily set; unfinished active sets can be safely extended without replacing completed work.'],
    ['daily_queue_invariant', 'exactly Planned Count unique identities; due items first; no non-due old filler', 'For new rows Candidate ID is the identity until a Phrase ID is assigned during commit.'],
    ['overdue_behavior', 'leave unselected due items at their original Next Review', 'They remain overdue and are selected first on the next day; never rewrite them to tomorrow.'],
    ['queue_new_item_source', 'Candidate Bank rows with Status=ready and complete M:Q metadata', 'Apps Script selects the durable master inventory by source priority; ChatGPT never substitutes a new item at question time.'],
    ['queue_failure_behavior', 'stop and report; never fall back to prompt-only selection', 'Applies to missing, stale, duplicate, incomplete, or under-supplied queues.'],
    ['candidate_status_values', 'ready, promoted, existing, rejected, suspended', 'Deferred without a reactivation rule is retired; only ready chunk candidates are eligible for new-item queue slots.'],
    ['candidate_ready_pool_target', 'retired', 'Verified grading no longer creates candidates merely to keep forty ready rows.'],
    ['candidate_ai_fallback_target', 'on_demand_shortfall', 'No fixed reserve; v4 requests exact personalized material only when a requested Queue cannot be filled.'],
    ['database_write_order', 'Review Log → Error Log → Candidate Bank → Phrase Bank state → Daily Queue → Session Log', 'Mark Daily Queue committed before writing Session Log last.']
  ];

  updates.forEach(function(update) {
    var key = update[0];
    var rowNumber = rowByKey[key];
    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, 3).setValues([update]);
    } else {
      sheet.appendRow(update);
      rowByKey[key] = sheet.getLastRow();
    }
  });
  var contractRow = rowByKey.contract_version;
  sheet.getRange(contractRow, 2).setNumberFormat('@').setValue(DQ3.contractVersion);
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 520);
  sheet.setColumnWidth(3, 700);
  sheet.getDataRange().setVerticalAlignment('top');
}

function updateReadmeV3_(ss) {
  var sheet = requireSheet_(ss, DQ3.readmeSheet);
  var migrationDate = sheet.getRange('B11').getValue();
  if (!isDateValue_(migrationDate)) migrationDate = new Date();
  sheet.getRange('C1').setValue(
    'v3.0 — Google Sheet is the single source of truth; Apps Script materializes the deterministic Daily Queue.'
  );
  sheet.getRange('A2:C2').setValues([[
    'Workflow',
    'Candidate Bank → Daily Queue → batch questions → logs/state → Session Log',
    'Apps Script selects exact items; ChatGPT must consume the queue without substitution.'
  ]]);
  sheet.getRange('A9:C9').setValues([[
    'Config',
    'Executable data contract',
    'Every run must require contract_version=3.0 and validate the current Daily Queue.'
  ]]);
  sheet.getRange('A10:C10').setValues([[
    'Pending review',
    'Status in {active, mastered} AND Next Review<=today',
    'Mastered remains scheduled for long-term retention; suspended is excluded. Due items are selected first up to the current batch capacity.'
  ]]);
  sheet.getRange('A11:C11').setValues([[
    'Migration',
    migrationDate,
    'v3 adds deterministic Apps Script selection, Candidate ready metadata, and Daily Queue.'
  ]]);
  sheet.getRange('B11').setNumberFormat('yyyy-mm-dd');
  sheet.getRange('A12:C12').setValues([[
    'Write invariant',
    'No final summary before logs + state + queue + readback checks',
    'If any invariant fails, report 数据库更新未完成.'
  ]]);
  sheet.getRange('A13:C13').setValues([[
    'Daily Queue',
    'Exactly Planned Count frozen selections per Queue ID (1–150)',
    'Active/mastered due items first; remaining capacity uses personal-source ready candidates before on-demand AI fallback.'
  ]]);
  sheet.getRange('A14:C14').setValues([[
    'Opening audit',
    'Presented At is captured when the Queue changes from planned to presented',
    'Session Log Actual Start must use this exact timestamp; never estimate it.'
  ]]);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 500);
  sheet.setColumnWidth(3, 700);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 14), 3)
    .setWrap(true)
    .setVerticalAlignment('top');
  sheet.autoResizeRows(1, Math.max(sheet.getLastRow(), 14));
  sheet.setFrozenRows(1);
}

function seedReadyCandidatePoolV3_(ss) {
  var sheet = requireSheet_(ss, DQ3.candidateSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var existingIds = {};
  var existingChunks = {};
  var rowById = {};
  for (var i = 1; i < values.length; i++) {
    var existingId = stringValue_(values[i][headers['Candidate ID']]);
    var existingChunk = stringValue_(values[i][headers.Candidate]);
    if (existingId) {
      existingIds[existingId] = true;
      rowById[existingId] = i + 1;
    }
    if (existingChunk) existingChunks[normalizeChunk_(existingChunk)] = true;
  }

  var seeds = readyCandidateSeedData_();
  var rows = [];
  seeds.forEach(function(seed, index) {
    var id = 'CAN-' + String(118 + index).padStart(4, '0');
    var seededRow = [
      id,
      parseDateKey_('2026-07-26'),
      seed[0],
      'chunk',
      'v3 ready-pool bootstrap',
      seed[2],
      'High-frequency, practical, transferable, and suitable for repeated recall.',
      'ready',
      '',
      '',
      '',
      '',
      seed[1],
      seed[2],
      seed[3],
      seed[4],
      seed[5]
    ];
    if (existingIds[id]) {
      var existingRowNumber = rowById[id];
      var existingStatus = stringValue_(sheet.getRange(existingRowNumber, 8).getValue());
      var existingSeedChunk = stringValue_(sheet.getRange(existingRowNumber, 3).getValue());
      if (!existingStatus && normalizeChunk_(existingSeedChunk) === normalizeChunk_(seed[0])) {
        sheet.getRange(existingRowNumber, 1, 1, 17).setValues([seededRow]);
        sheet.getRange(existingRowNumber, 2).setNumberFormat('yyyy-mm-dd');
      }
      return;
    }
    if (existingChunks[normalizeChunk_(seed[0])]) return;
    rows.push(seededRow);
  });
  if (rows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 17).setValues(rows);
    sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  }
}

function readyCandidateSeedData_() {
  return [
    ['fit something in', '抽时间安排某事', 'daily life/scheduling', 'medium', 'I can fit a short workout in before dinner.', 'fit in something'],
    ['run late', '要迟到了/进度晚了', 'daily life/scheduling', 'easy', 'I am running late, so I will be there in ten minutes.', 'be late running'],
    ['get back to someone', '稍后回复某人', 'work/communication', 'easy', 'Let me check the figures and get back to you.', 'get back someone'],
    ['double-check', '再次确认', 'work/accuracy', 'easy', 'I will double-check the date before sending the invitation.', 'check double'],
    ['keep someone posted', '及时向某人通报进展', 'work/communication', 'medium', 'I will keep you posted on any changes.', 'keep someone post'],
    ['make sure', '确保/确认', 'daily life/general', 'easy', 'Please make sure the door is locked.', 'make it sure'],
    ['figure something out', '想明白/解决某事', 'daily life/problem solving', 'medium', 'We need to figure out why the notification failed.', 'figure about something'],
    ['come up with', '想出/提出', 'work/ideas', 'medium', 'She came up with a simpler solution.', 'come up an idea'],
    ['look into', '调查/进一步了解', 'work/problem solving', 'easy', 'I will look into the issue this afternoon.', 'look the issue'],
    ['sort something out', '把某事处理好', 'daily life/problem solving', 'medium', 'I need a few minutes to sort this out.', 'sort out about it'],
    ['pick up where we left off', '从上次停下的地方继续', 'work/learning', 'medium', 'Let us pick up where we left off yesterday.', 'continue where we leave'],
    ['be tied up', '正忙得脱不开身', 'work/scheduling', 'medium', 'I am tied up until three, but I am free after that.', 'be tied with work'],
    ['take care of', '处理/照顾', 'daily life/general', 'easy', 'I will take care of the booking today.', 'take care about'],
    ['stick to', '坚持/遵守', 'daily life/planning', 'medium', 'I am trying to stick to my meal plan.', 'stick with to'],
    ['go with', '选择/采用', 'daily life/choices', 'easy', 'I think I will go with the smaller size.', 'go to the option'],
    ['not feel like', '不想做某事', 'daily life/feelings', 'easy', 'I do not feel like cooking tonight.', 'not feel to do'],
    ['get something done', '把某事完成', 'work/productivity', 'medium', 'I want to get this report done before lunch.', 'get done something'],
    ['be worth it', '值得', 'daily life/choices', 'easy', 'The extra wait was worth it.', 'worth to do'],
    ['in case', '以防万一', 'daily life/planning', 'easy', 'Take an umbrella in case it rains.', 'in the case it rains'],
    ['on the way', '在路上/顺路', 'daily life/travel', 'easy', 'I can pick up some milk on the way home.', 'in the way home'],
    ['by the time', '到……的时候', 'daily life/time', 'medium', 'By the time I arrived, the store had closed.', 'until the time'],
    ['at the last minute', '在最后一刻', 'daily life/scheduling', 'medium', 'The meeting was cancelled at the last minute.', 'in the last minute'],
    ['give someone a heads-up', '提前提醒某人', 'work/communication', 'medium', 'Please give me a heads-up if the time changes.', 'give a head up'],
    ['work something out', '协商好/解决某事', 'work/problem solving', 'medium', 'I am sure we can work something out.', 'work out about something'],
    ['take a closer look', '仔细查看', 'work/analysis', 'easy', 'Let us take a closer look at the latest results.', 'look more closely on'],
    ['keep an eye on', '留意/关注', 'daily life/monitoring', 'medium', 'Please keep an eye on the delivery status.', 'keep eyes on'],
    ['have trouble doing', '做某事有困难', 'daily life/problem solving', 'medium', 'I had trouble finding the correct setting.', 'have trouble to do'],
    ['end up doing', '最后结果做了某事', 'daily life/outcomes', 'medium', 'We ended up ordering food instead.', 'end up to do'],
    ['be supposed to', '应该/按理应当', 'daily life/expectations', 'medium', 'The task is supposed to run every morning.', 'suppose to'],
    ['get used to', '逐渐习惯', 'daily life/adaptation', 'medium', 'It took me a week to get used to the new schedule.', 'be used to do'],
    ['take turns', '轮流', 'daily life/social', 'easy', 'We took turns choosing the restaurant.', 'take a turn each'],
    ['make the most of', '充分利用', 'daily life/planning', 'medium', 'Let us make the most of the time we have.', 'make most of'],
    ['come across', '偶然遇到/看到', 'daily life/discovery', 'medium', 'I came across an interesting article yesterday.', 'come across with'],
    ['go over', '检查/复习', 'work/review', 'easy', 'Can we go over the main points once more?', 'go over about'],
    ['hold on a second', '稍等一下', 'daily life/communication', 'easy', 'Hold on a second while I check the address.', 'hold a second on'],
    ['let someone know', '告知某人', 'daily life/communication', 'easy', 'Let me know when you are ready.', 'let know someone'],
    ['take your time', '慢慢来/不用着急', 'daily life/social', 'easy', 'Take your time; there is no rush.', 'use your time'],
    ['be good to go', '准备就绪/可以开始', 'work/readiness', 'medium', 'Once the file is uploaded, we should be good to go.', 'be good for going'],
    ['make room for', '为……腾出空间', 'daily life/organization', 'medium', 'I need to make room for a small desk.', 'make a room for'],
    ['keep in mind', '记住/考虑到', 'work/planning', 'medium', 'Keep in mind that the trigger time is approximate.', 'keep on mind']
  ];
}

function installDailyQueueTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DQ3.triggerHandler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger(DQ3.triggerHandler)
    .timeBased()
    .atHour(8)
    .nearMinute(30)
    .everyDays(1)
    .inTimezone(DQ3.timezone)
    .create();
}

function countReadyCandidates_(ss) {
  var sheet = requireSheet_(ss, DQ3.candidateSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var count = 0;
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers.Status]).toLowerCase() === 'ready' &&
      stringValue_(values[i][headers['Candidate Type']]).toLowerCase() === 'chunk'
    ) count++;
  }
  return count;
}

function assertContractV3_(ss) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][0]) === 'contract_version') {
      var version = stringValue_(values[i][1]);
      if (!isContractVersion_(version)) {
        throw new Error('Contract mismatch: expected 3.0, found ' + version + '.');
      }
      return;
    }
  }
  throw new Error('Config contract_version is missing.');
}

function requireSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Required sheet is missing: ' + name);
  return sheet;
}

function headerMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    var key = stringValue_(header);
    if (key) map[key] = index;
  });
  return map;
}

function requireHeaders_(map, headers, sheetName) {
  headers.forEach(function(header) {
    if (map[header] === undefined) {
      throw new Error(sheetName + ' is missing required header: ' + header);
    }
  });
}

function formatDateKey_(value) {
  return Utilities.formatDate(new Date(value), DQ3.timezone, 'yyyy-MM-dd');
}

function parseDateKey_(dateKey) {
  return new Date(dateKey + 'T12:00:00+08:00');
}

function tomorrowDate_() {
  var todayAtNoon = parseDateKey_(formatDateKey_(new Date()));
  return new Date(todayAtNoon.getTime() + 24 * 60 * 60 * 1000);
}

function isDateValue_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
}

function stringValue_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isContractVersion_(value) {
  var text = stringValue_(value);
  return text === DQ3.contractVersion || text === '3';
}

function numberValue_(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function normalizeQuestionCount_(value, fallback) {
  var fallbackCount = Number(fallback);
  if (!isFinite(fallbackCount)) fallbackCount = DQ3.legacyQuestionCount;
  var count = Number(value);
  if (!isFinite(count) || Math.floor(count) !== count) count = fallbackCount;
  if (count < DQ3.minQuestionCount || count > DQ3.maxBatchQuestionCount) {
    throw new Error(
      'Question count must be an integer between ' + DQ3.minQuestionCount +
      ' and ' + DQ3.maxBatchQuestionCount + ' for one Daily Queue.'
    );
  }
  return count;
}

function queuePlannedCountFromRows_(rows) {
  if (!Array.isArray(rows) || !rows.length) return DQ3.legacyQuestionCount;
  var column = DQ3_QUEUE_HEADERS.indexOf('Planned Count');
  var values = {};
  rows.forEach(function(row) {
    var raw = column >= 0 ? Number(row[column]) : 0;
    if (isFinite(raw) && raw > 0) values[raw] = true;
  });
  var counts = Object.keys(values).map(Number);
  if (counts.length > 1) throw new Error('Queue rows do not share one Planned Count.');
  return normalizeQuestionCount_(counts.length ? counts[0] : DQ3.legacyQuestionCount, DQ3.legacyQuestionCount);
}

function normalizeChunk_(value) {
  return stringValue_(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedCandidateOriginType_(value) {
  var origin = stringValue_(value).toLowerCase();
  if (origin === 'auto_replenishment') return 'ai_fallback';
  if (
    ['user_context', 'learning_evidence', 'conversation_derived', 'legacy', 'ai_fallback']
      .indexOf(origin) !== -1
  ) return origin;
  return 'legacy';
}

function candidateOriginRank_(value) {
  var ranks = {
    user_context: 0,
    learning_evidence: 1,
    conversation_derived: 2,
    legacy: 3,
    ai_fallback: 4
  };
  return ranks[normalizedCandidateOriginType_(value)];
}

function candidateIntakePriorityRank_(value) {
  var ranks = { high: 0, normal: 1, fallback: 2 };
  var key = stringValue_(value).toLowerCase();
  return ranks[key] === undefined ? 1 : ranks[key];
}

function candidateOriginLabel_(value) {
  return 'origin=' + normalizedCandidateOriginType_(value);
}

function isPersonalCandidateOrigin_(value) {
  return normalizedCandidateOriginType_(value) !== 'ai_fallback';
}

function resultRank_(result) {
  var ranks = { forgotten: 0, difficult: 1, normal: 2, mastered: 3 };
  return ranks[result] === undefined ? 4 : ranks[result];
}

function isReviewEligibleStatus_(status) {
  return DQ3.reviewEligibleStatuses.indexOf(stringValue_(status).toLowerCase()) !== -1;
}

function compareValues_(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
