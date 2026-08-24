
function getSubmissionStatusV4(sessionId) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  processSubmissionForSessionV4_(sessionId);
  var journal = findJournalBySessionV4_(
    SpreadsheetApp.getActiveSpreadsheet(),
    stringValue_(sessionId)
  );
  if (!journal) throw new Error('Commit Journal entry was not found.');
  return responseForJournalV4_(journal);
}

function processPendingGradeInboxV4() {
  if (PropertiesService.getScriptProperties().getProperty(ER4.enabledProperty) !== 'yes') {
    return { ok: true, skipped: true, reason: 'v4_disabled' };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  var candidateGeneration;
  var queueContinuation = null;
  var queueLock = LockService.getDocumentLock();
  queueLock.waitLock(30000);
  try {
    ensureDynamicQuestionCountSchemaV4_(ss);
    candidateGeneration = processCandidateGenerationInboxV4_(
      ss,
      formatDateKey_(new Date())
    );
    if (candidateGeneration.processed) {
      queueContinuation = ensureQueueForDateV4Unlocked_(
        ss,
        new Date(),
        'candidate shortfall resolved'
      );
    }
  } finally {
    queueLock.releaseLock();
  }
  var sheet = requireSheet_(ss, ER4.journalSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var activeStatuses = {
    awaiting_chatgpt: true,
    grading_validated: true,
    writing: true,
    verifying: true,
    write_incomplete: true
  };
  var sessions = [];
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion &&
      activeStatuses[stringValue_(values[i][headers.Status]).toLowerCase()]
    ) {
      sessions.push(stringValue_(values[i][headers['Session ID']]));
    }
  }
  var results = sessions.map(function(sessionId) {
    try {
      return processSubmissionForSessionV4_(sessionId);
    } catch (error) {
      return { ok: false, sessionId: sessionId, error: error.message };
    }
  });
  return {
    ok: true,
    processed: results.length,
    results: results,
    candidateGeneration: candidateGeneration,
    queueContinuation: queueContinuation
  };
}

function processSubmissionForSessionV4_(sessionId) {
  sessionId = stringValue_(sessionId);
  if (!sessionId) throw new Error('Session ID is required.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    var journal = findJournalBySessionV4_(ss, sessionId);
    if (!journal) throw new Error('Commit Journal entry was not found.');
    if (journal.status === 'committed' || journal.status === 'needs_confirmation') {
      return responseForJournalV4_(journal);
    }
    if (journal.status === 'awaiting_chatgpt') {
      var staged = readStagedGradesV4_(ss, journal);
      if (!staged) return responseForJournalV4_(journal);
      var payload;
      try {
        payload = validateStagedGradesV4_(ss, journal, staged);
      } catch (error) {
        rejectGradeRowsV4_(staged.rows);
        updateJournalV4_(journal, {
          'Error Code': 'GRADE_VALIDATION_FAILED',
          'Error Detail': error.message,
          'Readback Status': 'not_started'
        });
        return responseForJournalV4_(findJournalBySessionV4_(ss, sessionId));
      }
      if (!payload.complete) return responseForJournalV4_(journal);

      var snapshot = {
        grades: payload.grades,
        candidateSuggestions: payload.candidateSuggestions,
        extraPractices: payload.extraPractices,
        gradingBatchId: payload.gradingBatchId,
        gradingBatchIds: payload.gradingBatchIds,
        commitPlan: null
      };
      var needsConfirmation = payload.grades.some(function(grade) {
        return grade.needsConfirmation;
      });
      setGradeRowStatusV4_(payload.rows, needsConfirmation ? 'needs_confirmation' : 'accepted');
      updateJournalV4_(journal, {
        Status: needsConfirmation ? 'needs_confirmation' : 'grading_validated',
        'Last Completed Step': needsConfirmation ? 'grading_needs_confirmation' : 'grading_validated',
        'Error Code': '',
        'Error Detail': '',
        'Readback Status': 'grading_validated',
        'Confirmation JSON': JSON.stringify(snapshot)
      });
      journal = findJournalBySessionV4_(ss, sessionId);
      if (needsConfirmation) return responseForJournalV4_(journal);
    }

    if (
      ['grading_validated', 'writing', 'verifying', 'write_incomplete']
        .indexOf(journal.status) !== -1
    ) {
      try {
        return commitSubmissionV4_(ss, journal);
      } catch (error2) {
        journal = findJournalBySessionV4_(ss, sessionId);
        updateJournalV4_(journal, {
          Status: 'write_incomplete',
          'Error Code': 'WRITE_INCOMPLETE',
          'Error Detail': error2.message,
          'Readback Status': 'failed'
        });
        return responseForJournalV4_(findJournalBySessionV4_(ss, sessionId));
      }
    }
    return responseForJournalV4_(journal);
  } finally {
    lock.releaseLock();
  }
}

function readStagedGradesV4_(ss, journal) {
  var sheet = requireSheet_(ss, ER4.gradeSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_GRADE_HEADERS, ER4.gradeSheet);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers['Submission ID']]) === journal.submissionId &&
      stringValue_(values[i][headers['Session ID']]) === journal.sessionId &&
      stringValue_(values[i][headers['Grade Status']]).toLowerCase() === 'staged'
    ) {
      rows.push({
        sheet: sheet,
        headers: headers,
        rowNumber: i + 1,
        values: values[i]
      });
    }
  }
  return rows.length ? { sheet: sheet, headers: headers, rows: rows } : null;
}

function validateStagedGradesV4_(ss, journal, staged) {
  var queue = findQueueBySessionV4_(ss, journal.sessionId);
  if (!queue || ['presented', 'committed'].indexOf(queue.status) === -1) {
    throw new Error('The submitted Session Queue is unavailable.');
  }
  if (queue.queueId !== journal.queueId || queue.rows.length !== queue.plannedCount) {
    throw new Error('Commit Journal and Daily Queue identity mismatch.');
  }
  var drafts = readSubmittedDraftsV4_(ss, journal);
  if (staged.rows.length > drafts.length) {
    throw new Error(
      'ChatGPT staged more grade rows than submitted answers; expected at most ' +
      drafts.length + ', found ' + staged.rows.length + '.'
    );
  }
  var draftByPosition = {};
  drafts.forEach(function(item) { draftByPosition[item.position] = item; });
  var gradeByPosition = {};
  var batchIds = {};
  var suggestionJsons = [];
  var extraPracticeJsons = [];

  staged.rows.forEach(function(item) {
    var row = item.values;
    var h = item.headers;
    var position = Number(row[h.Position]);
    if (position < 1 || position > queue.plannedCount || gradeByPosition[position]) {
      throw new Error('Grade batch has an invalid or duplicate position: ' + position + '.');
    }
    if (
      stringValue_(row[h['Answer Hash']]) !== journal.answerHash ||
      stringValue_(row[h['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('Grade batch hash or contract mismatch at position ' + position + '.');
    }
    var draft = draftByPosition[position];
    if (!draft) throw new Error('Frozen answer is missing at position ' + position + '.');
    ['phraseId', 'candidateId'].forEach(function(key) {
      var header = key === 'phraseId' ? 'Phrase ID' : 'Candidate ID';
      if (stringValue_(row[h[header]]) !== stringValue_(draft[key])) {
        throw new Error('Grade identity mismatch at position ' + position + '.');
      }
    });
    var result = stringValue_(row[h.Result]).toLowerCase();
    if (ER4_RESULTS.indexOf(result) === -1) {
      throw new Error('Unsupported Result at position ' + position + '.');
    }
    var confidence = Number(row[h.Confidence]);
    if (!isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1 at position ' + position + '.');
    }
    var gradingBatchId = stringValue_(row[h['Grading Batch ID']]);
    if (!gradingBatchId) throw new Error('Grading Batch ID is blank.');
    batchIds[gradingBatchId] = true;
    var suggestionJson = stringValue_(row[h['Candidate Suggestions JSON']]);
    if (suggestionJson) suggestionJsons.push(suggestionJson);
    var extraPracticeJson = stringValue_(row[h['Extra Practice JSON']]);
    if (extraPracticeJson) extraPracticeJsons.push(extraPracticeJson);
    gradeByPosition[position] = {
      position: position,
      phraseId: draft.phraseId,
      candidateId: draft.candidateId,
      answer: draft.answer,
      result: result,
      feedbackZh: stringValue_(row[h['Feedback ZH']]),
      errorCategory: stringValue_(row[h['Error Category']]),
      confidence: confidence,
      evidence: stringValue_(row[h.Evidence]),
      expectedAnswer: stringValue_(row[h['Expected Answer']]),
      questionType: draft.questionType,
      prompt: draft.prompt,
      needsConfirmation: confidence < ER4.lowConfidenceThreshold,
      gradeRowNumber: item.rowNumber
    };
    if (!gradeByPosition[position].expectedAnswer) {
      throw new Error('Expected Answer is blank at position ' + position + '.');
    }
  });
  var gradingBatchIds = Object.keys(batchIds).sort();
  if (!gradingBatchIds.length) {
    throw new Error('At least one Grading Batch ID is required.');
  }
  if (suggestionJsons.length > 1) {
    throw new Error('Candidate Suggestions JSON must appear in at most one grade row.');
  }
  if (extraPracticeJsons.length > 1) {
    throw new Error('Extra Practice JSON must appear in at most one grade row.');
  }
  if (staged.rows.length < drafts.length) {
    return {
      complete: false,
      rows: staged.rows,
      gradingBatchIds: gradingBatchIds,
      stagedCount: staged.rows.length,
      expectedCount: drafts.length
    };
  }
  var grades = drafts.map(function(draft) {
    if (!gradeByPosition[draft.position]) {
      throw new Error('Missing grade position: ' + draft.position + '.');
    }
    return gradeByPosition[draft.position];
  });
  var suggestions = suggestionJsons.length
    ? parseCandidateSuggestionsV4_(suggestionJsons[0])
    : [];
  if (!extraPracticeJsons.length) {
    throw new Error('Extra Practice JSON must appear exactly once in a complete grade batch.');
  }
  var extraPractices = parseExtraPracticeSuggestionsV4_(extraPracticeJsons[0], grades);
  return {
    complete: true,
    rows: staged.rows,
    gradingBatchId: gradingBatchIds.join(','),
    gradingBatchIds: gradingBatchIds,
    grades: grades,
    candidateSuggestions: suggestions,
    extraPractices: extraPractices
  };
}

function parseExtraPracticeSuggestionsV4_(value, grades) {
  var parsed;
  try {
    parsed = JSON.parse(stringValue_(value));
  } catch (error) {
    throw new Error('Extra Practice JSON is invalid.');
  }
  if (!Array.isArray(parsed)) throw new Error('Extra Practice JSON must be an array.');
  var gradeByPosition = {};
  grades.forEach(function(grade) { gradeByPosition[Number(grade.position)] = grade; });
  var reinforcementByPosition = {};
  var sentenceByPosition = {};
  var normalized = parsed.map(function(item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Extra practice ' + (index + 1) + ' must be an object.');
    }
    var sourcePosition = Number(item.sourcePosition);
    var practiceType = stringValue_(item.practiceType).toLowerCase();
    var grade = gradeByPosition[sourcePosition];
    if (!grade || ['reinforcement', 'sentence_challenge'].indexOf(practiceType) === -1) {
      throw new Error('Extra practice ' + (index + 1) + ' has an invalid source or type.');
    }
    var promptZh = stringValue_(item.promptZh);
    var expectedAnswers = Array.isArray(item.expectedAnswers)
      ? item.expectedAnswers.map(stringValue_).filter(Boolean)
      : [];
    var acceptedVariants = Array.isArray(item.acceptedVariants)
      ? item.acceptedVariants.map(stringValue_).filter(Boolean)
      : [];
    var referenceAnswer = stringValue_(item.referenceAnswer);
    var contextSignature = stringValue_(item.contextSignature);
    if (!promptZh || !expectedAnswers.length || !referenceAnswer || !contextSignature) {
      throw new Error('Extra practice ' + (index + 1) + ' is missing required content.');
    }
    if (practiceType === 'reinforcement') {
      if (reinforcementByPosition[sourcePosition]) {
        throw new Error('A formal error has more than one reinforcement question.');
      }
      reinforcementByPosition[sourcePosition] = true;
    } else {
      if (sentenceByPosition[sourcePosition]) {
        throw new Error('A formal item has more than one sentence challenge.');
      }
      sentenceByPosition[sourcePosition] = true;
    }
    return {
      sourcePosition: sourcePosition,
      practiceType: practiceType,
      promptZh: promptZh,
      expectedAnswers: expectedAnswers,
      acceptedVariants: acceptedVariants,
      referenceAnswer: referenceAnswer,
      contextSignature: contextSignature
    };
  });
  grades.forEach(function(grade) {
    var isError = grade.result === 'forgotten' || grade.result === 'difficult';
    if (isError && !reinforcementByPosition[grade.position]) {
      throw new Error('Every formal error must have one reinforcement question; missing position ' + grade.position + '.');
    }
    if (!isError && reinforcementByPosition[grade.position]) {
      throw new Error('Reinforcement was generated for a non-error at position ' + grade.position + '.');
    }
  });
  return normalized;
}

function readSubmittedDraftsV4_(ss, journal) {
  var draftSheet = requireSheet_(ss, ER4.draftSheet);
  var draftValues = draftSheet.getDataRange().getValues();
  var draftHeaders = headerMap_(draftValues[0]);
  var questionSheet = requireSheet_(ss, ER4.questionSheet);
  var questionValues = questionSheet.getDataRange().getValues();
  var questionHeaders = headerMap_(questionValues[0]);
  var questionByPosition = {};
  for (var q = 1; q < questionValues.length; q++) {
    if (
      stringValue_(questionValues[q][questionHeaders['Session ID']]) === journal.sessionId &&
      stringValue_(questionValues[q][questionHeaders['Question Status']]).toLowerCase() === 'bound'
    ) {
      var questionPosition = Number(questionValues[q][questionHeaders.Position]);
      questionByPosition[questionPosition] = {
        questionType: stringValue_(questionValues[q][questionHeaders['Question Type']]),
        prompt: [
          stringValue_(questionValues[q][questionHeaders['Prompt ZH']]),
          stringValue_(questionValues[q][questionHeaders['Prompt EN']])
        ].filter(Boolean).join(' / ')
      };
    }
  }
  var rows = [];
  for (var i = 1; i < draftValues.length; i++) {
    if (
      stringValue_(draftValues[i][draftHeaders['Session ID']]) === journal.sessionId &&
      stringValue_(draftValues[i][draftHeaders['Submission ID']]) === journal.submissionId &&
      stringValue_(draftValues[i][draftHeaders['Answer Hash']]) === journal.answerHash &&
      stringValue_(draftValues[i][draftHeaders['Submit Status']]).toLowerCase() === 'submitted'
    ) {
      var position = Number(draftValues[i][draftHeaders.Position]);
      var question = questionByPosition[position];
      if (!question) throw new Error('Bound question is missing at position ' + position + '.');
      rows.push({
        position: position,
        phraseId: stringValue_(draftValues[i][draftHeaders['Phrase ID']]),
        candidateId: stringValue_(draftValues[i][draftHeaders['Candidate ID']]),
        answer: stringValue_(draftValues[i][draftHeaders.Answer]),
        questionType: question.questionType,
        prompt: question.prompt
      });
    }
  }
  var queue = findQueueBySessionV4_(ss, journal.sessionId);
  if (!queue || rows.length < 1 || rows.length > queue.plannedCount) {
    throw new Error(
      'Frozen submitted-answer count is invalid for this Queue; found ' + rows.length + '.'
    );
  }
  rows.sort(function(a, b) { return a.position - b.position; });
  var positions = {};
  rows.forEach(function(item) {
    if (positions[item.position]) throw new Error('Frozen submitted answers contain a duplicate position.');
    positions[item.position] = true;
  });
  return rows;
}

function rejectGradeRowsV4_(rows) {
  setGradeRowStatusV4_(rows, 'rejected');
}

function setGradeRowStatusV4_(rows, status) {
  rows.forEach(function(item) {
    item.sheet.getRange(item.rowNumber, item.headers['Grade Status'] + 1).setValue(status);
  });
  SpreadsheetApp.flush();
}

function confirmGradesV4(sessionId, decisions) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    var journal = findJournalBySessionV4_(ss, stringValue_(sessionId));
    if (!journal || journal.status !== 'needs_confirmation') {
      throw new Error('This Session does not require grading confirmation.');
    }
    var snapshot = parseConfirmationSnapshotV4_(journal);
    if (!Array.isArray(decisions)) throw new Error('Confirmation decisions are missing.');
    var decisionByPosition = {};
    decisions.forEach(function(decision) {
      var position = Number(decision && decision.position);
      var result = stringValue_(decision && decision.result).toLowerCase();
      if (position < 1 || position > ER4.maxBatchQuestionCount || decisionByPosition[position]) {
        throw new Error('Confirmation contains an invalid or duplicate position.');
      }
      if (ER4_RESULTS.indexOf(result) === -1) {
        throw new Error('Confirmation contains an unsupported result.');
      }
      decisionByPosition[position] = result;
    });
    var required = snapshot.grades.filter(function(grade) {
      return grade.needsConfirmation;
    });
    if (
      required.length !== decisions.length ||
      required.some(function(grade) { return !decisionByPosition[grade.position]; })
    ) {
      throw new Error('Every low-confidence item must be confirmed exactly once.');
    }
    snapshot.grades.forEach(function(grade) {
      if (decisionByPosition[grade.position]) {
        grade.result = decisionByPosition[grade.position];
        grade.needsConfirmation = false;
        grade.confirmedByUser = true;
      }
    });
    var gradeSheet = requireSheet_(ss, ER4.gradeSheet);
    var gradeValues = gradeSheet.getDataRange().getValues();
    var gradeHeaders = headerMap_(gradeValues[0]);
    for (var i = 1; i < gradeValues.length; i++) {
      if (
        stringValue_(gradeValues[i][gradeHeaders['Submission ID']]) === journal.submissionId &&
        stringValue_(gradeValues[i][gradeHeaders['Session ID']]) === journal.sessionId
      ) {
        var gradePosition = Number(gradeValues[i][gradeHeaders.Position]);
        var snapshotGrade = snapshot.grades.filter(function(item) {
          return item.position === gradePosition;
        })[0];
        if (snapshotGrade) {
          gradeSheet.getRange(i + 1, gradeHeaders.Result + 1).setValue(snapshotGrade.result);
          gradeSheet.getRange(i + 1, gradeHeaders['Grade Status'] + 1).setValue('accepted');
        }
      }
    }
    updateJournalV4_(journal, {
      Status: 'grading_validated',
      'Last Completed Step': 'user_confirmation_recorded',
      'Error Code': '',
      'Error Detail': '',
      'Readback Status': 'grading_validated',
      'Confirmation JSON': JSON.stringify(snapshot)
    });
    SpreadsheetApp.flush();
    return commitSubmissionV4_(
      ss,
      findJournalBySessionV4_(ss, journal.sessionId)
    );
  } finally {
    lock.releaseLock();
  }
}

function retrySubmissionCommitV4(sessionId) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  return processSubmissionForSessionV4_(sessionId);
}

function submitExtraPracticeV4(sessionId, practiceId, answer) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  sessionId = stringValue_(sessionId);
  practiceId = stringValue_(practiceId);
  answer = stringValue_(answer).trim();
  if (!answer) throw new Error('请先填写这道加练题。');
  if (answer.length > 2000) throw new Error('加练答案过长。');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return draftBusyResponseV4_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    var journal = findJournalBySessionV4_(ss, sessionId);
    if (!journal || journal.status !== 'committed') {
      throw new Error('正式题组尚未完成，不能提交加练。');
    }
    var snapshot = parseConfirmationSnapshotV4_(journal);
    var plan = snapshot.commitPlan;
    if (!plan || !Array.isArray(plan.extraPractices)) {
      throw new Error('加练计划不可用。');
    }
    var practice = plan.extraPractices.filter(function(item) {
      return item.practiceId === practiceId;
    })[0];
    if (!practice) throw new Error('加练题身份不匹配。');

    var sheet = requireSheet_(ss, 'Review Log');
    var values = sheet.getDataRange().getValues();
    var headers = headerMap_(values[0]);
    requireHeaders_(headers, [
      'Date', 'Session ID', 'Question #', 'Prompt', 'Expected Answer', 'User Answer',
      'Result', 'Tag', 'Follow-up Needed', 'Notes', 'Attempt ID', 'Attempt Type',
      'Parent Attempt ID', 'Question Type', 'Affects SRS?', 'Contract Version'
    ], 'Review Log');
    for (var i = 1; i < values.length; i++) {
      if (stringValue_(values[i][headers['Attempt ID']]) !== practiceId) continue;
      var existingAnswer = stringValue_(values[i][headers['User Answer']]);
      if (existingAnswer !== answer) {
        throw new Error('这道加练已经提交，不能用另一份答案覆盖。');
      }
      return extraPracticeSubmissionResponseV4_(practice, existingAnswer,
        stringValue_(values[i][headers.Result]).toLowerCase(), true);
    }

    var result = practice.practiceType === 'reinforcement'
      ? gradeReinforcementAnswerV4_(answer, practice)
      : 'completed';
    var row = [
      parseDateKey_(plan.queueDate),
      sessionId,
      practice.sourcePosition,
      practice.promptZh,
      practice.referenceAnswer,
      answer,
      result,
      practice.phraseId,
      'no',
      practice.practiceType === 'reinforcement'
        ? 'One-step error reinforcement; non-recursive and excluded from SRS.'
        : 'Full-sentence transfer challenge; completion only and excluded from SRS.',
      practice.practiceId,
      practice.practiceType,
      practice.parentAttemptId,
      practice.practiceType === 'reinforcement' ? 'reinforcement' : 'sentence_transfer',
      'no',
      ER4.contractVersion
    ];
    var rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, headers['Contract Version'] + 1).setNumberFormat('@');
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    sheet.getRange(rowNumber, headers.Date + 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(rowNumber, headers['Contract Version'] + 1)
      .setNumberFormat('@')
      .setValue(ER4.contractVersion);
    SpreadsheetApp.flush();
    var readback = sheet.getRange(rowNumber, 1, 1, row.length).getValues()[0];
    if (
      stringValue_(readback[headers['Attempt ID']]) !== practice.practiceId ||
      stringValue_(readback[headers['Parent Attempt ID']]) !== practice.parentAttemptId ||
      stringValue_(readback[headers['Attempt Type']]) !== practice.practiceType ||
      stringValue_(readback[headers['User Answer']]) !== answer ||
      stringValue_(readback[headers['Affects SRS?']]).toLowerCase() !== 'no' ||
      stringValue_(readback[headers['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('加练保存后的精确回读不一致。');
    }
    invalidateLearningDashboardCacheV4_();
    return extraPracticeSubmissionResponseV4_(practice, answer, result, false);
  } finally {
    lock.releaseLock();
  }
}

function gradeReinforcementAnswerV4_(answer, practice) {
  var accepted = practice.expectedAnswers.concat(practice.acceptedVariants || []).map(function(value) {
    return normalizeChunk_(value);
  });
  return accepted.indexOf(normalizeChunk_(answer)) === -1 ? 'difficult' : 'normal';
}

function extraPracticeSubmissionResponseV4_(practice, answer, result, idempotent) {
  return {
    ok: true,
    practiceId: practice.practiceId,
    practiceType: practice.practiceType,
    answer: answer,
    result: result,
    referenceAnswer: practice.referenceAnswer,
    idempotent: Boolean(idempotent),
    affectsSrs: false,
    recursive: false
  };
}

function parseConfirmationSnapshotV4_(journal) {
  var snapshot;
  try {
    snapshot = JSON.parse(journal.confirmationJson);
  } catch (error) {
    throw new Error('The verified grading snapshot is unavailable.');
  }
  if (
    !snapshot ||
    !Array.isArray(snapshot.grades) ||
    snapshot.grades.length < 1 ||
    snapshot.grades.length > ER4.maxBatchQuestionCount
  ) {
    throw new Error('The verified grading snapshot is incomplete.');
  }
  if (!Array.isArray(snapshot.candidateSuggestions)) snapshot.candidateSuggestions = [];
  if (!Array.isArray(snapshot.extraPractices)) snapshot.extraPractices = [];
  return snapshot;
}

function parseCandidateSuggestionsV4_(value) {
  var parsed;
  try {
    parsed = JSON.parse(stringValue_(value));
  } catch (error) {
    throw new Error('Candidate Suggestions JSON is invalid.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Candidate Suggestions JSON must be an array.');
  }
  if (parsed.length > 60) {
    throw new Error('Candidate Suggestions JSON may contain at most 60 items.');
  }
  return parsed.map(function(item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Candidate suggestion ' + (index + 1) + ' must be an object.');
    }
    var candidate = stringValue_(item.candidate);
    var chineseCue = stringValue_(item.chineseCue);
    var topic = stringValue_(item.topic);
    var difficulty = stringValue_(item.difficulty).toLowerCase();
    var naturalExample = stringValue_(item.naturalExample);
    if (!candidate || !chineseCue || !topic || !naturalExample) {
      throw new Error('Candidate suggestion ' + (index + 1) + ' is missing required fields.');
    }
    if (!normalizeChunk_(candidate) || candidate.length > 120) {
      throw new Error('Candidate suggestion ' + (index + 1) + ' has an invalid candidate.');
    }
    if (['easy', 'medium', 'hard'].indexOf(difficulty) === -1) {
      throw new Error('Candidate suggestion ' + (index + 1) + ' has invalid difficulty.');
    }
    return {
      candidate: candidate,
      chineseCue: chineseCue,
      candidateType: stringValue_(item.candidateType) || 'chunk',
      source: stringValue_(item.source) || 'ChatGPT personalized fallback',
      context: stringValue_(item.context),
      whyUseful: stringValue_(item.whyUseful) || 'Practical reusable English chunk.',
      topic: topic,
      difficulty: difficulty,
      naturalExample: naturalExample,
      commonMistake: stringValue_(item.commonMistake)
    };
  });
}

function countPersonalCandidateBacklogV4_(ss) {
  var count = 0;
  var contextSheet = requireSheet_(ss, ER4.contextSheet);
  var contextValues = contextSheet.getDataRange().getValues();
  var contextHeaders = headerMap_(contextValues[0]);
  requireHeaders_(contextHeaders, ['Context ID', 'Processing Status'], ER4.contextSheet);
  for (var i = 1; i < contextValues.length; i++) {
    if (!stringValue_(contextValues[i][contextHeaders['Context ID']])) continue;
    var processingStatus = stringValue_(
      contextValues[i][contextHeaders['Processing Status']]
    ).toLowerCase();
    if (['pending', 'processing', 'staged', 'needs_review'].indexOf(processingStatus) !== -1) {
      count++;
    }
  }

  var proposalSheet = requireSheet_(ss, ER4.contextCandidateSheet);
  var proposalValues = proposalSheet.getDataRange().getValues();
  var proposalHeaders = headerMap_(proposalValues[0]);
  requireHeaders_(proposalHeaders, ['Context ID', 'Decision Status'], ER4.contextCandidateSheet);
  for (var p = 1; p < proposalValues.length; p++) {
    if (!stringValue_(proposalValues[p][proposalHeaders['Context ID']])) continue;
    var decisionStatus = stringValue_(
      proposalValues[p][proposalHeaders['Decision Status']]
    ).toLowerCase();
    if (['staged', 'accepted', 'edited'].indexOf(decisionStatus) !== -1) count++;
  }
  return count;
}

function shouldGenerateAiFallbackV4_(personalReadyCount, totalReadyCount, backlogCount) {
  return (
    Number(personalReadyCount) === 0 &&
    Number(backlogCount) === 0 &&
    Number(totalReadyCount) < ER4.aiFallbackPoolTarget
  );
}

function commitSubmissionV4_(ss, journal) {
  var snapshot = parseConfirmationSnapshotV4_(journal);
  if (!snapshot.commitPlan) {
    snapshot.commitPlan = createCommitPlanV4_(ss, journal, snapshot);
    updateJournalV4_(journal, {
      Status: 'grading_validated',
      'Last Completed Step': 'commit_plan_frozen',
      'Confirmation JSON': JSON.stringify(snapshot),
      'Error Code': '',
      'Error Detail': ''
    });
    journal = findJournalBySessionV4_(ss, journal.sessionId);
  }
  var plan = snapshot.commitPlan;
  validateFrozenCommitPlanV4_(journal, snapshot, plan);
  updateJournalV4_(journal, {
    Status: 'writing',
    'Last Completed Step': journal.lastCompletedStep || 'commit_plan_frozen',
    'Error Code': '',
    'Error Detail': '',
    'Readback Status': 'in_progress'
  });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  writeReviewLogV4_(ss, plan);
  updateJournalV4_(journal, { 'Last Completed Step': 'review_log' });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  writeErrorLogV4_(ss, plan);
  updateJournalV4_(journal, { 'Last Completed Step': 'error_log' });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  writeCandidateBankV4_(ss, plan);
  updateJournalV4_(journal, { 'Last Completed Step': 'candidate_bank' });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  writePhraseBankV4_(ss, plan);
  updateJournalV4_(journal, { 'Last Completed Step': 'phrase_bank' });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  writeDailyQueueCommitV4_(ss, plan);
  updateJournalV4_(journal, {
    Status: 'verifying',
    'Last Completed Step': 'daily_queue',
    'Readback Status': 'pre_session_log'
  });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  verifyFormalWritesV4_(ss, plan, false);
  updateJournalV4_(journal, {
    'Last Completed Step': 'pre_session_readback',
    'Readback Status': 'pre_session_verified'
  });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  writeSessionLogV4_(ss, plan);
  updateJournalV4_(journal, { 'Last Completed Step': 'session_log' });
  journal = findJournalBySessionV4_(ss, journal.sessionId);

  var result = verifyFormalWritesV4_(ss, plan, true);
  markGradeRowsCommittedV4_(ss, journal.submissionId, journal.sessionId);
  try {
    var nextBatch = ensureQueueForDateV4Unlocked_(
      ss,
      parseDateKey_(plan.queueDate),
      'continue requested count after committed batch'
    );
    result.nextBatch = nextBatch || null;
    if (nextBatch && nextBatch.state === 'candidate_shortfall') {
      result.nextMaterialShortfall = Number(nextBatch.shortfallCount || 0);
      result.nextMaterialRequestId = nextBatch.requestId || '';
    }
  } catch (nextBatchError) {
    result.nextBatchError = nextBatchError.message;
  }
  updateJournalV4_(journal, {
    Status: 'committed',
    'Last Completed Step': 'verified_complete',
    'Completed At': new Date(),
    'Error Code': '',
    'Error Detail': '',
    'Readback Status': 'verified',
    'Result JSON': JSON.stringify(result)
  });
  invalidateLearningDashboardCacheV4_();
  return responseForJournalV4_(findJournalBySessionV4_(ss, journal.sessionId));
}

function createCommitPlanV4_(ss, journal, snapshot) {
  var queue = findQueueBySessionV4_(ss, journal.sessionId);
  if (!queue || queue.status !== 'presented' || queue.rows.length !== queue.plannedCount) {
    throw new Error('A complete presented Queue is required before commit planning.');
  }
  if (queue.queueId !== journal.queueId) {
    throw new Error('Queue ID changed after submission.');
  }
  var presentedTimes = uniqueDateTimesV4_(queue.rows.map(function(item) {
    return item.values[queue.headers['Presented At']];
  }));
  if (presentedTimes.length !== 1 || !isDateValue_(queue.rows[0].values[queue.headers['Presented At']])) {
    throw new Error('Queue Presented At is missing or inconsistent.');
  }

  var phraseSheet = requireSheet_(ss, DQ3.phraseSheet);
  var phraseValues = phraseSheet.getDataRange().getValues();
  var phraseHeaders = headerMap_(phraseValues[0]);
  requireHeaders_(phraseHeaders, [
    'ID', 'Chunk', '中文提示', 'Type', 'Topic', 'Difficulty', 'Status',
    'Review Stage', 'Next Review', 'Common Mistake', 'Natural Example', 'Notes',
    'Source', 'Created Date', 'Source Candidate ID', 'Mastery Streak',
    'Last Result', 'Contract Version', 'Canonical Pattern'
  ], DQ3.phraseSheet);
  var phraseById = {};
  var occupiedChunks = {};
  var nextPhraseNumber = 0;
  for (var p = 1; p < phraseValues.length; p++) {
    var phraseId = stringValue_(phraseValues[p][phraseHeaders.ID]);
    if (!phraseId) continue;
    phraseById[phraseId] = { rowNumber: p + 1, values: phraseValues[p] };
    nextPhraseNumber = Math.max(nextPhraseNumber, numericSuffixV4_(phraseId, 'ENG-'));
    var chunkKey = normalizeChunk_(phraseValues[p][phraseHeaders.Chunk]);
    var canonicalKey = normalizeChunk_(phraseValues[p][phraseHeaders['Canonical Pattern']]);
    if (chunkKey) occupiedChunks[chunkKey] = true;
    if (canonicalKey) occupiedChunks[canonicalKey] = true;
  }

  var candidateSheet = requireSheet_(ss, DQ3.candidateSheet);
  var candidateValues = candidateSheet.getDataRange().getValues();
  var candidateHeaders = headerMap_(candidateValues[0]);
  requireHeaders_(candidateHeaders, [
    'Candidate ID', 'Date Added', 'Candidate', 'Candidate Type', 'Source',
    'Context', 'Why Useful', 'Status', 'Promoted Phrase ID', 'Date Promoted',
    'Deferral Reason', 'Source Note Row', '中文提示', 'Topic', 'Difficulty',
    'Natural Example', 'Common Mistake', 'Origin Type', 'Origin Context ID',
    'Selected Text', 'Source URL', 'Intake Priority'
  ], DQ3.candidateSheet);
  var candidateById = {};
  var nextCandidateNumber = 0;
  var readyCountAfterPromotion = 0;
  var personalReadyCountAfterPromotion = 0;
  var selectedCandidateIds = {};
  var submittedPositions = {};
  snapshot.grades.forEach(function(grade) {
    submittedPositions[Number(grade.position)] = true;
  });
  queue.rows.forEach(function(item) {
    var queuePosition = Number(item.values[queue.headers.Position]);
    if (!submittedPositions[queuePosition]) return;
    var candidateId = stringValue_(item.values[queue.headers['Candidate ID']]);
    if (candidateId) selectedCandidateIds[candidateId] = true;
  });
  for (var c = 1; c < candidateValues.length; c++) {
    var candidateId = stringValue_(candidateValues[c][candidateHeaders['Candidate ID']]);
    if (!candidateId) continue;
    candidateById[candidateId] = { rowNumber: c + 1, values: candidateValues[c] };
    nextCandidateNumber = Math.max(nextCandidateNumber, numericSuffixV4_(candidateId, 'CAN-'));
    var candidateChunkKey = normalizeChunk_(candidateValues[c][candidateHeaders.Candidate]);
    if (candidateChunkKey) occupiedChunks[candidateChunkKey] = true;
    if (
      stringValue_(candidateValues[c][candidateHeaders.Status]).toLowerCase() === 'ready' &&
      stringValue_(candidateValues[c][candidateHeaders['Candidate Type']]).toLowerCase() === 'chunk' &&
      !selectedCandidateIds[candidateId]
    ) {
      readyCountAfterPromotion++;
      if (isPersonalCandidateOrigin_(
        candidateValues[c][candidateHeaders['Origin Type']]
      )) {
        personalReadyCountAfterPromotion++;
      }
    }
  }

  var gradeByPosition = {};
  snapshot.grades.forEach(function(grade) {
    if (grade.needsConfirmation) {
      throw new Error('Low-confidence grades must be confirmed before commit planning.');
    }
    gradeByPosition[Number(grade.position)] = grade;
  });
  var nextErrorNumber = maxIdSuffixInSheetV4_(
    requireSheet_(ss, 'Error Log'),
    'Error ID',
    'ERR-'
  );
  var queueDate = queue.dateKey;
  var reviewDate = parseDateKey_(queueDate);
  var items = [];
  queue.rows.forEach(function(queueItem) {
    var row = queueItem.values;
    var position = Number(row[queue.headers.Position]);
    var grade = gradeByPosition[position];
    if (!grade) return;
    var phraseId = stringValue_(row[queue.headers['Phrase ID']]);
    var candidateId = stringValue_(row[queue.headers['Candidate ID']]);
    var candidate = candidateId ? candidateById[candidateId] : null;
    var isNew = !phraseId;
    if (isNew) {
      if (!candidate) throw new Error('Selected Candidate is missing: ' + candidateId + '.');
      var candidateStatus = stringValue_(
        candidate.values[candidateHeaders.Status]
      ).toLowerCase();
      if (candidateStatus !== 'ready' && candidateStatus !== 'promoted') {
        throw new Error(
          'Selected Candidate is not ready for promotion: ' + candidateId +
          ' (' + candidateStatus + ').'
        );
      }
      var promotedId = stringValue_(candidate.values[candidateHeaders['Promoted Phrase ID']]);
      if (candidateStatus === 'promoted' && !promotedId) {
        throw new Error('Promoted Candidate is missing Phrase ID: ' + candidateId + '.');
      }
      if (promotedId) phraseId = promotedId;
      else {
        nextPhraseNumber++;
        phraseId = 'ENG-' + String(nextPhraseNumber).padStart(4, '0');
      }
    }
    var phrase = phraseById[phraseId] || null;
    if (!isNew && !phrase) throw new Error('Phrase Bank identity is missing: ' + phraseId + '.');
    if (phrase) {
      ['Last Reviewed', 'Times Seen', 'Times Correct'].forEach(function(formulaHeader) {
        var formula = phraseSheet.getRange(
          phrase.rowNumber,
          phraseHeaders[formulaHeader] + 1
        ).getFormula();
        if (!formula) {
          throw new Error(
            'Phrase Bank preflight found a missing formula: ' +
            phraseId + '/' + formulaHeader + '.'
          );
        }
      });
    }
    var currentStage = phrase
      ? Math.max(1, Number(phrase.values[phraseHeaders['Review Stage']]) || 1)
      : 1;
    var currentStreak = phrase
      ? Math.max(0, Number(phrase.values[phraseHeaders['Mastery Streak']]) || 0)
      : 0;
    var nextStage = nextReviewStageV4_(currentStage, grade.result);
    var nextStreak = grade.result === 'mastered' ? currentStreak + 1 : 0;
    var nextStatus = nextStreak >= 3 ? 'mastered' : 'active';
    var intervalDays = ER4_INTERVALS[nextStage - 1];
    var nextReview = new Date(reviewDate.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    var errorId = '';
    if (grade.result === 'forgotten' || grade.result === 'difficult') {
      nextErrorNumber++;
      errorId = 'ERR-' + String(nextErrorNumber).padStart(4, '0');
    }
    var chunk = stringValue_(row[queue.headers.Chunk]);
    var cue = stringValue_(row[queue.headers['中文提示']]);
    var topic = stringValue_(row[queue.headers.Topic]);
    var difficulty = stringValue_(row[queue.headers.Difficulty]);
    var example = stringValue_(row[queue.headers['Natural Example']]);
    var candidateValuesForPlan = candidate ? candidate.values : [];
    items.push({
      position: position,
      selectionType: stringValue_(row[queue.headers['Selection Type']]),
      originalPhraseId: stringValue_(row[queue.headers['Phrase ID']]),
      phraseId: phraseId,
      candidateId: candidateId,
      isNew: isNew,
      chunk: chunk,
      chineseCue: cue || (
        candidate ? stringValue_(candidateValuesForPlan[candidateHeaders['中文提示']]) : ''
      ),
      phraseType: candidate
        ? stringValue_(candidateValuesForPlan[candidateHeaders['Candidate Type']]) || 'chunk'
        : stringValue_(phrase.values[phraseHeaders.Type]),
      topic: topic || (
        candidate ? stringValue_(candidateValuesForPlan[candidateHeaders.Topic]) : ''
      ),
      difficulty: difficulty || (
        candidate ? stringValue_(candidateValuesForPlan[candidateHeaders.Difficulty]) : ''
      ),
      commonMistake: candidate
        ? stringValue_(candidateValuesForPlan[candidateHeaders['Common Mistake']])
        : stringValue_(phrase.values[phraseHeaders['Common Mistake']]),
      naturalExample: example || (
        candidate ? stringValue_(candidateValuesForPlan[candidateHeaders['Natural Example']]) : ''
      ),
      source: candidate
        ? stringValue_(candidateValuesForPlan[candidateHeaders.Source])
        : stringValue_(phrase.values[phraseHeaders.Source]),
      currentStage: currentStage,
      nextStage: nextStage,
      nextStreak: nextStreak,
      nextStatus: nextStatus,
      nextReview: formatDateKey_(nextReview),
      result: grade.result,
      answer: grade.answer,
      expectedAnswer: grade.expectedAnswer,
      feedbackZh: grade.feedbackZh,
      errorCategory: grade.errorCategory,
      confidence: grade.confidence,
      evidence: grade.evidence,
      questionType: grade.questionType,
      prompt: grade.prompt,
      errorId: errorId,
      attemptId: 'ATT-' + journal.sessionId + '-Q' + String(position).padStart(3, '0')
    });
  });

  var personalBacklogCount = countPersonalCandidateBacklogV4_(ss);
  var aiFallbackEligible = shouldGenerateAiFallbackV4_(
    personalReadyCountAfterPromotion,
    readyCountAfterPromotion,
    personalBacklogCount
  );
  var neededSuggestions = aiFallbackEligible
    ? Math.max(0, ER4.aiFallbackPoolTarget - readyCountAfterPromotion)
    : 0;
  var suggestionPlans = [];
  snapshot.candidateSuggestions.forEach(function(suggestion) {
    if (suggestionPlans.length >= neededSuggestions) return;
    var key = normalizeChunk_(suggestion.candidate);
    if (!key || occupiedChunks[key]) return;
    if (stringValue_(suggestion.candidateType).toLowerCase() !== 'chunk') return;
    occupiedChunks[key] = true;
    nextCandidateNumber++;
    suggestionPlans.push({
      candidateId: 'CAN-' + String(nextCandidateNumber).padStart(4, '0'),
      candidate: suggestion.candidate,
      candidateType: 'chunk',
      source: suggestion.source,
      context: suggestion.context,
      whyUseful: suggestion.whyUseful,
      chineseCue: suggestion.chineseCue,
      topic: suggestion.topic,
      difficulty: suggestion.difficulty,
      naturalExample: suggestion.naturalExample,
      commonMistake: suggestion.commonMistake
    });
  });
  var extraByKey = {};
  snapshot.extraPractices.forEach(function(practice) {
    extraByKey[practice.sourcePosition + ':' + practice.practiceType] = practice;
  });
  var extraPractices = [];
  items.forEach(function(item) {
    var isError = item.result === 'forgotten' || item.result === 'difficult';
    var reinforcement = extraByKey[item.position + ':reinforcement'];
    if (isError) {
      reinforcement = reinforcement || {
        promptZh: '【错误强化｜只填写完整目标词块】换一个情境，再写出能表达“' +
          item.chineseCue + '”的目标词块。',
        expectedAnswers: [item.expectedAnswer],
        acceptedVariants: [],
        referenceAnswer: item.expectedAnswer,
        contextSignature: 'server-fallback-' + item.position
      };
      extraPractices.push(buildExtraPracticePlanV4_(journal, item, reinforcement, 'reinforcement'));
    }
    var sentence = extraByKey[item.position + ':sentence_challenge'];
    if (item.result === 'mastered' && item.currentStage >= 6) {
      sentence = sentence || {
        promptZh: '【完整句挑战｜写一个完整英文句子】请用能表达“' + item.chineseCue +
          '”的目标词块，自拟一个与正式题不同的真实场景。',
        expectedAnswers: [item.expectedAnswer],
        acceptedVariants: [],
        referenceAnswer: item.naturalExample || item.expectedAnswer,
        contextSignature: 'server-fallback-sentence-' + item.position
      };
      extraPractices.push(buildExtraPracticePlanV4_(journal, item, sentence, 'sentence_challenge'));
    }
  });
  return {
    submissionId: journal.submissionId,
    sessionId: journal.sessionId,
    queueId: journal.queueId,
    answerHash: journal.answerHash,
    queueDate: queueDate,
    plannedCount: queue.plannedCount,
    adjustedTarget: queue.adjustedTarget,
    actualCount: items.length,
    requestedCount: readQuestionCountSettingsV4_(ss, queueDate).targetCount,
    completedBeforeBatch: completedQuestionsForDateV4_(ss, queueDate, journal.sessionId),
    presentedAt: queue.rows[0].values[queue.headers['Presented At']].toISOString(),
    committedAt: new Date().toISOString(),
    items: items,
    extraPractices: extraPractices,
    suggestionPlans: suggestionPlans,
    readyPoolBeforeSuggestions: readyCountAfterPromotion,
    personalReadyBeforeSuggestions: personalReadyCountAfterPromotion,
    personalBacklogCount: personalBacklogCount,
    aiFallbackEligible: aiFallbackEligible,
    aiFallbackNeeded: neededSuggestions,
    aiFallbackShortfall: Math.max(0, neededSuggestions - suggestionPlans.length),
    contractVersion: ER4.contractVersion
  };
}

function buildExtraPracticePlanV4_(journal, item, practice, practiceType) {
  return {
    practiceId: 'XP-' + journal.sessionId + '-Q' + String(item.position).padStart(3, '0') +
      (practiceType === 'reinforcement' ? '-R' : '-S'),
    sourcePosition: item.position,
    parentAttemptId: item.attemptId,
    practiceType: practiceType,
    phraseId: item.phraseId,
    promptZh: stringValue_(practice.promptZh),
    expectedAnswers: practice.expectedAnswers.map(stringValue_),
    acceptedVariants: practice.acceptedVariants.map(stringValue_),
    referenceAnswer: stringValue_(practice.referenceAnswer),
    contextSignature: stringValue_(practice.contextSignature),
    answerScope: practiceType === 'reinforcement' ? '完整目标词块' : '完整英文句子'
  };
}

function validateFrozenCommitPlanV4_(journal, snapshot, plan) {
  if (
    !plan ||
    plan.submissionId !== journal.submissionId ||
    plan.sessionId !== journal.sessionId ||
    plan.queueId !== journal.queueId ||
    plan.answerHash !== journal.answerHash ||
    plan.contractVersion !== ER4.contractVersion ||
    !Array.isArray(plan.items) ||
    !Array.isArray(snapshot.grades) ||
    plan.items.length !== snapshot.grades.length ||
    plan.items.length < 1 ||
    plan.items.length > Number(plan.plannedCount || ER4.maxBatchQuestionCount)
  ) {
    throw new Error('Frozen commit plan identity or cardinality mismatch.');
  }
  var positions = {};
  plan.items.forEach(function(item) {
    if (
      item.position < 1 ||
      item.position > Number(plan.plannedCount || ER4.maxBatchQuestionCount) ||
      positions[item.position] ||
      ER4_RESULTS.indexOf(item.result) === -1 ||
      !item.phraseId ||
      !item.attemptId
    ) {
      throw new Error('Frozen commit plan contains an invalid item.');
    }
    positions[item.position] = true;
  });
  if (
    !Array.isArray(snapshot.candidateSuggestions) ||
    !Array.isArray(plan.suggestionPlans) ||
    !Array.isArray(plan.extraPractices)
  ) {
    throw new Error('Frozen candidate replenishment plan is missing.');
  }
  var reinforcementParents = {};
  plan.extraPractices.forEach(function(practice) {
    if (!practice.practiceId || !practice.parentAttemptId || !practice.phraseId) {
      throw new Error('Frozen extra-practice plan is incomplete.');
    }
    if (practice.practiceType === 'reinforcement') {
      if (reinforcementParents[practice.parentAttemptId]) {
        throw new Error('Frozen plan contains duplicate error reinforcement.');
      }
      reinforcementParents[practice.parentAttemptId] = true;
    }
  });
  plan.items.forEach(function(item) {
    if (
      (item.result === 'forgotten' || item.result === 'difficult') &&
      !reinforcementParents[item.attemptId]
    ) {
      throw new Error('Frozen plan is missing error reinforcement at position ' + item.position + '.');
    }
  });
}

function nextReviewStageV4_(currentStage, result) {
  currentStage = Math.min(8, Math.max(1, Number(currentStage) || 1));
  if (result === 'forgotten') return 1;
  if (result === 'difficult') return Math.max(1, currentStage - 1);
  if (result === 'normal') return currentStage;
  if (result === 'mastered') return Math.min(8, currentStage + 1);
  throw new Error('Unsupported SRS result: ' + result + '.');
}

function numericSuffixV4_(value, prefix) {
  var text = stringValue_(value);
  if (text.indexOf(prefix) !== 0) return 0;
  var suffix = text.slice(prefix.length);
  return /^\d+$/.test(suffix) ? Number(suffix) : 0;
}

function maxIdSuffixInSheetV4_(sheet, header, prefix) {
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, [header], sheet.getName());
  var max = 0;
  for (var i = 1; i < values.length; i++) {
    max = Math.max(max, numericSuffixV4_(values[i][headers[header]], prefix));
  }
  return max;
}

function writeReviewLogV4_(ss, plan) {
  var sheet = requireSheet_(ss, 'Review Log');
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var required = [
    'Date', 'Session ID', 'Question #', 'Prompt', 'Expected Answer', 'User Answer',
    'Result', 'Tag', 'Follow-up Needed', 'Notes', 'Attempt ID', 'Attempt Type',
    'Parent Attempt ID', 'Question Type', 'Affects SRS?', 'Contract Version'
  ];
  requireHeaders_(headers, required, 'Review Log');
  var existingByAttempt = {};
  for (var i = 1; i < values.length; i++) {
    var attemptId = stringValue_(values[i][headers['Attempt ID']]);
    if (attemptId) existingByAttempt[attemptId] = values[i];
  }
  var rows = [];
  plan.items.forEach(function(item) {
    var existing = existingByAttempt[item.attemptId];
    if (existing) {
      if (
        stringValue_(existing[headers['Session ID']]) !== plan.sessionId ||
        stringValue_(existing[headers.Tag]) !== item.phraseId ||
        stringValue_(existing[headers.Result]).toLowerCase() !== item.result ||
        stringValue_(existing[headers['User Answer']]) !== item.answer
      ) {
        throw new Error('Existing Review Log row conflicts with ' + item.attemptId + '.');
      }
      return;
    }
    rows.push([
      parseDateKey_(plan.queueDate),
      plan.sessionId,
      item.position,
      item.prompt,
      item.expectedAnswer,
      item.answer,
      item.result,
      item.phraseId,
      item.result === 'forgotten' || item.result === 'difficult' ? 'yes' : 'no',
      [
        item.feedbackZh,
        item.errorCategory ? 'Category: ' + item.errorCategory + '.' : '',
        'AI confidence: ' + item.confidence + '.'
      ].filter(Boolean).join(' '),
      item.attemptId,
      'primary',
      '',
      item.questionType,
      'yes',
      ER4.contractVersion
    ]);
  });
  if (rows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, headers['Contract Version'] + 1, rows.length, 1)
      .setNumberFormat('@');
    sheet.getRange(startRow, 1, rows.length, required.length).setValues(rows);
    sheet.getRange(startRow, headers.Date + 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(startRow, headers['Contract Version'] + 1, rows.length, 1)
      .setValues(rows.map(function() { return [ER4.contractVersion]; }));
  }
  SpreadsheetApp.flush();
}

function writeErrorLogV4_(ss, plan) {
  var sheet = requireSheet_(ss, 'Error Log');
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var required = [
    'Date', 'Chunk', 'Error Type', 'User Answer', 'Correction', 'Explanation',
    'Next Action', 'Resolved?', 'Error ID', 'Phrase ID', 'Session ID',
    'Attempt ID', 'Resolution Date', 'Contract Version'
  ];
  requireHeaders_(headers, required, 'Error Log');
  var existingByAttempt = {};
  for (var i = 1; i < values.length; i++) {
    var attemptId = stringValue_(values[i][headers['Attempt ID']]);
    if (attemptId) existingByAttempt[attemptId] = values[i];
  }
  var rows = [];
  plan.items.forEach(function(item) {
    if (item.result !== 'forgotten' && item.result !== 'difficult') return;
    var existing = existingByAttempt[item.attemptId];
    if (existing) {
      if (
        stringValue_(existing[headers['Phrase ID']]) !== item.phraseId ||
        stringValue_(existing[headers['Error ID']]) !== item.errorId
      ) {
        throw new Error('Existing Error Log row conflicts with ' + item.attemptId + '.');
      }
      return;
    }
    rows.push([
      parseDateKey_(plan.queueDate),
      item.chunk,
      item.errorCategory || (item.result === 'forgotten' ? 'recall failure' : 'difficult recall'),
      item.answer,
      item.expectedAnswer,
      item.feedbackZh || item.evidence,
      'Review again on ' + item.nextReview + '.',
      'no',
      item.errorId,
      item.phraseId,
      plan.sessionId,
      item.attemptId,
      '',
      ER4.contractVersion
    ]);
  });
  if (rows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, headers['Contract Version'] + 1, rows.length, 1)
      .setNumberFormat('@');
    sheet.getRange(startRow, 1, rows.length, required.length).setValues(rows);
    sheet.getRange(startRow, headers.Date + 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(startRow, headers['Resolution Date'] + 1, rows.length, 1)
      .setNumberFormat('yyyy-mm-dd');
    sheet.getRange(startRow, headers['Contract Version'] + 1, rows.length, 1)
      .setValues(rows.map(function() { return [ER4.contractVersion]; }));
  }
  SpreadsheetApp.flush();
}

function writeCandidateBankV4_(ss, plan) {
  var sheet = requireSheet_(ss, DQ3.candidateSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var required = [
    'Candidate ID', 'Date Added', 'Candidate', 'Candidate Type', 'Source',
    'Context', 'Why Useful', 'Status', 'Promoted Phrase ID', 'Date Promoted',
    'Deferral Reason', 'Source Note Row', '中文提示', 'Topic', 'Difficulty',
    'Natural Example', 'Common Mistake'
  ];
  requireHeaders_(headers, required, DQ3.candidateSheet);
  var rowById = {};
  for (var i = 1; i < values.length; i++) {
    var id = stringValue_(values[i][headers['Candidate ID']]);
    if (id) rowById[id] = i + 1;
  }
  plan.items.forEach(function(item) {
    if (!item.candidateId) return;
    var rowNumber = rowById[item.candidateId];
    if (!rowNumber) throw new Error('Selected Candidate disappeared: ' + item.candidateId + '.');
    var currentStatus = stringValue_(sheet.getRange(rowNumber, headers.Status + 1).getValue())
      .toLowerCase();
    var currentPhraseId = stringValue_(
      sheet.getRange(rowNumber, headers['Promoted Phrase ID'] + 1).getValue()
    );
    if (currentStatus === 'promoted') {
      if (currentPhraseId !== item.phraseId) {
        throw new Error('Candidate promotion conflicts for ' + item.candidateId + '.');
      }
      return;
    }
    if (currentStatus !== 'ready') {
      throw new Error(
        'Selected Candidate is no longer ready: ' + item.candidateId +
        ' (' + currentStatus + ').'
      );
    }
    sheet.getRange(rowNumber, headers.Status + 1).setValue('promoted');
    sheet.getRange(rowNumber, headers['Promoted Phrase ID'] + 1).setValue(item.phraseId);
    sheet.getRange(rowNumber, headers['Date Promoted'] + 1)
      .setValue(parseDateKey_(plan.queueDate))
      .setNumberFormat('yyyy-mm-dd');
  });

  var rows = [];
  plan.suggestionPlans.forEach(function(suggestion) {
    var existingRow = rowById[suggestion.candidateId];
    if (existingRow) {
      var existingChunk = stringValue_(
        sheet.getRange(existingRow, headers.Candidate + 1).getValue()
      );
      if (normalizeChunk_(existingChunk) !== normalizeChunk_(suggestion.candidate)) {
        throw new Error('Candidate suggestion ID conflict: ' + suggestion.candidateId + '.');
      }
      return;
    }
    rows.push([
      suggestion.candidateId,
      parseDateKey_(plan.queueDate),
      suggestion.candidate,
      'chunk',
      suggestion.source,
      suggestion.context,
      suggestion.whyUseful,
      'ready',
      '',
      '',
      '',
      '',
      suggestion.chineseCue,
      suggestion.topic,
      suggestion.difficulty,
      suggestion.naturalExample,
      suggestion.commonMistake,
      'ai_fallback',
      '',
      '',
      '',
      'fallback'
    ]);
  });
  if (rows.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, required.length).setValues(rows);
    sheet.getRange(startRow, headers['Date Added'] + 1, rows.length, 1)
      .setNumberFormat('yyyy-mm-dd');
  }
  SpreadsheetApp.flush();
}

function writePhraseBankV4_(ss, plan) {
  var sheet = requireSheet_(ss, DQ3.phraseSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var required = [
    'ID', 'Chunk', '中文提示', 'Type', 'Topic', 'Difficulty', 'Status',
    'Review Stage', 'Last Reviewed', 'Next Review', 'Times Seen', 'Times Correct',
    'Common Mistake', 'Natural Example', 'Notes', 'Source', 'Created Date',
    'Source Candidate ID', 'Mastery Streak', 'Last Result', 'Contract Version',
    'Canonical Pattern'
  ];
  requireHeaders_(headers, required, DQ3.phraseSheet);
  var rowById = {};
  for (var i = 1; i < values.length; i++) {
    var id = stringValue_(values[i][headers.ID]);
    if (id) rowById[id] = i + 1;
  }
  plan.items.forEach(function(item) {
    var rowNumber = rowById[item.phraseId];
    if (!rowNumber) {
      rowNumber = sheet.getLastRow() + 1;
      if (rowNumber > 2) {
        sheet.getRange(rowNumber - 1, 1, 1, required.length).copyTo(
          sheet.getRange(rowNumber, 1, 1, required.length),
          SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
          false
        );
        sheet.getRange(rowNumber - 1, 1, 1, required.length).copyTo(
          sheet.getRange(rowNumber, 1, 1, required.length),
          SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
          false
        );
      }
      var newRow = [
        item.phraseId,
        item.chunk,
        item.chineseCue,
        item.phraseType || 'chunk',
        item.topic,
        item.difficulty,
        item.nextStatus,
        item.nextStage,
        '',
        parseDateKey_(item.nextReview),
        '',
        '',
        item.commonMistake,
        item.naturalExample,
        commitNoteV4_(plan, item),
        item.source || 'Candidate Bank',
        parseDateKey_(plan.queueDate),
        item.candidateId,
        item.nextStreak,
        item.result,
        ER4.contractVersion,
        item.chunk
      ];
      sheet.getRange(rowNumber, 1, 1, required.length).setValues([newRow]);
      sheet.getRange(rowNumber, headers['Last Reviewed'] + 1)
        .setFormula(
          '=IFERROR(MAX(FILTER(\'Review Log\'!$A$2:$A,\'Review Log\'!$H$2:$H=$A' +
          rowNumber + ',\'Review Log\'!$O$2:$O="yes")),"")'
        );
      sheet.getRange(rowNumber, headers['Times Seen'] + 1)
        .setFormula(
          '=COUNTIFS(\'Review Log\'!$H$2:$H,$A' + rowNumber +
          ',\'Review Log\'!$O$2:$O,"yes")'
        );
      sheet.getRange(rowNumber, headers['Times Correct'] + 1)
        .setFormula(
          '=COUNTIFS(\'Review Log\'!$H$2:$H,$A' + rowNumber +
          ',\'Review Log\'!$G$2:$G,"normal",\'Review Log\'!$O$2:$O,"yes")+' +
          'COUNTIFS(\'Review Log\'!$H$2:$H,$A' + rowNumber +
          ',\'Review Log\'!$G$2:$G,"mastered",\'Review Log\'!$O$2:$O,"yes")'
        );
      rowById[item.phraseId] = rowNumber;
    } else {
      var existingSourceCandidate = stringValue_(
        sheet.getRange(rowNumber, headers['Source Candidate ID'] + 1).getValue()
      );
      if (item.isNew && existingSourceCandidate && existingSourceCandidate !== item.candidateId) {
        throw new Error('Phrase ID source conflict for ' + item.phraseId + '.');
      }
      sheet.getRange(rowNumber, headers.Status + 1).setValue(item.nextStatus);
      sheet.getRange(rowNumber, headers['Review Stage'] + 1).setValue(item.nextStage);
      sheet.getRange(rowNumber, headers['Next Review'] + 1)
        .setValue(parseDateKey_(item.nextReview))
        .setNumberFormat('yyyy-mm-dd');
      sheet.getRange(rowNumber, headers.Notes + 1).setValue(
        appendNoteV4_(
          stringValue_(sheet.getRange(rowNumber, headers.Notes + 1).getValue()),
          commitNoteV4_(plan, item)
        )
      );
      if (item.isNew && !existingSourceCandidate) {
        sheet.getRange(rowNumber, headers['Source Candidate ID'] + 1).setValue(item.candidateId);
      }
      sheet.getRange(rowNumber, headers['Mastery Streak'] + 1).setValue(item.nextStreak);
      sheet.getRange(rowNumber, headers['Last Result'] + 1).setValue(item.result);
      sheet.getRange(rowNumber, headers['Contract Version'] + 1)
        .setNumberFormat('@')
        .setValue(ER4.contractVersion);
    }
    sheet.getRange(rowNumber, headers['Next Review'] + 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(rowNumber, headers['Created Date'] + 1).setNumberFormat('yyyy-mm-dd');
  });
  SpreadsheetApp.flush();
}

function commitNoteV4_(plan, item) {
  return (
    plan.queueDate + ' v4 primary result: ' + item.result +
    '; stage ' + item.nextStage +
    '; next review ' + item.nextReview +
    '; verified Apps Script commit.'
  );
}

function appendNoteV4_(existing, addition) {
  existing = stringValue_(existing);
  if (!existing) return addition;
  if (existing.indexOf(addition) !== -1) return existing;
  return existing + ' ' + addition;
}

function writeDailyQueueCommitV4_(ss, plan) {
  var queue = findQueueBySessionV4_(ss, plan.sessionId);
  if (!queue || queue.rows.length !== queue.plannedCount) {
    throw new Error('Daily Queue disappeared before commit.');
  }
  if (queue.queueId !== plan.queueId) throw new Error('Daily Queue ID changed before commit.');
  var itemByPosition = {};
  plan.items.forEach(function(item) { itemByPosition[item.position] = item; });
  queue.rows.forEach(function(rowItem) {
    var position = Number(rowItem.values[queue.headers.Position]);
    var item = itemByPosition[position];
    var currentStatus = stringValue_(
      queue.sheet.getRange(rowItem.rowNumber, queue.headers['Queue Status'] + 1).getValue()
    ).toLowerCase();
    if (!item) {
      if (currentStatus !== 'presented' && currentStatus !== 'deferred') {
        throw new Error('Unused Daily Queue row cannot be deferred from ' + currentStatus + '.');
      }
      queue.sheet.getRange(rowItem.rowNumber, queue.headers['Queue Status'] + 1).setValue('deferred');
      queue.sheet.getRange(rowItem.rowNumber, queue.headers['Session ID'] + 1).setValue(plan.sessionId);
      queue.sheet.getRange(rowItem.rowNumber, queue.headers['Committed At'] + 1)
        .setValue(new Date(plan.committedAt))
        .setNumberFormat('yyyy-mm-dd hh:mm:ss');
      queue.sheet.getRange(rowItem.rowNumber, queue.headers['Change Reason'] + 1)
        .setValue('not attempted when this session was closed');
      return;
    }
    if (currentStatus !== 'presented' && currentStatus !== 'committed') {
      throw new Error('Daily Queue status cannot be committed from ' + currentStatus + '.');
    }
    queue.sheet.getRange(rowItem.rowNumber, queue.headers['Phrase ID'] + 1).setValue(item.phraseId);
    queue.sheet.getRange(rowItem.rowNumber, queue.headers['Queue Status'] + 1).setValue('committed');
    queue.sheet.getRange(rowItem.rowNumber, queue.headers['Session ID'] + 1).setValue(plan.sessionId);
    queue.sheet.getRange(rowItem.rowNumber, queue.headers['Committed At'] + 1)
      .setValue(new Date(plan.committedAt))
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    queue.sheet.getRange(rowItem.rowNumber, queue.headers['Contract Version'] + 1)
      .setNumberFormat('@')
      .setValue(ER4.contractVersion);
  });
  var questionSheet = requireSheet_(ss, ER4.questionSheet);
  var questionValues = questionSheet.getDataRange().getValues();
  var questionHeaders = headerMap_(questionValues[0]);
  for (var q = 1; q < questionValues.length; q++) {
    var questionPosition = Number(questionValues[q][questionHeaders.Position]);
    if (
      stringValue_(questionValues[q][questionHeaders['Session ID']]) === plan.sessionId &&
      !itemByPosition[questionPosition] &&
      stringValue_(questionValues[q][questionHeaders['Question Status']]).toLowerCase() === 'bound'
    ) {
      questionSheet.getRange(q + 1, questionHeaders['Question Status'] + 1).setValue('deferred');
    }
  }
  var draftSheet = requireSheet_(ss, ER4.draftSheet);
  var draftValues = draftSheet.getDataRange().getValues();
  var draftHeaders = headerMap_(draftValues[0]);
  for (var d = 1; d < draftValues.length; d++) {
    var draftPosition = Number(draftValues[d][draftHeaders.Position]);
    if (
      stringValue_(draftValues[d][draftHeaders['Session ID']]) === plan.sessionId &&
      !itemByPosition[draftPosition] &&
      stringValue_(draftValues[d][draftHeaders['Submit Status']]).toLowerCase() === 'draft'
    ) {
      draftSheet.getRange(d + 1, draftHeaders['Submit Status'] + 1).setValue('deferred');
    }
  }
  SpreadsheetApp.flush();
}

function writeSessionLogV4_(ss, plan) {
  var sheet = requireSheet_(ss, 'Session Log');
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var required = [
    'Session ID', 'Date', 'Scheduled Start', 'Actual Start', 'Max Questions',
    'Questions Logged', 'Unique Chunks', 'New Active Chunks',
    'Database Write Status', 'Readback Status', 'Contract Version', 'Notes'
  ];
  requireHeaders_(headers, required, 'Session Log');
  var sessionTarget = plan.adjustedTarget === undefined
    ? plan.items.length
    : Number(plan.adjustedTarget);
  var existingRows = [];
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][headers['Session ID']]) === plan.sessionId) {
      existingRows.push(values[i]);
    }
  }
  if (existingRows.length > 1) throw new Error('Session Log contains duplicate Session IDs.');
  if (existingRows.length === 1) {
    var existing = existingRows[0];
    if (
      Number(existing[headers['Max Questions']]) !== sessionTarget ||
      Number(existing[headers['Questions Logged']]) !== plan.items.length ||
      stringValue_(existing[headers['Database Write Status']]) !== 'verified' ||
      stringValue_(existing[headers['Readback Status']]) !== 'verified' ||
      stringValue_(existing[headers['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('Existing Session Log row conflicts with the verified v4 commit.');
    }
    return;
  }
  var newCount = plan.items.filter(function(item) {
    return item.selectionType === 'new';
  }).length;
  sheet.appendRow([
    plan.sessionId,
    parseDateKey_(plan.queueDate),
    9 / 24,
    new Date(plan.presentedAt),
    sessionTarget,
    plan.items.length,
    plan.items.length,
    newCount,
    'verified',
    'verified',
    ER4.contractVersion,
    'v4 Web App submission; requested daily count=' + plan.requestedCount +
    '; batch planned=' + plan.plannedCount +
    '; adjusted session target=' + sessionTarget +
    '; actual completed=' + plan.items.length +
    '; ChatGPT staged grading; deterministic Apps Script commit; unused Queue rows were deferred without SRS changes.'
  ]);
  var rowNumber = sheet.getLastRow();
  sheet.getRange(rowNumber, headers.Date + 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(rowNumber, headers['Scheduled Start'] + 1).setNumberFormat('hh:mm');
  sheet.getRange(rowNumber, headers['Actual Start'] + 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(rowNumber, headers['Contract Version'] + 1)
    .setNumberFormat('@')
    .setValue(ER4.contractVersion);
  SpreadsheetApp.flush();
}

function verifyFormalWritesV4_(ss, plan, includeSessionLog) {
  verifyReviewLogV4_(ss, plan);
  verifyErrorLogV4_(ss, plan);
  verifyCandidateBankV4_(ss, plan);
  verifyPhraseBankV4_(ss, plan);
  verifyDailyQueueV4_(ss, plan);
  if (includeSessionLog) verifySessionLogV4_(ss, plan);
  return buildCommittedResultV4_(plan);
}

function verifyReviewLogV4_(ss, plan) {
  var sheet = requireSheet_(ss, 'Review Log');
  var values = sheet.getDataRange().getValues();
  var h = headerMap_(values[0]);
  var byAttempt = {};
  for (var i = 1; i < values.length; i++) {
    var attemptId = stringValue_(values[i][h['Attempt ID']]);
    if (attemptId && plan.items.some(function(item) { return item.attemptId === attemptId; })) {
      if (byAttempt[attemptId]) throw new Error('Duplicate Review Log Attempt ID: ' + attemptId + '.');
      byAttempt[attemptId] = values[i];
    }
  }
  plan.items.forEach(function(item) {
    var row = byAttempt[item.attemptId];
    if (
      !row ||
      stringValue_(row[h['Session ID']]) !== plan.sessionId ||
      Number(row[h['Question #']]) !== item.position ||
      stringValue_(row[h.Tag]) !== item.phraseId ||
      stringValue_(row[h.Result]).toLowerCase() !== item.result ||
      stringValue_(row[h['User Answer']]) !== item.answer ||
      stringValue_(row[h['Affects SRS?']]).toLowerCase() !== 'yes' ||
      stringValue_(row[h['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('Review Log readback failed at position ' + item.position + '.');
    }
  });
}

function verifyErrorLogV4_(ss, plan) {
  var expected = plan.items.filter(function(item) {
    return item.result === 'forgotten' || item.result === 'difficult';
  });
  var sheet = requireSheet_(ss, 'Error Log');
  var values = sheet.getDataRange().getValues();
  var h = headerMap_(values[0]);
  var byAttempt = {};
  for (var i = 1; i < values.length; i++) {
    var attemptId = stringValue_(values[i][h['Attempt ID']]);
    if (attemptId && expected.some(function(item) { return item.attemptId === attemptId; })) {
      if (byAttempt[attemptId]) throw new Error('Duplicate Error Log Attempt ID: ' + attemptId + '.');
      byAttempt[attemptId] = values[i];
    }
  }
  expected.forEach(function(item) {
    var row = byAttempt[item.attemptId];
    if (
      !row ||
      stringValue_(row[h['Error ID']]) !== item.errorId ||
      stringValue_(row[h['Phrase ID']]) !== item.phraseId ||
      stringValue_(row[h['Session ID']]) !== plan.sessionId ||
      stringValue_(row[h['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('Error Log readback failed at position ' + item.position + '.');
    }
  });
}

function verifyCandidateBankV4_(ss, plan) {
  var sheet = requireSheet_(ss, DQ3.candidateSheet);
  var values = sheet.getDataRange().getValues();
  var h = headerMap_(values[0]);
  var byId = {};
  for (var i = 1; i < values.length; i++) {
    var id = stringValue_(values[i][h['Candidate ID']]);
    if (id) byId[id] = values[i];
  }
  plan.items.forEach(function(item) {
    if (!item.candidateId) return;
    var row = byId[item.candidateId];
    if (
      !row ||
      stringValue_(row[h.Status]).toLowerCase() !== 'promoted' ||
      stringValue_(row[h['Promoted Phrase ID']]) !== item.phraseId
    ) {
      throw new Error('Candidate promotion readback failed: ' + item.candidateId + '.');
    }
  });
  plan.suggestionPlans.forEach(function(suggestion) {
    var row = byId[suggestion.candidateId];
    if (
      !row ||
      normalizeChunk_(row[h.Candidate]) !== normalizeChunk_(suggestion.candidate) ||
      stringValue_(row[h.Status]).toLowerCase() !== 'ready' ||
      normalizedCandidateOriginType_(row[h['Origin Type']]) !== 'ai_fallback' ||
      stringValue_(row[h['Intake Priority']]).toLowerCase() !== 'fallback'
    ) {
      throw new Error('AI fallback Candidate readback failed: ' + suggestion.candidateId + '.');
    }
  });
}

function verifyPhraseBankV4_(ss, plan) {
  var sheet = requireSheet_(ss, DQ3.phraseSheet);
  var values = sheet.getDataRange().getValues();
  var h = headerMap_(values[0]);
  var byId = {};
  for (var i = 1; i < values.length; i++) {
    var id = stringValue_(values[i][h.ID]);
    if (id) byId[id] = { rowNumber: i + 1, values: values[i] };
  }
  plan.items.forEach(function(item) {
    var found = byId[item.phraseId];
    if (
      !found ||
      Number(found.values[h['Review Stage']]) !== item.nextStage ||
      Number(found.values[h['Mastery Streak']]) !== item.nextStreak ||
      stringValue_(found.values[h.Status]).toLowerCase() !== item.nextStatus ||
      stringValue_(found.values[h['Last Result']]).toLowerCase() !== item.result ||
      formatDateKey_(found.values[h['Next Review']]) !== item.nextReview ||
      stringValue_(found.values[h['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('Phrase Bank state readback failed: ' + item.phraseId + '.');
    }
    ['Last Reviewed', 'Times Seen', 'Times Correct'].forEach(function(header) {
      var formula = sheet.getRange(found.rowNumber, h[header] + 1).getFormula();
      if (!formula) throw new Error('Phrase Bank formula is missing: ' + item.phraseId + '/' + header + '.');
    });
  });
}

function verifyDailyQueueV4_(ss, plan) {
  var queue = findQueueBySessionV4_(ss, plan.sessionId);
  if (
    !queue ||
    queue.queueId !== plan.queueId ||
    queue.status !== 'committed' ||
    queue.rows.length !== queue.plannedCount
  ) {
    throw new Error('Daily Queue commit readback failed.');
  }
  var byPosition = {};
  plan.items.forEach(function(item) { byPosition[item.position] = item; });
  var presented = [];
  queue.rows.forEach(function(rowItem) {
    var position = Number(rowItem.values[queue.headers.Position]);
    var item = byPosition[position];
    var rowStatus = stringValue_(rowItem.values[queue.headers['Queue Status']]).toLowerCase();
    if (item) {
      if (
        rowStatus !== 'committed' ||
        stringValue_(rowItem.values[queue.headers['Phrase ID']]) !== item.phraseId ||
        !isDateValue_(rowItem.values[queue.headers['Committed At']]) ||
        stringValue_(rowItem.values[queue.headers['Contract Version']]) !== ER4.contractVersion
      ) {
        throw new Error('Daily Queue committed-row readback failed at position ' + position + '.');
      }
    } else if (
      rowStatus !== 'deferred' ||
      !isDateValue_(rowItem.values[queue.headers['Committed At']]) ||
      stringValue_(rowItem.values[queue.headers['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('Daily Queue deferred-row readback failed at position ' + position + '.');
    }
    presented.push(rowItem.values[queue.headers['Presented At']]);
  });
  var presentedKeys = uniqueDateTimesV4_(presented);
  if (
    presentedKeys.length !== 1 ||
    !isDateValue_(presented[0]) ||
    presented[0].getTime() !== new Date(plan.presentedAt).getTime()
  ) {
    throw new Error('Daily Queue Presented At changed during commit.');
  }
}

function verifySessionLogV4_(ss, plan) {
  var sheet = requireSheet_(ss, 'Session Log');
  var values = sheet.getDataRange().getValues();
  var h = headerMap_(values[0]);
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][h['Session ID']]) === plan.sessionId) matches.push(values[i]);
  }
  if (matches.length !== 1) throw new Error('Session Log readback requires exactly one row.');
  var row = matches[0];
  var sessionTarget = plan.adjustedTarget === undefined
    ? plan.items.length
    : Number(plan.adjustedTarget);
  if (
    Number(row[h['Max Questions']]) !== sessionTarget ||
    Number(row[h['Questions Logged']]) !== plan.items.length ||
    Number(row[h['Unique Chunks']]) !== plan.items.length ||
    stringValue_(row[h['Database Write Status']]) !== 'verified' ||
    stringValue_(row[h['Readback Status']]) !== 'verified' ||
    stringValue_(row[h['Contract Version']]) !== ER4.contractVersion ||
    !isDateValue_(row[h['Actual Start']]) ||
    row[h['Actual Start']].getTime() !== new Date(plan.presentedAt).getTime()
  ) {
    throw new Error('Session Log exact readback failed.');
  }
}

function buildCommittedResultV4_(plan) {
  var counts = { forgotten: 0, difficult: 0, normal: 0, mastered: 0 };
  plan.items.forEach(function(item) { counts[item.result]++; });
  return {
    sessionId: plan.sessionId,
    queueId: plan.queueId,
    committedAt: formatDateTimeV4_(new Date(plan.committedAt)),
    requestedCount: Number(plan.requestedCount || plan.items.length),
    plannedCount: Number(plan.plannedCount || plan.items.length),
    adjustedTarget: Number(
      plan.adjustedTarget === undefined ? plan.items.length : plan.adjustedTarget
    ),
    actualCount: plan.items.length,
    completedBeforeBatch: Number(plan.completedBeforeBatch || 0),
    completedToday: Number(plan.completedBeforeBatch || 0) + plan.items.length,
    counts: counts,
    dueCount: plan.items.filter(function(item) {
      return item.selectionType !== 'new';
    }).length,
    newCount: plan.items.filter(function(item) {
      return item.selectionType === 'new';
    }).length,
    aiFallbackCandidateCount: plan.suggestionPlans.length,
    personalReadyCandidateCount: plan.personalReadyBeforeSuggestions,
    personalIntakeBacklogCount: plan.personalBacklogCount,
    aiFallbackShortfall: plan.aiFallbackShortfall,
    extraPractices: plan.extraPractices.map(function(practice) {
      return {
        practiceId: practice.practiceId,
        sourcePosition: practice.sourcePosition,
        practiceType: practice.practiceType,
        phraseId: practice.phraseId,
        promptZh: practice.promptZh,
        answerScope: practice.answerScope,
        status: 'pending'
      };
    }),
    items: plan.items.map(function(item) {
      return {
        position: item.position,
        selectionType: item.selectionType,
        phraseId: item.phraseId,
        chunk: item.chunk,
        prompt: item.prompt,
        answer: item.answer,
        expectedAnswer: item.expectedAnswer,
        result: item.result,
        feedbackZh: item.feedbackZh,
        nextReview: item.nextReview
      };
    })
  };
}

/**
 * Read-only learning analytics for the Web App Dashboard.
 *
 * Formal learning outcomes come from Review Log / Error Log / Phrase Bank.
 * Staging sheets are used only for pipeline diagnostics and are never counted
 * as completed learning activity.
 */
