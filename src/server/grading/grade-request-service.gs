
function ensureGradeRequestsForJournalV4_(ss, journal) {
  var sheet = requireSheet_(ss, ER4.gradeRequestSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_GRADE_REQUEST_HEADERS, ER4.gradeRequestSheet);
  var existingByPosition = {};
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers['Submission ID']]) !== journal.submissionId ||
      stringValue_(values[i][headers['Session ID']]) !== journal.sessionId
    ) continue;
    var existingPosition = Number(values[i][headers.Position]);
    if (existingByPosition[existingPosition]) {
      throw new Error('Grade Requests contains a duplicate position for this Submission.');
    }
    existingByPosition[existingPosition] = { rowNumber: i + 1, values: values[i] };
  }

  var drafts = readSubmittedDraftsV4_(ss, journal);
  var questionSheet = requireSheet_(ss, ER4.questionSheet);
  var questionValues = questionSheet.getDataRange().getValues();
  var questionHeaders = headerMap_(questionValues[0]);
  requireHeaders_(questionHeaders, ER4_QUESTION_HEADERS, ER4.questionSheet);
  var questionByPosition = {};
  for (var q = 1; q < questionValues.length; q++) {
    if (
      stringValue_(questionValues[q][questionHeaders['Session ID']]) === journal.sessionId &&
      stringValue_(questionValues[q][questionHeaders['Question Status']]).toLowerCase() === 'bound'
    ) {
      var questionPosition = Number(questionValues[q][questionHeaders.Position]);
      if (questionByPosition[questionPosition]) {
        throw new Error('Bound Session Questions contains a duplicate position.');
      }
      questionByPosition[questionPosition] = questionValues[q];
    }
  }

  var phraseStageById = {};
  var phraseSheet = requireSheet_(ss, DQ3.phraseSheet);
  var phraseValues = phraseSheet.getDataRange().getValues();
  var phraseHeaders = headerMap_(phraseValues[0]);
  requireHeaders_(phraseHeaders, ['ID', 'Review Stage'], DQ3.phraseSheet);
  for (var p = 1; p < phraseValues.length; p++) {
    var phraseId = stringValue_(phraseValues[p][phraseHeaders.ID]);
    if (phraseId) phraseStageById[phraseId] = Math.max(1, Number(phraseValues[p][phraseHeaders['Review Stage']]) || 1);
  }

  var rowsToAppend = [];
  var expectedByPosition = {};
  drafts.forEach(function(draft) {
    var question = questionByPosition[draft.position];
    if (!question) throw new Error('Bound question is missing at position ' + draft.position + '.');
    if (
      stringValue_(question[questionHeaders['Phrase ID']]) !== draft.phraseId ||
      stringValue_(question[questionHeaders['Candidate ID']]) !== draft.candidateId
    ) {
      throw new Error('Question identity changed at position ' + draft.position + '.');
    }
    var expected = [
      journal.submissionId,
      journal.sessionId,
      journal.answerHash,
      draft.position,
      draft.phraseId,
      draft.candidateId,
      draft.answer,
      stringValue_(question[questionHeaders['Prompt ZH']]),
      stringValue_(question[questionHeaders['Prompt EN']]),
      stringValue_(question[questionHeaders['Expected Answers JSON']]),
      stringValue_(question[questionHeaders['Accepted Variants JSON']]),
      stringValue_(question[questionHeaders['Semantic Boundary']]),
      stringValue_(question[questionHeaders['Grading Rubric']]),
      draft.phraseId ? phraseStageById[draft.phraseId] : 1,
      'ready',
      new Date(),
      ER4.gradingSnapshotVersion,
      ER4.contractVersion
    ];
    if (draft.phraseId && !phraseStageById[draft.phraseId]) {
      throw new Error('Phrase Review Stage is missing at position ' + draft.position + '.');
    }
    expectedByPosition[draft.position] = expected;
    var existing = existingByPosition[draft.position];
    if (!existing) {
      rowsToAppend.push(expected);
      return;
    }
    var actual = existing.values;
    [
      'Submission ID', 'Session ID', 'Answer Hash', 'Position', 'Phrase ID',
      'Candidate ID', 'Observed Answer', 'Prompt ZH', 'Prompt EN',
      'Expected Answers JSON', 'Accepted Variants JSON', 'Semantic Boundary',
      'Grading Rubric', 'Review Stage', 'Request Status',
      'Snapshot Contract Version', 'Contract Version'
    ].forEach(function(header) {
      var expectedValue = expected[headers[header]];
      var actualValue = actual[headers[header]];
      if (header === 'Position' || header === 'Review Stage') {
        if (Number(actualValue) !== Number(expectedValue)) {
          throw new Error('Grade Request snapshot mismatch at position ' + draft.position + ': ' + header + '.');
        }
      } else if (stringValue_(actualValue) !== stringValue_(expectedValue)) {
        throw new Error('Grade Request snapshot mismatch at position ' + draft.position + ': ' + header + '.');
      }
    });
  });

  if (Object.keys(existingByPosition).some(function(position) { return !expectedByPosition[Number(position)]; })) {
    throw new Error('Grade Requests contains a position outside the frozen answer snapshot.');
  }
  if (rowsToAppend.length) {
    var firstRow = sheet.getLastRow() + 1;
    sheet.getRange(firstRow, 1, rowsToAppend.length, ER4_GRADE_REQUEST_HEADERS.length)
      .setValues(rowsToAppend);
    sheet.getRange(firstRow, headers['Created At'] + 1, rowsToAppend.length, 1)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(firstRow, headers['Snapshot Contract Version'] + 1, rowsToAppend.length, 2)
      .setNumberFormat('@');
    SpreadsheetApp.flush();
  }
  var requests = readGradeRequestsForJournalV4_(ss, journal);
  if (requests.length !== drafts.length) {
    throw new Error('Grade Request readback count mismatch.');
  }
  return requests;
}

function readGradeRequestsForJournalV4_(ss, journal) {
  var sheet = requireSheet_(ss, ER4.gradeRequestSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_GRADE_REQUEST_HEADERS, ER4.gradeRequestSheet);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers['Submission ID']]) === journal.submissionId &&
      stringValue_(values[i][headers['Session ID']]) === journal.sessionId
    ) {
      rows.push({
        rowNumber: i + 1,
        position: Number(values[i][headers.Position]),
        phraseId: stringValue_(values[i][headers['Phrase ID']]),
        candidateId: stringValue_(values[i][headers['Candidate ID']]),
        observedAnswer: stringValue_(values[i][headers['Observed Answer']]),
        answerHash: stringValue_(values[i][headers['Answer Hash']]),
        expectedAnswers: parseJsonArrayV4_(
          values[i][headers['Expected Answers JSON']],
          'Expected Answers JSON',
          Number(values[i][headers.Position])
        ),
        acceptedVariants: parseJsonArrayV4_(
          values[i][headers['Accepted Variants JSON']],
          'Accepted Variants JSON',
          Number(values[i][headers.Position])
        ),
        reviewStage: Number(values[i][headers['Review Stage']]) || 1,
        requestStatus: stringValue_(values[i][headers['Request Status']]),
        snapshotContractVersion: stringValue_(values[i][headers['Snapshot Contract Version']]),
        contractVersion: stringValue_(values[i][headers['Contract Version']])
      });
    }
  }
  rows.sort(function(a, b) { return a.position - b.position; });
  var seen = {};
  rows.forEach(function(item) {
    if (seen[item.position]) throw new Error('Grade Requests contains a duplicate position.');
    seen[item.position] = true;
    if (
      item.answerHash !== journal.answerHash ||
      item.requestStatus !== 'ready' ||
      item.snapshotContractVersion !== ER4.gradingSnapshotVersion ||
      item.contractVersion !== ER4.contractVersion
    ) {
      throw new Error('Grade Request integrity mismatch at position ' + item.position + '.');
    }
  });
  return rows;
}

function backfillGradeRequestsV4(sessionId) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    var journal = findJournalBySessionV4_(ss, stringValue_(sessionId));
    if (!journal) throw new Error('Commit Journal entry was not found.');
    var rows = ensureGradeRequestsForJournalV4_(ss, journal);
    return {
      ok: true,
      submissionId: journal.submissionId,
      sessionId: journal.sessionId,
      answerHash: journal.answerHash,
      count: rows.length,
      snapshotContractVersion: ER4.gradingSnapshotVersion
    };
  } finally {
    lock.releaseLock();
  }
}
