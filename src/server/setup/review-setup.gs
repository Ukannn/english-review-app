
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  ensureAdaptiveQuestionEngineSchemaV4_(ss);
  var output = HtmlService.createTemplateFromFile('ReviewApp');
  output.demoMode = Boolean(e && e.parameter && e.parameter.demo === '1');
  var requestedView = e && e.parameter ? stringValue_(e.parameter.view).toLowerCase() : '';
  output.initialView = ['today', 'intake', 'analytics', 'phrases', 'settings'].indexOf(requestedView) === -1
    ? 'today'
    : requestedView;
  return output.evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setTitle('英语搭配复习')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function setupReviewWebAppV4() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertNoUnsafePresentedQueueV4_(ss);
    ensureCandidateMetadataColumns_(ss);
    ensureDailyQueueSheet_(ss);
    ensureDynamicQuestionCountSchemaV4_(ss);
    ensureV4DataSurfaces_(ss);
    formatContractVersionColumnsV4_(ss);
    updateConfigV4_(ss);
    updateReadmeV4_(ss);
    installV4Triggers_();

    var properties = PropertiesService.getScriptProperties();
    properties.setProperty(ER4.enabledProperty, 'yes');
    properties.setProperty(
      ER4.authorizedEmailProperty,
      Session.getEffectiveUser().getEmail() || 'owner@example.invalid'
    );
    SpreadsheetApp.flush();
    return verifyReviewWebAppV4Setup_();
  } finally {
    lock.releaseLock();
  }
}

function finalizeReviewWebAppV4Deployment() {
  var url = 'YOUR_WEB_APP_URL';
  if (!url) throw new Error('The Web App deployment URL is not available.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  upsertConfigRowsV4_(ss, [[
    'web_app_url',
    url,
    'Single responsive phone/Mac entry point for contract 4.0.'
  ]]);
  SpreadsheetApp.flush();
  return { ok: true, webAppUrl: url, contractVersion: ER4.contractVersion };
}

function verifyReviewWebAppV4Setup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  var contractVersionColumns = verifyContractVersionColumnsV4_(ss);
  var surfaces = [
    [ER4.questionSheet, ER4_QUESTION_HEADERS],
    [ER4.draftSheet, ER4_DRAFT_HEADERS],
    [ER4.draftHistorySheet, ER4_DRAFT_HISTORY_HEADERS],
    [ER4.gradeSheet, ER4_GRADE_HEADERS],
    [ER4.journalSheet, ER4_JOURNAL_HEADERS],
    [ER4.contextSheet, ER4_CONTEXT_HEADERS],
    [ER4.contextCandidateSheet, ER4_CONTEXT_CANDIDATE_HEADERS],
    [ER4.candidateGenerationSheet, ER4_CANDIDATE_GENERATION_HEADERS]
  ].map(function(item) {
    var sheet = requireSheet_(ss, item[0]);
    var headers = sheet.getRange(1, 1, 1, item[1].length).getValues()[0];
    item[1].forEach(function(header, index) {
      if (stringValue_(headers[index]) !== header) {
        throw new Error(item[0] + ' header mismatch at column ' + (index + 1) + '.');
      }
    });
    return { name: item[0], sheetId: sheet.getSheetId(), columns: item[1].length };
  });

  var triggerHandlers = ScriptApp.getProjectTriggers().map(function(trigger) {
    return trigger.getHandlerFunction();
  });
  if (triggerHandlers.indexOf(ER4.queueTrigger) === -1) {
    throw new Error('Missing v4 queue trigger.');
  }
  if (triggerHandlers.indexOf(ER4.gradeTrigger) === -1) {
    throw new Error('Missing v4 grade worker trigger.');
  }
  if (triggerHandlers.indexOf(DQ3.triggerHandler) !== -1) {
    throw new Error('v3 and v4 queue triggers must not run concurrently.');
  }

  return {
    ok: true,
    contractVersion: ER4.contractVersion,
    enabled: PropertiesService.getScriptProperties().getProperty(ER4.enabledProperty),
    surfaces: surfaces,
    contractVersionColumns: contractVersionColumns,
    triggerHandlers: triggerHandlers,
    webAppUrl: readConfigValueV4_(ss, 'web_app_url') || ''
  };
}

function ensureV4DataSurfaces_(ss) {
  ensureV4Sheet_(
    ss,
    ER4.questionSheet,
    ER4_QUESTION_HEADERS,
    [95, 150, 70, 95, 105, 100, 280, 280, 260, 260, 260, 260, 170, 120, 120, 240, 115, 150, 155, 155, 105]
  );
  ensureV4Sheet_(
    ss,
    ER4.draftSheet,
    ER4_DRAFT_HEADERS,
    [150, 150, 70, 95, 105, 420, 80, 155, 115, 190, 240, 105]
  );
  ensureV4Sheet_(
    ss,
    ER4.draftHistorySheet,
    ER4_DRAFT_HISTORY_HEADERS,
    [210, 150, 150, 70, 95, 105, 420, 90, 420, 90, 145, 180, 170, 155, 240, 105]
  );
  ensureV4Sheet_(
    ss,
    ER4.gradeSheet,
    ER4_GRADE_HEADERS,
    [190, 150, 240, 70, 95, 105, 100, 340, 150, 90, 320, 240, 180, 120, 115, 155, 420, 105, 520]
  );
  ensureV4Sheet_(
    ss,
    ER4.journalSheet,
    ER4_JOURNAL_HEADERS,
    [190, 150, 150, 240, 140, 150, 155, 155, 155, 150, 420, 130, 420, 420, 105]
  );
  ensureV4Sheet_(
    ss,
    ER4.contextSheet,
    ER4_CONTEXT_HEADERS,
    [145, 520, 420, 320, 260, 320, 145, 190, 170, 170, 220, 105]
  );
  ensureV4Sheet_(
    ss,
    ER4.contextCandidateSheet,
    ER4_CONTEXT_CANDIDATE_HEADERS,
    [145, 90, 240, 240, 220, 120, 300, 280, 140, 100, 300, 260, 320, 95, 140, 240, 190, 170, 170, 125, 105]
  );
  ensureV4Sheet_(
    ss,
    ER4.candidateGenerationSheet,
    ER4_CANDIDATE_GENERATION_HEADERS,
    [180, 105, 110, 110, 105, 80, 240, 220, 120, 220, 300, 280, 150, 100, 300, 260, 190, 120, 140, 170, 170, 125, 105]
  );

  var questionSheet = requireSheet_(ss, ER4.questionSheet);
  questionSheet.hideColumns(9, 4);
  var gradeSheet = requireSheet_(ss, ER4.gradeSheet);
  gradeSheet.hideColumns(11, 2);
  gradeSheet.hideColumns(17, 1);
  gradeSheet.hideColumns(19, 1);

  applyListValidationV4_(questionSheet, 6, ER4_QUESTION_TYPES);
  applyListValidationV4_(questionSheet, 17, ['staged', 'ready', 'bound', 'deferred', 'rejected']);
  applyListValidationV4_(ER4Sheet_(ss, ER4.draftSheet), 9, ['draft', 'submitted', 'deferred']);
  applyListValidationV4_(ER4Sheet_(ss, ER4.draftHistorySheet), 11, [
    'autosave', 'reveal_lock', 'replace_locked', 'submission_freeze'
  ]);
  applyListValidationV4_(gradeSheet, 7, ER4_RESULTS);
  applyListValidationV4_(gradeSheet, 15, ['staged', 'needs_confirmation', 'accepted', 'rejected', 'committed']);
  applyListValidationV4_(ER4Sheet_(ss, ER4.contextSheet), 7, [
    'pending', 'processing', 'processed', 'needs_review', 'explanation_only',
    'rejected', 'error'
  ]);
  applyListValidationV4_(ER4Sheet_(ss, ER4.contextCandidateSheet), 6, [
    'chunk', 'explanation_only'
  ]);
  applyListValidationV4_(ER4Sheet_(ss, ER4.contextCandidateSheet), 10, [
    'easy', 'medium', 'hard'
  ]);
  applyListValidationV4_(ER4Sheet_(ss, ER4.contextCandidateSheet), 15, [
    'staged', 'accepted', 'edited', 'rejected', 'known', 'explanation_only',
    'committed', 'duplicate', 'invalid'
  ]);
  applyListValidationV4_(ER4Sheet_(ss, ER4.candidateGenerationSheet), 9, [
    'chunk'
  ]);
  applyListValidationV4_(ER4Sheet_(ss, ER4.candidateGenerationSheet), 14, [
    'easy', 'medium', 'hard'
  ]);
  applyListValidationV4_(ER4Sheet_(ss, ER4.candidateGenerationSheet), 19, [
    'requested', 'staged', 'committed', 'duplicate', 'rejected', 'superseded'
  ]);
  applyListValidationV4_(
    ER4Sheet_(ss, ER4.journalSheet),
    5,
    [
      'awaiting_chatgpt',
      'needs_confirmation',
      'grading_validated',
      'writing',
      'verifying',
      'committed',
      'write_incomplete'
    ]
  );
}

function contractVersionSurfacesV4_() {
  return [
    ER4.questionSheet,
    ER4.draftSheet,
    ER4.draftHistorySheet,
    ER4.gradeSheet,
    ER4.journalSheet,
    ER4.contextSheet,
    ER4.contextCandidateSheet,
    ER4.candidateGenerationSheet,
    DQ3.phraseSheet,
    'Review Log',
    'Error Log',
    DQ3.queueSheet,
    'Session Log'
  ];
}

function formatContractVersionColumnsV4_(ss) {
  contractVersionSurfacesV4_().forEach(function(sheetName) {
    var sheet = requireSheet_(ss, sheetName);
    var headers = headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    requireHeaders_(headers, ['Contract Version'], sheetName);
    if (sheet.getMaxRows() > 1) {
      sheet.getRange(2, headers['Contract Version'] + 1, sheet.getMaxRows() - 1, 1)
        .setNumberFormat('@');
    }
  });
}

function verifyContractVersionColumnsV4_(ss) {
  return contractVersionSurfacesV4_().map(function(sheetName) {
    var sheet = requireSheet_(ss, sheetName);
    var headers = headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    requireHeaders_(headers, ['Contract Version'], sheetName);
    var column = headers['Contract Version'] + 1;
    var rowCount = Math.max(0, sheet.getMaxRows() - 1);
    if (rowCount) {
      var range = sheet.getRange(2, column, rowCount, 1);
      var formats = range.getNumberFormats();
      if (formats.some(function(row) { return row[0] !== '@'; })) {
        throw new Error(sheetName + ' Contract Version column is not formatted as text.');
      }
      var values = range.getValues();
      if (values.some(function(row) {
        return typeof row[0] === 'number' &&
          row[0] === Number(ER4.contractVersion);
      })) {
        throw new Error(sheetName + ' contains a numeric v4 Contract Version value.');
      }
    }
    return { name: sheetName, column: column, numberFormat: '@' };
  });
}

function ensureV4Sheet_(ss, name, headers, widths) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var mismatch = headers.some(function(header, index) {
    return stringValue_(existing[index]) && stringValue_(existing[index]) !== header;
  });
  if (mismatch && sheet.getLastRow() > 1) {
    throw new Error(name + ' contains data with a conflicting header contract.');
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#f1f3f4')
    .setFontColor('#202124')
    .setFontWeight('bold')
    .setWrap(true);
  sheet.setFrozenRows(1);
  widths.forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
  }
  return sheet;
}

function ER4Sheet_(ss, name) {
  return requireSheet_(ss, name);
}

function applyListValidationV4_(sheet, column, values) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, column, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

function ensureDynamicQuestionCountSchemaV4_(ss) {
  ensureAdaptiveQuestionEngineSchemaV4_(ss);
  var queueSheet = ensureDailyQueueSheet_(ss);
  var generationSheet = ensureV4Sheet_(
    ss,
    ER4.candidateGenerationSheet,
    ER4_CANDIDATE_GENERATION_HEADERS,
    [180, 105, 110, 110, 105, 80, 240, 220, 120, 220, 300, 280, 150, 100, 300, 260, 190, 120, 140, 170, 170, 125, 105]
  );
  applyListValidationV4_(generationSheet, 9, ['chunk']);
  applyListValidationV4_(generationSheet, 14, ['easy', 'medium', 'hard']);
  applyListValidationV4_(generationSheet, 19, [
    'requested', 'staged', 'committed', 'duplicate', 'rejected', 'superseded'
  ]);
  var headers = headerMap_(
    queueSheet.getRange(1, 1, 1, DQ3_QUEUE_HEADERS.length).getValues()[0]
  );
  requireHeaders_(headers, [
    'Planned Count', 'Adjusted Target', 'Queue Kind', 'Plan Revision',
    'Superseded By', 'Superseded At', 'Change Reason'
  ], DQ3.queueSheet);
  if (queueSheet.getMaxRows() > 1) {
    queueSheet.getRange(2, headers['Planned Count'] + 1, queueSheet.getMaxRows() - 1, 2)
      .setNumberFormat('0');
    queueSheet.getRange(2, headers['Plan Revision'] + 1, queueSheet.getMaxRows() - 1, 1)
      .setNumberFormat('0');
    queueSheet.getRange(2, headers['Superseded At'] + 1, queueSheet.getMaxRows() - 1, 1)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  applyListValidationV4_(queueSheet, headers['Queue Status'] + 1, [
    'planned', 'presented', 'committed', 'deferred', 'superseded'
  ]);
  applyListValidationV4_(queueSheet, headers['Queue Kind'] + 1, [
    'primary', 'supplemental'
  ]);
  ensureConfigDefaultsV4_(ss, [
    ['default_question_count', ER4.legacyQuestionCount,
      'Mutable default for future days; integer 1–150. One Queue is one user-visible daily set.'],
    ['question_count_override_date', '',
      'Optional Asia/Shanghai date whose daily target differs from the future default.'],
    ['question_count_override_value', '',
      'Optional 1–150 target used only when question_count_override_date matches the Queue date.']
  ]);
  ensureConfigContractRowsV4_(ss, [
    ['max_questions_per_session', ER4.legacyQuestionCount,
      'Legacy fallback only. The active daily target comes from default_question_count or the dated override.'],
    ['max_new_chunks_per_session', ER4.maxDailyQuestionCount,
      'New content may fill every slot left in the full 1–150 daily set after due reviews.'],
    ['max_active_intake_per_session', ER4.maxDailyQuestionCount,
      'One user-visible Daily Queue supports the full requested 1–150 range.'],
    ['question_style', 'one visible daily set of 1–150; internal AI staging segments up to 30; one answer submission',
      'The Web App never resets the visible count between internal staging segments.'],
    ['daily_question_count_range', '1–150',
      'The current day and future default can be adjusted independently. One active Queue shows the full daily total.'],
    ['max_questions_per_queue_batch', ER4.maxBatchQuestionCount,
      'Legacy key retained for compatibility; one user-visible Queue supports the full 1–150 range.'],
    ['max_ai_staging_segment', ER4.maxAiStagingSegmentCount,
      'Question and grading staging may use several internal segments without resetting the visible daily total.'],
    ['candidate_ready_pool_target', 'retired',
      'Candidate Bank is a persistent inventory, not a daily reserve that must be refilled to a target.'],
    ['candidate_ai_fallback_target', 'on_demand_shortfall',
      'No fixed AI reserve. Generate exactly the real shortfall only after due reviews and available personal material are used.']
  ]);
  return queueSheet;
}

function ensureAdaptiveQuestionEngineSchemaV4_(ss) {
  var sheet = requireSheet_(ss, ER4.gradeSheet);
  if (sheet.getMaxColumns() < ER4_GRADE_HEADERS.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      ER4_GRADE_HEADERS.length - sheet.getMaxColumns()
    );
  }
  var existing = sheet.getRange(1, 1, 1, ER4_GRADE_HEADERS.length).getValues()[0];
  ER4_GRADE_HEADERS.forEach(function(header, index) {
    if (stringValue_(existing[index]) && stringValue_(existing[index]) !== header) {
      throw new Error(ER4.gradeSheet + ' header mismatch at column ' + (index + 1) + '.');
    }
  });
  sheet.getRange(1, 1, 1, ER4_GRADE_HEADERS.length).setValues([ER4_GRADE_HEADERS]);
  sheet.getRange(1, ER4_GRADE_HEADERS.indexOf('Extra Practice JSON') + 1)
    .setBackground('#f1f3f4')
    .setFontColor('#202124')
    .setFontWeight('bold')
    .setWrap(true);
  sheet.setColumnWidth(ER4_GRADE_HEADERS.indexOf('Extra Practice JSON') + 1, 520);
  sheet.hideColumns(ER4_GRADE_HEADERS.indexOf('Extra Practice JSON') + 1, 1);
  ensureSrsAwarePhraseFormulasV4_(ss);
}

function ensureSrsAwarePhraseFormulasV4_(ss) {
  var sheet = requireSheet_(ss, DQ3.phraseSheet);
  if (sheet.getLastRow() < 2) return;
  var headers = headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  requireHeaders_(headers, ['ID', 'Last Reviewed', 'Times Seen', 'Times Correct'], DQ3.phraseSheet);
  var rowCount = sheet.getLastRow() - 1;
  var ids = sheet.getRange(2, headers.ID + 1, rowCount, 1).getValues();
  var lastReviewed = sheet.getRange(2, headers['Last Reviewed'] + 1, rowCount, 1).getFormulas();
  var timesSeen = sheet.getRange(2, headers['Times Seen'] + 1, rowCount, 1).getFormulas();
  var timesCorrect = sheet.getRange(2, headers['Times Correct'] + 1, rowCount, 1).getFormulas();
  var changed = false;
  ids.forEach(function(row, index) {
    if (!stringValue_(row[0])) return;
    var sheetRow = index + 2;
    var expectedLast =
      '=IFERROR(MAX(FILTER(\'Review Log\'!$A$2:$A,\'Review Log\'!$H$2:$H=$A' +
      sheetRow + ',\'Review Log\'!$O$2:$O="yes")),"")';
    var expectedSeen =
      '=COUNTIFS(\'Review Log\'!$H$2:$H,$A' + sheetRow +
      ',\'Review Log\'!$O$2:$O,"yes")';
    var expectedCorrect =
      '=COUNTIFS(\'Review Log\'!$H$2:$H,$A' + sheetRow +
      ',\'Review Log\'!$G$2:$G,"normal",\'Review Log\'!$O$2:$O,"yes")+' +
      'COUNTIFS(\'Review Log\'!$H$2:$H,$A' + sheetRow +
      ',\'Review Log\'!$G$2:$G,"mastered",\'Review Log\'!$O$2:$O,"yes")';
    if (lastReviewed[index][0] !== expectedLast) {
      lastReviewed[index][0] = expectedLast;
      changed = true;
    }
    if (timesSeen[index][0] !== expectedSeen) {
      timesSeen[index][0] = expectedSeen;
      changed = true;
    }
    if (timesCorrect[index][0] !== expectedCorrect) {
      timesCorrect[index][0] = expectedCorrect;
      changed = true;
    }
  });
  if (!changed) return;
  sheet.getRange(2, headers['Last Reviewed'] + 1, rowCount, 1).setFormulas(lastReviewed);
  sheet.getRange(2, headers['Times Seen'] + 1, rowCount, 1).setFormulas(timesSeen);
  sheet.getRange(2, headers['Times Correct'] + 1, rowCount, 1).setFormulas(timesCorrect);
  SpreadsheetApp.flush();
  var verifiedLast = sheet.getRange(2, headers['Last Reviewed'] + 1, rowCount, 1).getFormulas();
  var verifiedSeen = sheet.getRange(2, headers['Times Seen'] + 1, rowCount, 1).getFormulas();
  var verifiedCorrect = sheet.getRange(2, headers['Times Correct'] + 1, rowCount, 1).getFormulas();
  ids.forEach(function(row, index) {
    if (!stringValue_(row[0])) return;
    if (
      verifiedLast[index][0] !== lastReviewed[index][0] ||
      verifiedSeen[index][0] !== timesSeen[index][0] ||
      verifiedCorrect[index][0] !== timesCorrect[index][0]
    ) {
      throw new Error('Phrase Bank SRS-aware formula readback failed at row ' + (index + 2) + '.');
    }
  });
}

function ensureConfigDefaultsV4_(ss, defaults) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  var existing = {};
  for (var i = 1; i < values.length; i++) {
    var key = stringValue_(values[i][0]);
    if (key) existing[key] = i + 1;
  }
  defaults.forEach(function(row) {
    if (!existing[row[0]]) {
      sheet.appendRow(row);
      existing[row[0]] = sheet.getLastRow();
    } else if (stringValue_(values[existing[row[0]] - 1][2]) !== stringValue_(row[2])) {
      // Preserve the user's configured value while keeping the explanatory
      // contract aligned with the current implementation.
      sheet.getRange(existing[row[0]], 3).setValue(row[2]);
    }
  });
}

function ensureConfigContractRowsV4_(ss, requiredRows) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  var rowByKey = {};
  for (var i = 1; i < values.length; i++) {
    var key = stringValue_(values[i][0]);
    if (key) rowByKey[key] = i + 1;
  }
  requiredRows.forEach(function(requiredRow) {
    var rowNumber = rowByKey[requiredRow[0]];
    if (!rowNumber) {
      sheet.appendRow(requiredRow);
      rowByKey[requiredRow[0]] = sheet.getLastRow();
      return;
    }
    var current = sheet.getRange(rowNumber, 1, 1, 3).getValues()[0];
    var changed = requiredRow.some(function(value, index) {
      return stringValue_(current[index]) !== stringValue_(value);
    });
    if (changed) sheet.getRange(rowNumber, 1, 1, 3).setValues([requiredRow]);
  });
}

function updateConfigV4_(ss) {
  upsertConfigRowsV4_(ss, [
    ['contract_version', ER4.contractVersion, 'Required by the Web App, ChatGPT staging prompts, queue builder, and commit worker.'],
    ['review_entrypoint', 'Apps Script Web App', 'One responsive URL serves phone and Mac.'],
    ['ai_transport', 'Full question prompt once, then bare 批改 in the same ChatGPT conversation; standalone prompts remain available as fallback; Google Sheet staging; no OpenAI API', 'The normal manual flow reuses the question conversation. A complete grading prompt is only needed when that conversation is unavailable.'],
    ['question_prepare_phase', 'scheduled task or Web App manual handoff', 'Reads one active daily set and stages any missing positions; internal segments do not create a new user-visible set.'],
    ['grading_trigger_command', '批改 in the question conversation; standalone grading prompt only as fallback', 'ChatGPT resolves exactly one awaiting_chatgpt submission; the user never types a Session ID.'],
    ['question_staging_sheet', ER4.questionSheet, 'AI-authored question batch; this single-user app preloads answers into browser memory but does not render them before reveal.'],
    ['adaptive_question_policy', 'stage + latest error + context rotation', 'Formal prompts declare component-or-chunk answer scope, never require a full sentence, and reject exact historical prompt reuse.'],
    ['answer_draft_sheet', ER4.draftSheet, 'Versioned server drafts, per-question reveal locks, and frozen batch snapshots.'],
    ['answer_draft_history_sheet', ER4.draftHistorySheet, 'Append-only before/after evidence for autosave, reveal lock, locked-answer correction, and submission freeze.'],
    ['answer_reveal_flow', 'lock one answer → reveal its stored expected answer → continue', 'A session may be submitted once locked answers reach its Adjusted Target; extra locked answers are all graded and recorded.'],
    ['grade_inbox_sheet', ER4.gradeSheet, 'ChatGPT grading staging only; no formal SRS writes.'],
    ['error_reinforcement_policy', 'one per formal error; unlimited; non-recursive; Affects SRS?=no', 'Every forgotten/difficult formal attempt receives one separate reinforcement question.'],
    ['sentence_challenge_policy', 'mastered at Review Stage 6+; outside formal set; Affects SRS?=no', 'Full-sentence transfer is recorded separately and never changes the formal result.'],
    ['context_inbox_sheet', ER4.contextSheet, 'Immutable user-captured source text and validated UTF-16 selection spans.'],
    ['context_candidate_inbox_sheet', ER4.contextCandidateSheet, 'ChatGPT context-processing staging only; Candidate Bank remains Apps Script-only.'],
    ['context_processing_command', 'retired', 'A bare 整理语料 message in the Scheduled Task conversation does not load the task prompt and must not be used.'],
    ['context_processing_entrypoint', 'Web App button: copy full prompt and open Work conversation', 'The user pastes and sends the complete one-time prompt; ChatGPT stages zero to three reusable chunks per pending Context.'],
    ['context_user_candidate_daily_limit', 'retired', 'Personal source candidates may fill every new-item slot left after due reviews.'],
    ['priority_order', 'scheduled due items; then user_context → learning_evidence → conversation_derived → legacy → ai_fallback', 'Candidate Bank is the durable master inventory; personal sources always outrank generated fallback content.'],
    ['queue_new_item_source', 'Candidate Bank ready chunks with Origin Type metadata', 'Daily Queue selects the existing master inventory and never creates a replacement candidate.'],
    ['commit_journal_sheet', ER4.journalSheet, 'Submission idempotency, recovery checkpoints, and verified result.'],
    ['formal_database_writer', 'Apps Script v4 commit worker', 'Only deterministic code updates formal logs, candidates, phrase state, queue, and Session Log.'],
    ['database_write_order', 'Review Log → Error Log → Candidate Bank → Phrase Bank state → Daily Queue → Session Log', 'Session Log remains last.'],
    ['web_app_url', 'YOUR_WEB_APP_URL', 'Updated after Web App deployment.'],
    ['chatgpt_task_url', ER4.chatGptTaskUrl, 'Optional legacy Scheduled Task entry point.'],
    ['chatgpt_manual_url', ER4.chatGptManualUrl, 'The Web App copies a complete standalone prompt before opening ChatGPT.'],
    ['daily_question_count_range', '1–150', 'Three scopes are supported: today only, future default only, or today and future together. Lowering today removes excess unconfirmed positions from every current-day surface; their source items remain normally eligible for future queues.'],
    ['max_questions_per_queue_batch', ER4.maxBatchQuestionCount, 'Legacy key retained for compatibility; the Queue can represent the full 1–150 daily set.'],
    ['max_ai_staging_segment', ER4.maxAiStagingSegmentCount, 'AI writes may be segmented internally while the Web App keeps one total and one submission.'],
    ['candidate_ready_pool_target', 'retired', 'Verified grading no longer creates candidates merely to maintain forty ready rows.'],
    ['candidate_ai_fallback_target', 'on_demand_shortfall', 'No fixed AI reserve. When an active Queue cannot be filled, the Web App creates one exact shortfall request and supplies a standalone ChatGPT prompt.'],
    ['candidate_generation_sheet', ER4.candidateGenerationSheet, 'AI-authored material is staged here; Apps Script validates, deduplicates, assigns Candidate IDs, and only then writes Candidate Bank.'],
    ['low_confidence_threshold', ER4.lowConfidenceThreshold, 'Only affected items require confirmation before formal commit.'],
    ['rollback_baseline', 'v3-pre-v4-20260728-155612', 'Restore behavior with the recorded rollback helper and artifacts; never rewrite committed history.']
  ]);
}

function upsertConfigRowsV4_(ss, updates) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  var rowByKey = {};
  for (var i = 1; i < values.length; i++) {
    var key = stringValue_(values[i][0]);
    if (key) rowByKey[key] = i + 1;
  }
  updates.forEach(function(update) {
    var rowNumber = rowByKey[update[0]];
    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, 3).setValues([update]);
    } else {
      sheet.appendRow(update);
      rowByKey[update[0]] = sheet.getLastRow();
    }
  });
  var contractRow = rowByKey.contract_version;
  if (contractRow) {
    sheet.getRange(contractRow, 2).setNumberFormat('@').setValue(ER4.contractVersion);
  }
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 520);
  sheet.setColumnWidth(3, 700);
  sheet.getDataRange().setVerticalAlignment('top').setWrap(true);
}

function updateReadmeV4_(ss) {
  var sheet = requireSheet_(ss, DQ3.readmeSheet);
  var migrationDate = new Date();
  sheet.getRange('A1:C18').setValues([
    ['English Review System', 'Contract', 'v4.0 — responsive Web App with ChatGPT question/grading staging and deterministic Apps Script commits.'],
    ['Workflow', 'Candidate Bank → Daily Queue → Session Questions → per-question answer lock/reveal → batch submit → Grade Inbox → verified logs/state → Session Log', 'Google Sheet remains the single source of truth.'],
    ['Phrase Bank', 'Canonical phrase master and current SRS state', 'Formula columns I/K/L remain protected from ordinary writes.'],
    ['Review Log', 'Append-only primary/reinforcement attempts', 'Every primary question uses one stable Attempt ID.'],
    ['Error Log', 'Append-only linked error occurrences', 'References Phrase ID + Session ID + Attempt ID.'],
    ['Candidate Bank', 'Durable master inventory for all candidate chunks', 'Personal sources are selected first; AI fallback is allowed only after personal inventory and intake backlog are exhausted.'],
    ['Context Inbox', 'Immutable real-world source material', 'Raw Text and UTF-16 selection offsets are Apps Script-validated and never overwritten by AI.'],
    ['Context Candidate Inbox', 'AI staging for context-derived chunks', 'Launch from the Web App one-time prompt; user acceptance is required before Apps Script writes Candidate Bank.'],
    ['Session Log', 'One formal row per committed session', 'Written last only after exact readback.'],
    ['Source Notes', 'Legacy intake archive', 'Historical read-only source.'],
    ['Config', 'Executable v4 data contract', 'All automated surfaces must require contract_version=4.0.'],
    ['Pending review', 'Status in {active, mastered} AND Next Review<=today', 'Suspended remains excluded.'],
    ['Migration', migrationDate, 'v4 adds phone/Mac UI, server drafts, immediate stored-answer reveal after each server lock, AI staging, idempotent commit, and rollback checkpoints.'],
    ['AI boundary', 'ChatGPT writes staging only', 'No OpenAI API key; formal database writes are Apps Script-only.'],
    ['Opening audit', 'First Web App open allocates Session ID and Presented At', 'A scheduled ChatGPT run prepares questions but does not start the session.'],
    ['Grading handoff', 'Return to ChatGPT and send only 批改', 'ChatGPT resolves exactly one awaiting submission; zero/multiple pending states fail closed.'],
    ['Write invariant', 'No committed result before ordered writes and exact readback', 'Incomplete work is reported truthfully and recovered idempotently.'],
    ['Rollback', 'v3-pre-v4-20260728-155612', 'Additive staging sheets may remain; never delete or reinterpret committed history.']
  ]);
  sheet.getRange('B13').setNumberFormat('yyyy-mm-dd');
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 560);
  sheet.setColumnWidth(3, 760);
  sheet.getRange(1, 1, 18, 3).setWrap(true).setVerticalAlignment('top');
  sheet.autoResizeRows(1, 18);
  sheet.setFrozenRows(1);
}

function assertNoUnsafePresentedQueueV4_(ss) {
  var sheet = requireSheet_(ss, DQ3.queueSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ['Queue Status', 'Queue ID', 'Session ID'], DQ3.queueSheet);
  var unsafe = [];
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][headers['Queue Status']]).toLowerCase() === 'presented') {
      unsafe.push(
        stringValue_(values[i][headers['Queue ID']]) + '/' +
        stringValue_(values[i][headers['Session ID']])
      );
    }
  }
  if (unsafe.length) {
    throw new Error('v4 cutover blocked by presented/uncommitted Queue rows: ' + unsafe.slice(0, 5).join(', '));
  }
}

function installV4Triggers_() {
  var managed = {};
  managed[DQ3.triggerHandler] = true;
  managed[ER4.queueTrigger] = true;
  managed[ER4.gradeTrigger] = true;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (managed[trigger.getHandlerFunction()]) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(ER4.queueTrigger)
    .timeBased()
    .atHour(8)
    .nearMinute(30)
    .everyDays(1)
    .inTimezone(ER4.timezone)
    .create();
  ScriptApp.newTrigger(ER4.gradeTrigger)
    .timeBased()
    .everyMinutes(5)
    .create();
}

function assertContractV4_(ss) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][0]) === 'contract_version') {
      if (stringValue_(values[i][1]) !== ER4.contractVersion) {
        throw new Error(
          'Contract mismatch: expected ' + ER4.contractVersion +
          ', found ' + stringValue_(values[i][1]) + '.'
        );
      }
      return;
    }
  }
  throw new Error('Config contract_version is missing.');
}

function assertV4Enabled_() {
  if (PropertiesService.getScriptProperties().getProperty(ER4.enabledProperty) !== 'yes') {
    throw new Error('The v4 review Web App is disabled.');
  }
}

function assertAuthorizedV4_() {
  var expected = PropertiesService.getScriptProperties().getProperty(ER4.authorizedEmailProperty);
  var active = Session.getActiveUser().getEmail();
  if (expected && active && expected.toLowerCase() !== active.toLowerCase()) {
    throw new Error('This review app is restricted to its configured owner.');
  }
}
