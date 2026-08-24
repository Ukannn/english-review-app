
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
