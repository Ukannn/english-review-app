
function readDraftsForSessionV4_(ss, sessionId) {
  var sheet = requireSheet_(ss, ER4.draftSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][headers['Session ID']]) === sessionId) {
      rows.push({
        rowNumber: i + 1,
        position: Number(values[i][headers.Position]),
        answer: stringValue_(values[i][headers.Answer]),
        revision: Number(values[i][headers.Revision]) || 0,
        updatedAt: formatDateTimeV4_(values[i][headers['Updated At']]),
        submitStatus: stringValue_(values[i][headers['Submit Status']]),
        submissionId: stringValue_(values[i][headers['Submission ID']]),
        answerHash: stringValue_(values[i][headers['Answer Hash']])
      });
    }
  }
  return rows;
}

function normalizeDraftClientInfoV4_(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    clientInstanceId: stringValue_(value.clientInstanceId).slice(0, 120),
    pageStartedAt: stringValue_(value.pageStartedAt).slice(0, 80)
  };
}

function ensureDraftHistorySheetV4_(ss) {
  var sheet = ensureV4Sheet_(
    ss,
    ER4.draftHistorySheet,
    ER4_DRAFT_HISTORY_HEADERS,
    [210, 150, 150, 70, 95, 105, 420, 90, 420, 90, 145, 180, 170, 155, 240, 105]
  );
  applyListValidationV4_(sheet, 11, [
    'autosave', 'reveal_lock', 'replace_locked', 'submission_freeze'
  ]);
  return sheet;
}

function draftHistoryIdV4_(entry) {
  return 'DHI-' + hashV4_([[
    stringValue_(entry.sessionId),
    Number(entry.position),
    Number(entry.nextRevision),
    stringValue_(entry.eventType),
    stringValue_(entry.nextAnswer),
    stringValue_(entry.answerHash)
  ]]).slice(0, 32);
}

function stageDraftHistoriesV4_(ss, entries) {
  var sheet = requireSheet_(ss, ER4.draftHistorySheet);
  var headers = headerMap_(
    sheet.getRange(1, 1, 1, ER4_DRAFT_HISTORY_HEADERS.length).getValues()[0]
  );
  requireHeaders_(headers, ER4_DRAFT_HISTORY_HEADERS, ER4.draftHistorySheet);
  var newRows = [];
  var results = [];
  entries.forEach(function(entry) {
    var historyId = draftHistoryIdV4_(entry);
    var existingRow = 0;
    if (sheet.getLastRow() > 1) {
      var found = sheet
        .getRange(2, headers['History ID'] + 1, sheet.getLastRow() - 1, 1)
        .createTextFinder(historyId)
        .matchEntireCell(true)
        .findNext();
      existingRow = found ? found.getRow() : 0;
    }
    if (existingRow) {
      results.push({ historyId: historyId, rowNumber: existingRow, duplicate: true });
      return;
    }
    var client = normalizeDraftClientInfoV4_(entry.clientInfo);
    newRows.push({
      historyId: historyId,
      entry: entry,
      values: [
        historyId,
        stringValue_(entry.sessionId),
        stringValue_(entry.queueId),
        Number(entry.position),
        stringValue_(entry.phraseId),
        stringValue_(entry.candidateId),
        stringValue_(entry.previousAnswer),
        Number(entry.previousRevision) || 0,
        stringValue_(entry.nextAnswer),
        Number(entry.nextRevision) || 0,
        stringValue_(entry.eventType),
        client.clientInstanceId,
        client.pageStartedAt,
        new Date(),
        stringValue_(entry.answerHash),
        ER4.contractVersion
      ]
    });
  });
  if (!newRows.length) {
    return {
      sheet: sheet,
      headers: headers,
      newRows: [],
      firstRow: 0,
      results: results
    };
  }
  var firstRow = sheet.getLastRow() + 1;
  sheet.getRange(firstRow, 1, newRows.length, ER4_DRAFT_HISTORY_HEADERS.length)
    .setValues(newRows.map(function(item) { return item.values; }));
  sheet.getRange(firstRow, headers['Recorded At'] + 1, newRows.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(firstRow, headers['Contract Version'] + 1, newRows.length, 1)
    .setNumberFormat('@');
  return {
    sheet: sheet,
    headers: headers,
    newRows: newRows,
    firstRow: firstRow,
    results: results
  };
}

function verifyStagedDraftHistoriesV4_(staged) {
  if (!staged.newRows.length) return staged.results;
  var verifiedRows = staged.sheet.getRange(
    staged.firstRow,
    1,
    staged.newRows.length,
    ER4_DRAFT_HISTORY_HEADERS.length
  ).getValues();
  staged.newRows.forEach(function(item, index) {
    var verified = verifiedRows[index];
    if (
      stringValue_(verified[staged.headers['History ID']]) !== item.historyId ||
      stringValue_(verified[staged.headers['Session ID']]) !== stringValue_(item.entry.sessionId) ||
      Number(verified[staged.headers.Position]) !== Number(item.entry.position) ||
      Number(verified[staged.headers['Next Revision']]) !== Number(item.entry.nextRevision) ||
      stringValue_(verified[staged.headers['Next Answer']]) !== stringValue_(item.entry.nextAnswer)
    ) {
      throw new Error('Answer Draft History readback failed.');
    }
    staged.results.push({
      historyId: item.historyId,
      rowNumber: staged.firstRow + index,
      duplicate: false
    });
  });
  return staged.results;
}

function appendDraftHistoriesV4_(ss, entries) {
  var staged = stageDraftHistoriesV4_(ss, entries);
  if (staged.newRows.length) SpreadsheetApp.flush();
  return verifyStagedDraftHistoriesV4_(staged);
}

function appendDraftHistoryV4_(ss, entry) {
  return appendDraftHistoriesV4_(ss, [entry])[0];
}

function draftBusyResponseV4_() {
  return {
    ok: false,
    busy: true,
    code: 'BUSY_RETRY',
    retryAfterMs: 650,
    message: 'Another answer save is finishing. Please retry shortly.'
  };
}

function latestDraftWriterV4_(ss, sessionId, position, revision) {
  var sheet = ss.getSheetByName(ER4.draftHistorySheet);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_DRAFT_HISTORY_HEADERS, ER4.draftHistorySheet);
  for (var i = values.length - 1; i >= 1; i--) {
    if (
      stringValue_(values[i][headers['Session ID']]) === stringValue_(sessionId) &&
      Number(values[i][headers.Position]) === Number(position) &&
      Number(values[i][headers['Next Revision']]) === Number(revision)
    ) {
      return {
        clientInstanceId: stringValue_(values[i][headers['Client Instance ID']]),
        pageStartedAt: stringValue_(values[i][headers['Page Started At']]),
        recordedAt: formatDateTimeV4_(values[i][headers['Recorded At']]),
        eventType: stringValue_(values[i][headers['Event Type']])
      };
    }
  }
  return null;
}

function draftConflictResponseV4_(ss, sessionId, position, revision, answer, updatedAt) {
  return {
    ok: false,
    conflict: true,
    position: Number(position),
    revision: Number(revision) || 0,
    answer: stringValue_(answer),
    updatedAt: formatDateTimeV4_(updatedAt),
    writer: latestDraftWriterV4_(ss, sessionId, position, revision)
  };
}

function revealedDraftHashV4_(sessionId, position, answer) {
  return hashV4_([[stringValue_(sessionId), Number(position), stringValue_(answer)]]);
}

function isDraftRevealedV4_(draft, sessionId) {
  if (!draft) return false;
  return (
    stringValue_(draft.submitStatus).toLowerCase() === 'draft' &&
    !stringValue_(draft.submissionId) &&
    Boolean(stringValue_(draft.answer)) &&
    stringValue_(draft.answerHash) ===
      revealedDraftHashV4_(sessionId, draft.position, draft.answer)
  );
}

function saveDraftBatchV4(sessionId, drafts, clientInfo) {
  drafts = Array.isArray(drafts) ? drafts : [];
  if (!drafts.length || drafts.length > 20) {
    throw new Error('Draft batch must contain 1–20 items.');
  }
  var seen = {};
  drafts.forEach(function(item) {
    var position = Number(item && item.position);
    if (!Number.isInteger(position) || seen[position]) {
      throw new Error('Draft batch positions must be unique valid integers.');
    }
    seen[position] = true;
  });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return draftBusyResponseV4_();
  try {
    var items = [];
    for (var i = 0; i < drafts.length; i++) {
      var draft = drafts[i] || {};
      var result = saveDraftV4(
        sessionId,
        Number(draft.position),
        draft.answer,
        Number(draft.expectedRevision) || 0,
        clientInfo,
        true
      );
      result.clientVersion = Number(draft.clientVersion) || 0;
      items.push(result);
    }
    return { ok: true, items: items };
  } finally {
    lock.releaseLock();
  }
}

function expectedAnswerForQuestionRowV4_(row, headers, position) {
  return parseJsonArrayV4_(
    row[headers['Expected Answers JSON']],
    'Expected Answers JSON',
    position
  )[0];
}

function saveDraftV4(sessionId, position, answer, expectedRevision, clientInfo, lockHeld) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = null;
  if (!lockHeld) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return draftBusyResponseV4_();
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    position = Number(position);
    answer = stringValue_(answer);
    expectedRevision = Number(expectedRevision) || 0;
    clientInfo = normalizeDraftClientInfoV4_(clientInfo);
    if (position < 1 || position > ER4.maxBatchQuestionCount) {
      throw new Error('Invalid question position.');
    }
    if (answer.length > 2000) throw new Error('Answer is too long.');
    var journal = findJournalBySessionV4_(ss, sessionId);
    if (journal) throw new Error('This answer batch is already frozen.');
    var queue = findQueueBySessionV4_(ss, sessionId);
    if (!queue || queue.status !== 'presented') throw new Error('Session is not open for drafting.');

    var draftSheet = requireSheet_(ss, ER4.draftSheet);
    var values = draftSheet.getDataRange().getValues();
    var headers = headerMap_(values[0]);
    var existingRow = 0;
    var currentRevision = 0;
    var currentAnswer = '';
    var currentSubmitStatus = '';
    var currentSubmissionId = '';
    var currentAnswerHash = '';
    var currentUpdatedAt = '';
    for (var i = 1; i < values.length; i++) {
      if (
        stringValue_(values[i][headers['Session ID']]) === sessionId &&
        Number(values[i][headers.Position]) === position
      ) {
        existingRow = i + 1;
        currentRevision = Number(values[i][headers.Revision]) || 0;
        currentAnswer = stringValue_(values[i][headers.Answer]);
        currentSubmitStatus = stringValue_(values[i][headers['Submit Status']]);
        currentSubmissionId = stringValue_(values[i][headers['Submission ID']]);
        currentAnswerHash = stringValue_(values[i][headers['Answer Hash']]);
        currentUpdatedAt = values[i][headers['Updated At']];
        break;
      }
    }
    if (existingRow && currentAnswerHash) {
      var currentDraft = {
        position: position,
        answer: currentAnswer,
        submitStatus: currentSubmitStatus,
        submissionId: currentSubmissionId,
        answerHash: currentAnswerHash
      };
      if (!isDraftRevealedV4_(currentDraft, sessionId)) {
        throw new Error('The existing draft lock failed integrity validation.');
      }
      return {
        ok: false,
        locked: true,
        revealed: true,
        position: position,
        revision: currentRevision,
        answer: currentAnswer,
        updatedAt: formatDateTimeV4_(currentUpdatedAt),
        writer: latestDraftWriterV4_(ss, sessionId, position, currentRevision)
      };
    }
    if (currentRevision !== expectedRevision) {
      if (
        existingRow &&
        currentAnswer === answer &&
        stringValue_(currentSubmitStatus).toLowerCase() === 'draft' &&
        !currentSubmissionId &&
        !currentAnswerHash
      ) {
        return {
          ok: true,
          synchronized: true,
          position: position,
          revision: currentRevision,
          answer: currentAnswer
        };
      }
      return draftConflictResponseV4_(
        ss,
        sessionId,
        position,
        currentRevision,
        currentAnswer,
        currentUpdatedAt
      );
    }
    var identity = identityForQueuePositionV4_(queue, position);
    var revision = currentRevision + 1;
    var row = [
      sessionId,
      queue.queueId,
      position,
      identity.phraseId,
      identity.candidateId,
      answer,
      revision,
      new Date(),
      'draft',
      '',
      '',
      ER4.contractVersion
    ];
    if (existingRow) {
      draftSheet.getRange(existingRow, 1, 1, ER4_DRAFT_HEADERS.length).setValues([row]);
    } else {
      draftSheet.appendRow(row);
      existingRow = draftSheet.getLastRow();
    }
    draftSheet.getRange(existingRow, 8).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    draftSheet.getRange(existingRow, headers['Contract Version'] + 1)
      .setNumberFormat('@')
      .setValue(ER4.contractVersion);
    var stagedHistory = stageDraftHistoriesV4_(ss, [{
      sessionId: sessionId,
      queueId: queue.queueId,
      position: position,
      phraseId: identity.phraseId,
      candidateId: identity.candidateId,
      previousAnswer: currentAnswer,
      previousRevision: currentRevision,
      nextAnswer: answer,
      nextRevision: revision,
      eventType: 'autosave',
      clientInfo: clientInfo,
      answerHash: ''
    }]);
    SpreadsheetApp.flush();
    var verified = draftSheet.getRange(existingRow, 1, 1, ER4_DRAFT_HEADERS.length).getValues()[0];
    if (
      stringValue_(verified[headers['Session ID']]) !== sessionId ||
      Number(verified[headers.Position]) !== position ||
      Number(verified[headers.Revision]) !== revision ||
      stringValue_(verified[headers.Answer]) !== answer
    ) {
      throw new Error('Draft readback failed.');
    }
    var history = verifyStagedDraftHistoriesV4_(stagedHistory)[0];
    return {
      ok: true,
      position: position,
      revision: revision,
      answer: answer,
      historyId: history.historyId
    };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function revealAnswerV4(sessionId, position, answer, expectedRevision, clientInfo) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return draftBusyResponseV4_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    sessionId = stringValue_(sessionId);
    position = Number(position);
    answer = stringValue_(answer);
    expectedRevision = Number(expectedRevision) || 0;
    clientInfo = normalizeDraftClientInfoV4_(clientInfo);
    if (position < 1 || position > ER4.maxBatchQuestionCount) {
      throw new Error('Invalid question position.');
    }
    if (!answer) throw new Error('Answer ' + position + ' is blank.');
    if (answer.length > 2000) throw new Error('Answer ' + position + ' is too long.');
    if (findJournalBySessionV4_(ss, sessionId)) {
      throw new Error('This answer batch is already frozen.');
    }
    var queue = findQueueBySessionV4_(ss, sessionId);
    if (!queue || queue.status !== 'presented') {
      throw new Error('Session is not open for answer reveal.');
    }
    var batch = validatePreparedQuestionBatchV4_(ss, queue);
    if (!batch) throw new Error('The prepared question batch is unavailable.');

    var draftSheet = requireSheet_(ss, ER4.draftSheet);
    var values = draftSheet.getDataRange().getValues();
    var headers = headerMap_(values[0]);
    var matches = [];
    for (var i = 1; i < values.length; i++) {
      if (
        stringValue_(values[i][headers['Session ID']]) === sessionId &&
        Number(values[i][headers.Position]) === position
      ) {
        matches.push({ rowNumber: i + 1, values: values[i] });
      }
    }
    if (matches.length > 1) {
      throw new Error('Reveal requires exactly one draft at position ' + position + '.');
    }
    var item = matches[0] || null;
    var current = item ? {
      position: position,
      answer: stringValue_(item.values[headers.Answer]),
      revision: Number(item.values[headers.Revision]) || 0,
      submitStatus: stringValue_(item.values[headers['Submit Status']]),
      submissionId: stringValue_(item.values[headers['Submission ID']]),
      answerHash: stringValue_(item.values[headers['Answer Hash']]),
      updatedAt: item.values[headers['Updated At']]
    } : {
      position: position,
      answer: '',
      revision: 0,
      submitStatus: '',
      submissionId: '',
      answerHash: '',
      updatedAt: ''
    };
    var questionRow = batch.rows.filter(function(questionItem) {
      return Number(questionItem.values[batch.headers.Position]) === position;
    })[0];
    if (!questionRow) throw new Error('Prepared question is missing at position ' + position + '.');
    var expectedAnswer = expectedAnswerForQuestionRowV4_(
      questionRow.values,
      batch.headers,
      position
    );

    if (item && isDraftRevealedV4_(current, sessionId)) {
      if (current.answer !== answer) {
        return draftConflictResponseV4_(
          ss,
          sessionId,
          position,
          current.revision,
          current.answer,
          current.updatedAt
        );
      }
      return {
        ok: true,
        position: position,
        revision: current.revision,
        answer: current.answer,
        revealed: true,
        locked: true,
        expectedAnswer: expectedAnswer,
        updatedAt: formatDateTimeV4_(current.updatedAt),
        writer: latestDraftWriterV4_(ss, sessionId, position, current.revision)
      };
    }
    if (item && (
      current.answerHash ||
      stringValue_(current.submitStatus).toLowerCase() !== 'draft' ||
      current.submissionId
    )) {
      throw new Error('The draft cannot be revealed from its current state.');
    }
    // The reveal call is also the final background save. It may replace the
    // answer at the exact revision the page last read, which lets a completed
    // answer atomically replace an earlier partial autosave. If another page
    // advanced the revision, only an identical answer remains safe to accept.
    if (
      (!item && expectedRevision !== 0) ||
      (item && current.revision < expectedRevision) ||
      (item && current.revision > expectedRevision && current.answer !== answer)
    ) {
      return draftConflictResponseV4_(
        ss,
        sessionId,
        position,
        current.revision,
        current.answer,
        current.updatedAt
      );
    }

    var revealHash = revealedDraftHashV4_(sessionId, position, answer);
    var nextRevision = current.revision + 1;
    var identity = identityForQueuePositionV4_(queue, position);
    var row = [
      sessionId,
      queue.queueId,
      position,
      identity.phraseId,
      identity.candidateId,
      answer,
      nextRevision,
      new Date(),
      'draft',
      '',
      revealHash,
      ER4.contractVersion
    ];
    var rowNumber;
    if (item) {
      rowNumber = item.rowNumber;
      draftSheet.getRange(rowNumber, 1, 1, ER4_DRAFT_HEADERS.length).setValues([row]);
    } else {
      draftSheet.appendRow(row);
      rowNumber = draftSheet.getLastRow();
    }
    draftSheet.getRange(rowNumber, 8).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    draftSheet.getRange(rowNumber, headers['Contract Version'] + 1)
      .setNumberFormat('@')
      .setValue(ER4.contractVersion);
    var stagedHistory = stageDraftHistoriesV4_(ss, [{
      sessionId: sessionId,
      queueId: queue.queueId,
      position: position,
      phraseId: identity.phraseId,
      candidateId: identity.candidateId,
      previousAnswer: current.answer,
      previousRevision: current.revision,
      nextAnswer: answer,
      nextRevision: nextRevision,
      eventType: 'reveal_lock',
      clientInfo: clientInfo,
      answerHash: revealHash
    }]);
    SpreadsheetApp.flush();

    var verified = draftSheet.getRange(
      rowNumber,
      1,
      1,
      ER4_DRAFT_HEADERS.length
    ).getValues()[0];
    if (
      Number(verified[headers.Revision]) !== nextRevision ||
      stringValue_(verified[headers.Answer]) !== answer ||
      stringValue_(verified[headers['Submit Status']]).toLowerCase() !== 'draft' ||
      stringValue_(verified[headers['Submission ID']]) ||
      stringValue_(verified[headers['Answer Hash']]) !== revealHash
    ) {
      throw new Error('Per-question answer lock readback failed.');
    }
    var history = verifyStagedDraftHistoriesV4_(stagedHistory)[0];
    return {
      ok: true,
      position: position,
      revision: nextRevision,
      answer: answer,
      revealed: true,
      locked: true,
      expectedAnswer: expectedAnswer,
      historyId: history.historyId
    };
  } finally {
    lock.releaseLock();
  }
}

function replaceLockedDraftV4(sessionId, position, answer, expectedRevision, clientInfo) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return draftBusyResponseV4_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    sessionId = stringValue_(sessionId);
    position = Number(position);
    answer = stringValue_(answer).trim();
    expectedRevision = Number(expectedRevision) || 0;
    clientInfo = normalizeDraftClientInfoV4_(clientInfo);
    if (position < 1 || position > ER4.maxBatchQuestionCount) {
      throw new Error('Invalid question position.');
    }
    if (!answer) throw new Error('The replacement answer is blank.');
    if (answer.length > 2000) throw new Error('The replacement answer is too long.');
    if (findJournalBySessionV4_(ss, sessionId)) {
      throw new Error('Submitted answers cannot be replaced.');
    }
    var queue = findQueueBySessionV4_(ss, sessionId);
    if (!queue || queue.status !== 'presented') {
      throw new Error('Session is not open for locked-answer correction.');
    }
    var batch = validatePreparedQuestionBatchV4_(ss, queue);
    if (!batch) throw new Error('The prepared question batch is unavailable.');
    var questionRow = batch.rows.filter(function(item) {
      return Number(item.values[batch.headers.Position]) === position;
    })[0];
    if (!questionRow) throw new Error('Prepared question is missing at position ' + position + '.');
    var expectedAnswer = expectedAnswerForQuestionRowV4_(
      questionRow.values,
      batch.headers,
      position
    );

    var draftSheet = requireSheet_(ss, ER4.draftSheet);
    var values = draftSheet.getDataRange().getValues();
    var headers = headerMap_(values[0]);
    var matches = [];
    for (var i = 1; i < values.length; i++) {
      if (
        stringValue_(values[i][headers['Session ID']]) === sessionId &&
        Number(values[i][headers.Position]) === position
      ) {
        matches.push({ rowNumber: i + 1, values: values[i] });
      }
    }
    if (matches.length !== 1) {
      throw new Error('Locked-answer correction requires exactly one draft row.');
    }
    var item = matches[0];
    var current = {
      position: position,
      answer: stringValue_(item.values[headers.Answer]),
      revision: Number(item.values[headers.Revision]) || 0,
      submitStatus: stringValue_(item.values[headers['Submit Status']]),
      submissionId: stringValue_(item.values[headers['Submission ID']]),
      answerHash: stringValue_(item.values[headers['Answer Hash']]),
      updatedAt: item.values[headers['Updated At']]
    };
    if (!isDraftRevealedV4_(current, sessionId)) {
      throw new Error('Only a valid pre-submission locked draft can be corrected.');
    }
    if (current.revision !== expectedRevision) {
      return draftConflictResponseV4_(
        ss,
        sessionId,
        position,
        current.revision,
        current.answer,
        current.updatedAt
      );
    }
    if (current.answer === answer) {
      return {
        ok: true,
        unchanged: true,
        position: position,
        revision: current.revision,
        answer: current.answer,
        revealed: true,
        locked: true,
        expectedAnswer: expectedAnswer
      };
    }

    var identity = identityForQueuePositionV4_(queue, position);
    var nextRevision = current.revision + 1;
    var nextHash = revealedDraftHashV4_(sessionId, position, answer);
    var row = [
      sessionId,
      queue.queueId,
      position,
      identity.phraseId,
      identity.candidateId,
      answer,
      nextRevision,
      new Date(),
      'draft',
      '',
      nextHash,
      ER4.contractVersion
    ];
    draftSheet.getRange(item.rowNumber, 1, 1, ER4_DRAFT_HEADERS.length).setValues([row]);
    draftSheet.getRange(item.rowNumber, 8).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    draftSheet.getRange(item.rowNumber, headers['Contract Version'] + 1)
      .setNumberFormat('@')
      .setValue(ER4.contractVersion);
    var stagedHistory = stageDraftHistoriesV4_(ss, [{
      sessionId: sessionId,
      queueId: queue.queueId,
      position: position,
      phraseId: identity.phraseId,
      candidateId: identity.candidateId,
      previousAnswer: current.answer,
      previousRevision: current.revision,
      nextAnswer: answer,
      nextRevision: nextRevision,
      eventType: 'replace_locked',
      clientInfo: clientInfo,
      answerHash: nextHash
    }]);
    SpreadsheetApp.flush();
    var verified = draftSheet.getRange(
      item.rowNumber,
      1,
      1,
      ER4_DRAFT_HEADERS.length
    ).getValues()[0];
    if (
      Number(verified[headers.Revision]) !== nextRevision ||
      stringValue_(verified[headers.Answer]) !== answer ||
      stringValue_(verified[headers['Answer Hash']]) !== nextHash ||
      stringValue_(verified[headers['Submit Status']]).toLowerCase() !== 'draft' ||
      stringValue_(verified[headers['Submission ID']])
    ) {
      throw new Error('Locked-answer correction readback failed.');
    }
    var history = verifyStagedDraftHistoriesV4_(stagedHistory)[0];
    return {
      ok: true,
      position: position,
      revision: nextRevision,
      answer: answer,
      revealed: true,
      locked: true,
      expectedAnswer: expectedAnswer,
      historyId: history.historyId
    };
  } finally {
    lock.releaseLock();
  }
}

function submitSessionV4(sessionId, answers, clientInfo) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    clientInfo = normalizeDraftClientInfoV4_(clientInfo);
    var queue = findQueueBySessionV4_(ss, sessionId);
    if (!queue || queue.status !== 'presented') {
      throw new Error('Session is not open for submission.');
    }
    var normalized = normalizeAnswerBatchV4_(answers, queue.plannedCount);
    if (normalized.length < queue.adjustedTarget) {
      throw new Error(
        'This session currently requires at least ' + queue.adjustedTarget +
        ' locked answers; found ' + normalized.length + '.'
      );
    }
    var answerHash = hashV4_(normalized.map(function(item) {
      return [item.position, item.answer];
    }));
    var existingJournal = findJournalBySessionV4_(ss, sessionId);
    if (existingJournal) {
      if (existingJournal.answerHash !== answerHash) {
        throw new Error('A different answer snapshot is already frozen for this Session.');
      }
      return responseForJournalV4_(existingJournal);
    }

    var draftSheet = requireSheet_(ss, ER4.draftSheet);
    var draftValues = draftSheet.getDataRange().getValues();
    var draftHeaders = headerMap_(draftValues[0]);
    var rowByPosition = {};
    var draftByPosition = {};
    for (var i = 1; i < draftValues.length; i++) {
      if (stringValue_(draftValues[i][draftHeaders['Session ID']]) === sessionId) {
        var draftPosition = Number(draftValues[i][draftHeaders.Position]);
        if (rowByPosition[draftPosition]) {
          throw new Error('Answer Drafts contains a duplicate position for this Session.');
        }
        rowByPosition[draftPosition] = i + 1;
        draftByPosition[draftPosition] = draftValues[i];
      }
    }
    normalized.forEach(function(item) {
      var stored = draftByPosition[item.position];
      if (
        !stored ||
        stringValue_(stored[draftHeaders.Answer]) !== item.answer ||
        stringValue_(stored[draftHeaders['Submit Status']]).toLowerCase() !== 'draft' ||
        stringValue_(stored[draftHeaders['Submission ID']]) ||
        stringValue_(stored[draftHeaders['Answer Hash']]) !==
          revealedDraftHashV4_(sessionId, item.position, item.answer)
      ) {
        throw new Error(
          'Answer ' + item.position + ' must match its server-locked reveal snapshot.'
        );
      }
    });
    var submissionId = 'SUB-' + sessionId + '-' + Utilities.getUuid().slice(0, 8);
    normalized.forEach(function(item) {
      var identity = identityForQueuePositionV4_(queue, item.position);
      var rowNumber = rowByPosition[item.position];
      var currentRevision = rowNumber
        ? Number(draftSheet.getRange(rowNumber, draftHeaders.Revision + 1).getValue()) || 0
        : 0;
      var row = [
        sessionId,
        queue.queueId,
        item.position,
        identity.phraseId,
        identity.candidateId,
        item.answer,
        currentRevision + 1,
        new Date(),
        'submitted',
        submissionId,
        answerHash,
        ER4.contractVersion
      ];
      if (rowNumber) {
        draftSheet.getRange(rowNumber, 1, 1, ER4_DRAFT_HEADERS.length).setValues([row]);
      } else {
        draftSheet.appendRow(row);
        rowByPosition[item.position] = draftSheet.getLastRow();
      }
      draftSheet.getRange(rowByPosition[item.position], 8).setNumberFormat('yyyy-mm-dd hh:mm:ss');
      draftSheet.getRange(rowByPosition[item.position], draftHeaders['Contract Version'] + 1)
        .setNumberFormat('@')
        .setValue(ER4.contractVersion);
    });
    appendDraftHistoriesV4_(ss, normalized.map(function(item) {
      var identity = identityForQueuePositionV4_(queue, item.position);
      var previous = draftByPosition[item.position];
      var previousRevision = Number(previous[draftHeaders.Revision]) || 0;
      return {
        sessionId: sessionId,
        queueId: queue.queueId,
        position: item.position,
        phraseId: identity.phraseId,
        candidateId: identity.candidateId,
        previousAnswer: stringValue_(previous[draftHeaders.Answer]),
        previousRevision: previousRevision,
        nextAnswer: item.answer,
        nextRevision: previousRevision + 1,
        eventType: 'submission_freeze',
        clientInfo: clientInfo,
        answerHash: answerHash
      };
    }));
    var journalSheet = requireSheet_(ss, ER4.journalSheet);
    journalSheet.appendRow([
      submissionId,
      sessionId,
      queue.queueId,
      answerHash,
      'awaiting_chatgpt',
      'answers_frozen',
      new Date(),
      new Date(),
      '',
      '',
      '',
      '',
      '',
      '',
      ER4.contractVersion
    ]);
    var journalRow = journalSheet.getLastRow();
    journalSheet.getRange(journalRow, 7, 1, 3).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    journalSheet.getRange(journalRow, ER4_JOURNAL_HEADERS.indexOf('Contract Version') + 1)
      .setNumberFormat('@')
      .setValue(ER4.contractVersion);
    SpreadsheetApp.flush();

    var drafts = readDraftsForSessionV4_(ss, sessionId).filter(function(item) {
      return item.submitStatus === 'submitted';
    });
    if (
      drafts.length !== normalized.length ||
      drafts.some(function(item) { return item.answerHash !== answerHash; })
    ) {
      throw new Error('Frozen answer readback failed.');
    }
    var journal = findJournalBySessionV4_(ss, sessionId);
    if (!journal || journal.answerHash !== answerHash || journal.status !== 'awaiting_chatgpt') {
      throw new Error('Commit Journal registration readback failed.');
    }
    return responseForJournalV4_(journal);
  } finally {
    lock.releaseLock();
  }
}

function normalizeAnswerBatchV4_(answers, plannedCount) {
  if (!Array.isArray(answers)) throw new Error('Answer batch is missing.');
  plannedCount = normalizeQuestionCount_(plannedCount, ER4.legacyQuestionCount);
  if (!answers.length) throw new Error('At least one locked answer is required.');
  var byPosition = {};
  answers.forEach(function(item) {
    var position = Number(item && item.position);
    var answer = stringValue_(item && item.answer);
    if (position < 1 || position > plannedCount || byPosition[position] !== undefined) {
      throw new Error('Answer batch has an invalid or duplicate position.');
    }
    if (!answer) throw new Error('Answer ' + position + ' is blank.');
    if (answer.length > 2000) throw new Error('Answer ' + position + ' is too long.');
    byPosition[position] = answer;
  });
  return Object.keys(byPosition).map(Number).sort(function(a, b) { return a - b; })
    .map(function(position) {
      return { position: position, answer: byPosition[position] };
    });
}

function findQueueBySessionV4_(ss, sessionId) {
  var sheet = requireSheet_(ss, DQ3.queueSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers['Session ID']]) === sessionId &&
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion
    ) {
      rows.push({ rowNumber: i + 1, values: values[i] });
    }
  }
  if (!rows.length) return null;
  rows.sort(function(a, b) {
    return Number(a.values[headers.Position]) - Number(b.values[headers.Position]);
  });
  var statuses = uniqueStringsV4_(rows.map(function(item) {
    return stringValue_(item.values[headers['Queue Status']]).toLowerCase();
  }));
  var status;
  if (statuses.length === 1 && statuses[0] === 'presented') {
    status = 'presented';
  } else if (
    statuses.every(function(value) { return value === 'presented' || value === 'deferred'; }) &&
    statuses.indexOf('presented') !== -1
  ) {
    status = 'presented';
  } else if (
    statuses.length >= 1 &&
    statuses.every(function(value) { return value === 'committed' || value === 'deferred'; }) &&
    statuses.indexOf('committed') !== -1
  ) {
    status = 'committed';
  } else {
    throw new Error('Session Queue status mismatch.');
  }
  var rawRows = rows.map(function(item) { return item.values; });
  validateMaterializedQueueV4_(rawRows, stringValue_(rows[0].values[headers['Queue ID']]));
  return {
    sheet: sheet,
    headers: headers,
    rows: rows,
    queueId: stringValue_(rows[0].values[headers['Queue ID']]),
    sessionId: sessionId,
    dateKey: formatDateKey_(rows[0].values[headers['Queue Date']]),
    status: status,
    plannedCount: queuePlannedCountFromRows_(rawRows),
    adjustedTarget: queueAdjustedTargetFromRowsV4_(rawRows),
    queueKind: stringValue_(rows[0].values[headers['Queue Kind']]) || 'primary'
  };
}

function identityForQueuePositionV4_(queue, position) {
  var item = queue.rows.filter(function(row) {
    return Number(row.values[queue.headers.Position]) === Number(position);
  })[0];
  if (!item) throw new Error('Queue identity is missing for position ' + position + '.');
  return {
    phraseId: stringValue_(item.values[queue.headers['Phrase ID']]),
    candidateId: stringValue_(item.values[queue.headers['Candidate ID']])
  };
}

function findJournalBySessionV4_(ss, sessionId) {
  var sheet = requireSheet_(ss, ER4.journalSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][headers['Session ID']]) === sessionId) {
      matches.push({ rowNumber: i + 1, values: values[i] });
    }
  }
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error('More than one Commit Journal row exists for this Session.');
  var row = matches[0].values;
  return {
    sheet: sheet,
    headers: headers,
    rowNumber: matches[0].rowNumber,
    submissionId: stringValue_(row[headers['Submission ID']]),
    sessionId: sessionId,
    queueId: stringValue_(row[headers['Queue ID']]),
    answerHash: stringValue_(row[headers['Answer Hash']]),
    status: stringValue_(row[headers.Status]),
    lastCompletedStep: stringValue_(row[headers['Last Completed Step']]),
    errorCode: stringValue_(row[headers['Error Code']]),
    errorDetail: stringValue_(row[headers['Error Detail']]),
    readbackStatus: stringValue_(row[headers['Readback Status']]),
    resultJson: stringValue_(row[headers['Result JSON']]),
    confirmationJson: stringValue_(row[headers['Confirmation JSON']])
  };
}

function updateJournalV4_(journal, changes) {
  Object.keys(changes).forEach(function(header) {
    if (journal.headers[header] === undefined) {
      throw new Error('Commit Journal header is missing: ' + header + '.');
    }
    journal.sheet.getRange(journal.rowNumber, journal.headers[header] + 1).setValue(changes[header]);
  });
  journal.sheet.getRange(journal.rowNumber, journal.headers['Updated At'] + 1)
    .setValue(new Date())
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  SpreadsheetApp.flush();
}

function responseForJournalV4_(journal) {
  var response = {
    ok: true,
    state: journal.status,
    sessionId: journal.sessionId,
    queueId: journal.queueId,
    submissionId: journal.submissionId,
    lastCompletedStep: journal.lastCompletedStep,
    errorCode: journal.errorCode,
    errorDetail: journal.errorDetail,
    chatGptTaskUrl: ER4.chatGptTaskUrl,
    chatGptManualUrl: ER4.chatGptManualUrl,
    gradingCommand: '批改'
  };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queue = findQueueBySessionV4_(ss, journal.sessionId);
  if (queue) {
    var settings = readQuestionCountSettingsV4_(ss, queue.dateKey);
    var journalComposition = activeQueueCompositionV4_(queue);
    response.queueMeta = {
      planned: queue.plannedCount,
      adjustedTarget: queue.adjustedTarget,
      requested: settings.targetCount,
      completedBeforeBatch: completedQuestionsForDateV4_(ss, queue.dateKey, queue.sessionId),
      completedInBatch: readDraftsForSessionV4_(ss, queue.sessionId).filter(function(item) {
        return stringValue_(item.submitStatus).toLowerCase() === 'submitted';
      }).length,
      queueKind: queue.queueKind,
      due: journalComposition.due,
      fresh: journalComposition.fresh
    };
  }
  if (journal.resultJson) {
    try {
      response.result = JSON.parse(journal.resultJson);
      enrichExtraPracticeStatusesV4_(ss, response.result);
    } catch (ignore) {}
  }
  if (journal.confirmationJson && journal.status === 'needs_confirmation') {
    try {
      var confirmation = JSON.parse(journal.confirmationJson);
      response.confirmationItems = confirmation.grades.filter(function(grade) {
        return grade.needsConfirmation;
      }).map(function(grade) {
        return {
          position: grade.position,
          result: grade.result,
          feedbackZh: grade.feedbackZh,
          expectedAnswer: grade.expectedAnswer,
          confidence: grade.confidence,
          errorCategory: grade.errorCategory
        };
      });
    } catch (ignore2) {}
  }
  return response;
}

function enrichExtraPracticeStatusesV4_(ss, result) {
  if (!result || !Array.isArray(result.extraPractices) || !result.extraPractices.length) return;
  var ids = {};
  result.extraPractices.forEach(function(item) { ids[item.practiceId] = item; });
  var sheet = requireSheet_(ss, 'Review Log');
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  for (var i = 1; i < values.length; i++) {
    var attemptId = stringValue_(values[i][headers['Attempt ID']]);
    if (!ids[attemptId]) continue;
    ids[attemptId].status = 'completed';
    ids[attemptId].answer = stringValue_(values[i][headers['User Answer']]);
    ids[attemptId].result = stringValue_(values[i][headers.Result]).toLowerCase();
  }
}

function getManualOperationPromptV4(mode, expectedIdentity) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  ensureDynamicQuestionCountSchemaV4_(ss);
  mode = stringValue_(mode).toLowerCase();
  expectedIdentity = stringValue_(expectedIdentity);
  if (['question_prepare', 'grading', 'candidate_generation'].indexOf(mode) === -1) {
    throw new Error('Unsupported manual ChatGPT operation.');
  }
  var todayKey = formatDateKey_(new Date());
  var details = {};
  if (mode === 'question_prepare') {
    var queue = findQueueForDateV4_(ss, todayKey);
    if (!queue || ['planned', 'presented'].indexOf(queue.status) === -1) {
      throw new Error('There is no active daily set waiting for question preparation.');
    }
    if (expectedIdentity && queue.queueId !== expectedIdentity) {
      throw new Error('The planned Queue changed before the manual prompt was prepared. Reload the page.');
    }
    details.queueId = queue.queueId;
    details.count = activeQuestionPositionsV4_(ss, queue).count;
    details.queueStatus = queue.status;
  } else if (mode === 'grading') {
    var journalSheet = requireSheet_(ss, ER4.journalSheet);
    var journalValues = journalSheet.getDataRange().getValues();
    var journalHeaders = headerMap_(journalValues[0]);
    var awaiting = [];
    for (var i = 1; i < journalValues.length; i++) {
      if (
        stringValue_(journalValues[i][journalHeaders.Status]).toLowerCase() === 'awaiting_chatgpt' &&
        stringValue_(journalValues[i][journalHeaders['Contract Version']]) === ER4.contractVersion
      ) {
        awaiting.push({
          submissionId: stringValue_(journalValues[i][journalHeaders['Submission ID']]),
          sessionId: stringValue_(journalValues[i][journalHeaders['Session ID']])
        });
      }
    }
    if (expectedIdentity) awaiting = awaiting.filter(function(item) {
      return item.submissionId === expectedIdentity || item.sessionId === expectedIdentity;
    });
    if (awaiting.length !== 1) {
      throw new Error('Manual grading requires exactly one awaiting submission; found ' + awaiting.length + '.');
    }
    details.submissionId = awaiting[0].submissionId;
    details.sessionId = awaiting[0].sessionId;
  } else {
    var request = findActiveCandidateGenerationRequestV4_(ss, todayKey);
    if (!request) throw new Error('There is no active material-shortfall request.');
    if (expectedIdentity && request.requestId !== expectedIdentity) {
      throw new Error('The material-shortfall request changed before the manual prompt was prepared. Reload the page.');
    }
    details.requestId = request.requestId;
    details.count = request.shortfallCount;
  }
  var prompt = HtmlService.createTemplateFromFile('DailyTaskPrompt').getRawContent();
  prompt += '\n\n====================\n本次手动执行模式\n====================\n';
  prompt += 'RUN_MODE=' + mode + '\n';
  prompt += '这是网页生成的完整独立提示词。立即执行对应模式，不要把本段当成需要解释的材料。\n';
  if (details.queueId) prompt += 'EXPECTED_QUEUE_ID=' + details.queueId + '\n';
  if (details.submissionId) prompt += 'EXPECTED_SUBMISSION_ID=' + details.submissionId + '\n';
  if (details.sessionId) prompt += 'EXPECTED_SESSION_ID=' + details.sessionId + '\n';
  if (details.requestId) prompt += 'EXPECTED_REQUEST_ID=' + details.requestId + '\n';
  if (details.count) prompt += 'EXPECTED_COUNT=' + details.count + '\n';
  return {
    ok: true,
    mode: mode,
    prompt: prompt,
    chatGptUrl: ER4.chatGptManualUrl,
    details: details
  };
}

function parseJsonArrayV4_(value, field, position) {
  var parsed;
  try {
    parsed = JSON.parse(stringValue_(value));
  } catch (error) {
    throw new Error(field + ' is invalid JSON at position ' + position + '.');
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.some(function(item) {
    return !stringValue_(item);
  })) {
    throw new Error(field + ' must be a non-empty string array at position ' + position + '.');
  }
  return parsed.map(stringValue_);
}

function hashV4_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function uniqueStringsV4_(values) {
  var seen = {};
  values.forEach(function(value) { seen[String(value)] = true; });
  return Object.keys(seen);
}

function uniqueDateTimesV4_(values) {
  var seen = {};
  values.forEach(function(value) {
    if (isDateValue_(value)) seen[value.getTime()] = true;
    else seen['invalid:' + stringValue_(value)] = true;
  });
  return Object.keys(seen);
}

function formatDateTimeV4_(value) {
  return isDateValue_(value)
    ? Utilities.formatDate(value, ER4.timezone, 'yyyy-MM-dd HH:mm:ss')
    : stringValue_(value);
}
