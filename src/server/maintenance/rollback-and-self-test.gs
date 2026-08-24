
function rollbackReviewWebAppV4ToV3() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var active = findActiveV4SessionsForRollback_(ss);
    if (active.length) {
      throw new Error(
        'Rollback blocked by active v4 Session(s): ' + active.slice(0, 5).join(', ') +
        '. Finish or resolve them before rollback.'
      );
    }
    PropertiesService.getScriptProperties().setProperty(ER4.enabledProperty, 'no');
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (
        trigger.getHandlerFunction() === ER4.queueTrigger ||
        trigger.getHandlerFunction() === ER4.gradeTrigger ||
        trigger.getHandlerFunction() === DQ3.triggerHandler
      ) {
        ScriptApp.deleteTrigger(trigger);
      }
    });

    var queueSheet = requireSheet_(ss, DQ3.queueSheet);
    var queueValues = queueSheet.getDataRange().getValues();
    var queueHeaders = headerMap_(queueValues[0]);
    for (var q = 1; q < queueValues.length; q++) {
      if (
        stringValue_(queueValues[q][queueHeaders['Contract Version']]) === ER4.contractVersion &&
        stringValue_(queueValues[q][queueHeaders['Queue Status']]).toLowerCase() === 'planned'
      ) {
        queueSheet.getRange(q + 1, queueHeaders['Contract Version'] + 1)
          .setNumberFormat('@')
          .setValue(DQ3.contractVersion);
      }
    }
    restoreV3ContractSheetsFromBaselineV4_(ss);
    installDailyQueueTrigger_();
    SpreadsheetApp.flush();

    var configVersion = readConfigValueV4_(ss, 'contract_version');
    var handlers = ScriptApp.getProjectTriggers().map(function(trigger) {
      return trigger.getHandlerFunction();
    });
    if (
      configVersion !== DQ3.contractVersion ||
      handlers.indexOf(DQ3.triggerHandler) === -1 ||
      handlers.indexOf(ER4.queueTrigger) !== -1 ||
      handlers.indexOf(ER4.gradeTrigger) !== -1
    ) {
      throw new Error('v3 rollback readback failed.');
    }
    return {
      ok: true,
      contractVersion: configVersion,
      triggerHandlers: handlers,
      webAppEnabled: false,
      preservedCommittedHistory: true,
      nextExternalStep: 'Restore the ChatGPT scheduled task prompt from archive/prompts/DailyTaskPrompt_v3.txt.'
    };
  } finally {
    lock.releaseLock();
  }
}

function findActiveV4SessionsForRollback_(ss) {
  var active = {};
  var queueSheet = requireSheet_(ss, DQ3.queueSheet);
  var queueValues = queueSheet.getDataRange().getValues();
  var qh = headerMap_(queueValues[0]);
  for (var i = 1; i < queueValues.length; i++) {
    if (
      stringValue_(queueValues[i][qh['Contract Version']]) === ER4.contractVersion &&
      stringValue_(queueValues[i][qh['Queue Status']]).toLowerCase() === 'presented'
    ) {
      active[stringValue_(queueValues[i][qh['Session ID']]) || 'presented_queue_without_session'] = true;
    }
  }
  var journalSheet = ss.getSheetByName(ER4.journalSheet);
  if (journalSheet && journalSheet.getLastRow() > 1) {
    var journalValues = journalSheet.getDataRange().getValues();
    var jh = headerMap_(journalValues[0]);
    for (var j = 1; j < journalValues.length; j++) {
      var status = stringValue_(journalValues[j][jh.Status]).toLowerCase();
      if (
        stringValue_(journalValues[j][jh['Contract Version']]) === ER4.contractVersion &&
        status !== 'committed'
      ) {
        active[stringValue_(journalValues[j][jh['Session ID']]) || 'journal_without_session'] = true;
      }
    }
  }
  return Object.keys(active);
}

function restoreV3ContractSheetsFromBaselineV4_(ss) {
  var baseline = SpreadsheetApp.openById('YOUR_BASELINE_SPREADSHEET_ID');
  ['Config', 'README'].forEach(function(name) {
    var source = requireSheet_(baseline, name);
    var target = requireSheet_(ss, name);
    var sourceValues = source.getDataRange().getValues();
    if (target.getMaxRows() < sourceValues.length) {
      target.insertRowsAfter(target.getMaxRows(), sourceValues.length - target.getMaxRows());
    }
    if (target.getMaxColumns() < sourceValues[0].length) {
      target.insertColumnsAfter(
        target.getMaxColumns(),
        sourceValues[0].length - target.getMaxColumns()
      );
    }
    target.getDataRange().clearContent();
    target.getRange(1, 1, sourceValues.length, sourceValues[0].length).setValues(sourceValues);
  });
  updateConfigV3_(ss);
  updateReadmeV3_(ss);
}

function readConfigValueV4_(ss, key) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][0]) === key) {
      var value = values[i][1];
      // Google Sheets returns a date-formatted cell as a Date object even when
      // the user sees yyyy-mm-dd. Normalize it before comparing with dateKey.
      return isDateValue_(value) ? formatDateKey_(value) : stringValue_(value);
    }
  }
  return '';
}

function previewReviewWebAppV4Setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queuePlan;
  try {
    queuePlan = previewTomorrowDailyQueueV4();
  } catch (error) {
    queuePlan = { ok: false, error: error.message };
  }
  return {
    setup: verifyReviewWebAppV4Setup_(),
    readyCandidateCount: countReadyCandidates_(ss),
    tomorrowQueue: queuePlan,
    activeRollbackBlockers: findActiveV4SessionsForRollback_(ss)
  };
}

function selfTestReviewWebAppV4() {
  var failures = [];
  var testCount = 0;
  function expect(label, actual, expected) {
    testCount++;
    if (actual !== expected) {
      failures.push(label + ': expected ' + expected + ', found ' + actual);
    }
  }
  expect('forgotten resets', nextReviewStageV4_(6, 'forgotten'), 1);
  expect('difficult decrements', nextReviewStageV4_(6, 'difficult'), 5);
  expect('difficult floors', nextReviewStageV4_(1, 'difficult'), 1);
  expect('normal stays', nextReviewStageV4_(4, 'normal'), 4);
  expect('mastered increments', nextReviewStageV4_(4, 'mastered'), 5);
  expect('mastered caps', nextReviewStageV4_(8, 'mastered'), 8);
  expect('id parse', numericSuffixV4_('ENG-0123', 'ENG-'), 123);
  expect('id prefix reject', numericSuffixV4_('CAN-0123', 'ENG-'), 0);
  var normalized = normalizeAnswerBatchV4_(
    [
      { position: 7, answer: 'answer 7' },
      { position: 1, answer: 'answer 1' },
      { position: 3, answer: 'answer 3' }
    ],
    20
  );
  expect('partial answer cardinality', normalized.length, 3);
  expect('partial answer positions sort', normalized.map(function(item) {
    return item.position;
  }).join(','), '1,3,7');
  expect('hash deterministic', hashV4_(normalized), hashV4_(normalized));
  expect('daily minimum accepted', normalizeDailyQuestionCountV4_(1, 20), 1);
  expect('daily maximum accepted', normalizeDailyQuestionCountV4_(150, 20), 150);
  expect('daily-set maximum accepted', normalizeQuestionCount_(150, 20), 150);
  var activeTwenty = selectActiveQuestionPositionsV4_(
    Array.from({ length: 40 }, function(_, index) { return index + 1; }),
    20,
    []
  );
  expect('lower target selects twenty active positions', activeTwenty.count, 20);
  expect('lower target excludes retained position 40', Boolean(activeTwenty.byPosition[40]), false);
  var activeWithLockedTail = selectActiveQuestionPositionsV4_(
    Array.from({ length: 40 }, function(_, index) { return index + 1; }),
    20,
    [40]
  );
  expect('locked tail remains active after lowering', Boolean(activeWithLockedTail.byPosition[40]), true);
  expect('locked tail does not increase target cardinality', activeWithLockedTail.count, 20);
  var compositionHeaders = { 'Queue Status': 0, 'Selection Type': 1 };
  var compositionQueue = {
    status: 'presented',
    headers: compositionHeaders,
    rows: Array.from({ length: 40 }, function(_, index) {
      return {
        values: [index < 25 ? 'presented' : 'deferred', index < 23 ? 'due_today' : 'new']
      };
    })
  };
  var activeComposition = activeQueueCompositionV4_(compositionQueue);
  expect('lowered set counts only active due rows', activeComposition.due, 23);
  expect('lowered set counts only active new rows', activeComposition.fresh, 2);
  var revealDraft = {
    position: 3,
    answer: 'the stored answer',
    submitStatus: 'draft',
    submissionId: '',
    answerHash: revealedDraftHashV4_('SESSION-1', 3, 'the stored answer')
  };
  expect('reveal lock validates', isDraftRevealedV4_(revealDraft, 'SESSION-1'), true);
  revealDraft.answer = 'changed after reveal';
  expect('reveal lock rejects edits', isDraftRevealedV4_(revealDraft, 'SESSION-1'), false);
  expect('submitted answer remains protected', isProtectedDraftV4_({
    position: 3,
    answer: 'submitted answer',
    submitStatus: 'submitted',
    submissionId: 'SUBMISSION-1',
    answerHash: 'batch-hash'
  }, 'SESSION-1'), true);
  expect('personal origin precedes fallback', candidateOriginRank_('user_context') < candidateOriginRank_('ai_fallback'), true);
  expect('learning evidence precedes legacy', candidateOriginRank_('learning_evidence') < candidateOriginRank_('legacy'), true);
  expect('fallback blocked by personal inventory', shouldGenerateAiFallbackV4_(1, 1, 0), false);
  expect('fallback blocked by personal backlog', shouldGenerateAiFallbackV4_(0, 0, 1), false);
  expect('fixed fallback reserve disabled', shouldGenerateAiFallbackV4_(0, 0, 0), false);
  expect('fallback not duplicated above target', shouldGenerateAiFallbackV4_(0, 20, 0), false);
  if (failures.length) throw new Error('v4 self-test failed: ' + failures.join('; '));
  return { ok: true, tests: testCount, contractVersion: ER4.contractVersion };
}
