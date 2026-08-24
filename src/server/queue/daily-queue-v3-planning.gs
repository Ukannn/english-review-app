
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
