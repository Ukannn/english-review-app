/**
 * English Review Web App v4.0
 *
 * Additive upgrade over DailyQueue.gs:
 * - no OpenAI API key;
 * - ChatGPT writes question/grading staging rows only;
 * - one-time context processing is launched from the Web App with a complete copied prompt;
 * - Apps Script owns sessions, drafts, SRS, formal writes, and readback;
 * - the user triggers grading with the bare command "批改".
 */

var ER4 = {
  timezone: 'Asia/Shanghai',
  contractVersion: '4.0',
  enabledProperty: 'ER4_ENABLED',
  authorizedEmailProperty: 'ER4_AUTHORIZED_EMAIL',
  queueTrigger: 'scheduledBuildDailyQueueV4',
  gradeTrigger: 'processPendingGradeInboxV4',
  questionSheet: 'Session Questions',
  draftSheet: 'Answer Drafts',
  gradeSheet: 'Grade Inbox',
  journalSheet: 'Commit Journal',
  contextSheet: 'Context Inbox',
  contextCandidateSheet: 'Context Candidate Inbox',
  candidateGenerationSheet: 'Candidate Generation Inbox',
  legacyQuestionCount: 20,
  minQuestionCount: 1,
  maxDailyQuestionCount: 150,
  // One Queue ID is one user-visible daily set. Question/grading rows may be
  // staged under several internal IDs, without resetting the visible total.
  maxBatchQuestionCount: 150,
  maxAiStagingSegmentCount: 30,
  aiFallbackPoolTarget: 0,
  maxCandidateGenerationCount: 150,
  maxContextLength: 12000,
  maxContextProposals: 3,
  lowConfidenceThreshold: 0.75,
  chatGptTaskUrl: 'https://chatgpt.com/scheduled',
  chatGptManualUrl: 'https://chatgpt.com/',
  contextProcessingConversationUrl: 'https://chatgpt.com/'
};

var ER4_QUESTION_HEADERS = [
  'Queue Date',
  'Queue ID',
  'Position',
  'Phrase ID',
  'Candidate ID',
  'Question Type',
  'Prompt ZH',
  'Prompt EN',
  'Expected Answers JSON',
  'Accepted Variants JSON',
  'Semantic Boundary',
  'Grading Rubric',
  'Generation ID',
  'Model ID',
  'Prompt Version',
  'Content Hash',
  'Question Status',
  'Session ID',
  'Created At',
  'Bound At',
  'Contract Version'
];

var ER4_DRAFT_HEADERS = [
  'Session ID',
  'Queue ID',
  'Position',
  'Phrase ID',
  'Candidate ID',
  'Answer',
  'Revision',
  'Updated At',
  'Submit Status',
  'Submission ID',
  'Answer Hash',
  'Contract Version'
];

var ER4_GRADE_HEADERS = [
  'Submission ID',
  'Session ID',
  'Answer Hash',
  'Position',
  'Phrase ID',
  'Candidate ID',
  'Result',
  'Feedback ZH',
  'Error Category',
  'Confidence',
  'Evidence',
  'Expected Answer',
  'Grading Batch ID',
  'Prompt Version',
  'Grade Status',
  'Created At',
  'Candidate Suggestions JSON',
  'Contract Version'
];

var ER4_JOURNAL_HEADERS = [
  'Submission ID',
  'Session ID',
  'Queue ID',
  'Answer Hash',
  'Status',
  'Last Completed Step',
  'Started At',
  'Updated At',
  'Completed At',
  'Error Code',
  'Error Detail',
  'Readback Status',
  'Result JSON',
  'Confirmation JSON',
  'Contract Version'
];

var ER4_CONTEXT_HEADERS = [
  'Context ID',
  'Raw Text',
  'Selected Spans JSON',
  'Source URL',
  'Source Title',
  'User Note',
  'Processing Status',
  'Processing Batch ID',
  'Created At',
  'Processed At',
  'Capture Request ID',
  'Contract Version'
];

var ER4_CONTEXT_CANDIDATE_HEADERS = [
  'Context ID',
  'Proposal Position',
  'Selected Text',
  'Candidate',
  'Chinese Cue',
  'Candidate Type',
  'Context Meaning',
  'Why Useful',
  'Topic',
  'Difficulty',
  'Natural Example',
  'Common Mistake',
  'Extraction Rationale',
  'Confidence',
  'Decision Status',
  'Edited Candidate',
  'Processing Batch ID',
  'Created At',
  'Committed At',
  'Candidate ID',
  'Contract Version'
];

var ER4_CANDIDATE_GENERATION_HEADERS = [
  'Request ID',
  'Queue Date',
  'Requested Count',
  'Available Count',
  'Shortfall Count',
  'Position',
  'Candidate',
  'Chinese Cue',
  'Candidate Type',
  'Source',
  'Context',
  'Why Useful',
  'Topic',
  'Difficulty',
  'Natural Example',
  'Common Mistake',
  'Generation Batch ID',
  'Model ID',
  'Generation Status',
  'Created At',
  'Committed At',
  'Candidate ID',
  'Contract Version'
];

var ER4_RESULTS = ['forgotten', 'difficult', 'normal', 'mastered'];
var ER4_CONTEXT_PROCESSING_PROMPT = [
  "你正在执行一次性的“真实语料整理”。这不是 Scheduled Task，也不是每日出题或批改。请立即通过当前 Work 对话中的 @Google Drive 连接器读取 Google Sheet；不要要求用户在聊天里重新粘贴原文。",
  "",
  "目标工作簿：",
  "- 标题：English Review Database",
  "- Spreadsheet ID：YOUR_SPREADSHEET_ID",
  "- 语料箱：YOUR_WEB_APP_URL",
  "- 时区：Asia/Shanghai",
  "- Config 的 contract_version 必须精确为文本 4.0。",
  "",
  "绝对边界：",
  "1. 你只允许向 Context Candidate Inbox 写入暂存数据。",
  "2. 不得直接新增或修改 Context Inbox、Candidate Bank、Phrase Bank、Daily Queue、Review Log、Error Log、Session Questions、Grade Inbox、Session Log、Answer Drafts 或 Commit Journal。",
  "3. 原文读取自 Context Inbox；不得要求用户再次粘贴、转述或重新标记原文。",
  "4. 正式 Candidate ID、Candidate Bank、Phrase Bank、SRS 和日志全部由 Apps Script 负责。",
  "5. 任一身份、数量、状态、契约或固定范围回读不符合要求时，停止并报告确切失败项；不得猜测或补位。",
  "6. 如果当前对话无法使用 Google Drive 连接器，明确报告连接器不可用；不得改成“请把原文贴过来”。",
  "",
  "==========================",
  "context_processing 一次性执行",
  "==========================",
  "",
  "1. 读取 Config 并确认 contract_version=4.0；读取 Context Inbox 和 Context Candidate Inbox 的真实表头。Context Inbox 的正式表头为：",
  "Context ID | Raw Text | Selected Spans JSON | Source URL | Source Title | User Note | Processing Status | Processing Batch ID | Created At | Processed At | Capture Request ID | Contract Version",
  "",
  "Context Candidate Inbox 的正式表头为：",
  "Context ID | Proposal Position | Selected Text | Candidate | Chinese Cue | Candidate Type | Context Meaning | Why Useful | Topic | Difficulty | Natural Example | Common Mistake | Extraction Rationale | Confidence | Decision Status | Edited Candidate | Processing Batch ID | Created At | Committed At | Candidate ID | Contract Version",
  "",
  "2. 只处理 Contract Version=4.0 且 Processing Status=pending 的 Context。若当前没有 pending Context，回复“当前没有待整理的语料”，不得写入任何表。每次最多处理20条，按 Created At、Context ID 从早到晚；其余留给下一次运行。",
  "",
  "3. 对每条 Context 先校验：",
  "- Context ID 唯一且格式为 CTX-六位以上数字；",
  "- Raw Text 非空且不超过12000字符；",
  "- Selected Spans JSON 可解析为数组；",
  "- 每个 span 含 text/start/end，start/end 使用 JavaScript UTF-16 offset；",
  "- Raw Text.slice(start,end) 必须精确等于 text；",
  "- span 不越界、不为空、不重复、不重叠；",
  "- Contract Version 精确为文本4.0。",
  "任何一条校验失败都停止并报告确切 Context ID 与失败项，不得猜测或修正原文。",
  "",
  "4. 读取 Phrase Bank 的 Chunk/Canonical Pattern、Candidate Bank 的 Candidate，以及本批已经生成的 Candidate，用标准化文本去重。对每条 Context：",
  "- 有用户标记时，优先围绕每个标记结合完整 Raw Text 判断真实含义；不得只按字面切词；",
  "- 无标记时，识别最可能造成理解障碍且值得长期复习的表达；",
  "- 每条 Context 生成0–3个建议；",
  "- 优先固定搭配、短语动词、介词结构、习惯表达、可复用句型和组合含义不能逐词推导的表达；",
  "- 不优先普通孤立单词、专有名词、一次性术语、过长完整句子、只适用于当前文章的表达；",
  "- Candidate 必须规范化为可复习 chunk，例如 steering customers toward → steer someone toward something，subject to availability → be subject to availability；",
  "- Candidate Type=chunk；Difficulty只能是 easy/medium/hard；",
  "- Candidate、Chinese Cue、Context Meaning、Why Useful、Topic、Natural Example、Extraction Rationale 必须非空；Confidence为0到1的小数；",
  "- 发现文本完全重复时不生成重复建议；发现可能的语义近似重复时，在 Extraction Rationale 中明确写“可能语义重复”，留给用户决定。",
  "",
  "5. 如果某条 Context 没有值得进入SRS的建议，仍写入一条说明行：Proposal Position=0，Candidate留空，Candidate Type=explanation_only，Chinese Cue与Context Meaning写清当前解释，Decision Status=explanation_only。这样 Web App 可以确定该 Context 已处理，但不会创建 Candidate。",
  "",
  "6. 先读取 Context Candidate Inbox，按 Context ID 检查是否已有 active 处理结果。active 指同一 Context 已有 Contract Version=4.0 且 Decision Status 属于 staged/accepted/edited/committed/explanation_only 的行：",
  "- 若恰好一个 Processing Batch ID 且行数/Position合法，复用现有结果，不重复写；",
  "- 若出现多个 active Processing Batch ID，停止并报告歧义；",
  "- 只有完全没有 active 结果的 Context 才能生成新暂存行。",
  "",
  "7. 使用本次唯一 Processing Batch ID，例如 CTXB-<yyyyMMddHHmmss>。调用 Google Drive 的 Batch update spreadsheet，以结构化 appendCells 一次追加本次所有新暂存行；每行严格21个 CellData，fields精确为userEnteredValue，按上面 Context Candidate Inbox 的列顺序写入：",
  "- Proposal Position：chunk建议为1–3；explanation_only为0；",
  "- Selected Text：有标记时写对应原文文字；无标记时可留空；",
  "- Edited Candidate、Committed At、Candidate ID留空；",
  "- Decision Status：chunk建议写staged；说明行写explanation_only；",
  "- Created At写当前真实Asia/Shanghai时间；",
  "- Contract Version写文本4.0。",
  "",
  "8. 立即回读刚追加的固定范围，确认：",
  "- 新写入行数与计划完全一致；",
  "- 每个 Context 最多3条chunk建议，或恰好1条explanation_only说明行；",
  "- Context ID、Proposal Position、Selected Text、Candidate和Processing Batch ID与计划逐行一致；",
  "- Confidence、Difficulty、Decision Status合法；",
  "- Contract Version全部为文本4.0；",
  "- Context Candidate Inbox中每个已处理Context只有一个active Processing Batch ID。",
  "",
  "9. 只有固定范围回读全部通过后，回复：",
  "“语料整理暂存已完成。请返回语料箱确认要加入候选池的表达：YOUR_WEB_APP_URL”",
  "",
  "不得宣称 Candidate Bank 已写入。只有用户在 Web App 确认、Apps Script 正式写入并精确回读后，才算进入候选池。"
].join('\n');

var ER4_QUESTION_TYPES = ['recall', 'cloze', 'contrast', 'scenario', 'oral'];
var ER4_INTERVALS = [1, 2, 4, 7, 14, 30, 60, 120];

function doGet(e) {
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
    ER4.gradeSheet,
    ER4_GRADE_HEADERS,
    [190, 150, 240, 70, 95, 105, 100, 340, 150, 90, 320, 240, 180, 120, 115, 155, 420, 105]
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

  applyListValidationV4_(questionSheet, 6, ER4_QUESTION_TYPES);
  applyListValidationV4_(questionSheet, 17, ['staged', 'ready', 'bound', 'deferred', 'rejected']);
  applyListValidationV4_(ER4Sheet_(ss, ER4.draftSheet), 9, ['draft', 'submitted', 'deferred']);
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
    ['ai_transport', 'Optional scheduled task or full copied prompt in any capable ChatGPT conversation; Google Sheet staging; no OpenAI API', 'The Web App supplies standalone question/grading prompts, so the workflow is not tied to one Work conversation or model.'],
    ['question_prepare_phase', 'scheduled task or Web App manual handoff', 'Reads one active daily set and stages any missing positions; internal segments do not create a new user-visible set.'],
    ['grading_trigger_command', 'full standalone grading prompt; legacy task conversation may still use 批改', 'ChatGPT resolves exactly one awaiting_chatgpt submission; the user never types a Session ID.'],
    ['question_staging_sheet', ER4.questionSheet, 'AI-authored question batch; this single-user app preloads answers into browser memory but does not render them before reveal.'],
    ['answer_draft_sheet', ER4.draftSheet, 'Versioned server drafts, per-question reveal locks, and frozen batch snapshots.'],
    ['answer_reveal_flow', 'lock one answer → reveal its stored expected answer → continue', 'A session may be submitted once locked answers reach its Adjusted Target; extra locked answers are all graded and recorded.'],
    ['grade_inbox_sheet', ER4.gradeSheet, 'ChatGPT grading staging only; no formal SRS writes.'],
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
    ['daily_question_count_range', '1–150', 'One active Queue represents the full user-visible daily set; a safe continuation is used only after an earlier session was already formally committed.'],
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
    return isDraftRevealedV4_(draft, sessionId);
  }).length;
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

function getReviewBootstrapV4() {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  ensureDynamicQuestionCountSchemaV4_(ss);
  var today = new Date();
  var ensured = buildDailyQueueV4ForDate_(today);
  if (ensured && ensured.state === 'candidate_shortfall') {
    var shortfallResponse = {
      ok: true,
      state: 'candidate_shortfall',
      message:
        '今天的完整题组还缺 ' + ensured.shortfallCount +
        ' 条合适素材。你的个人语料仍会优先；请让 ChatGPT 按当前缺口生成个性化补充素材。',
      requestId: ensured.requestId,
      shortfallCount: ensured.shortfallCount,
      requestedCount: ensured.dailyTarget,
      dueCount: ensured.dueCount,
      readyCandidateCount: ensured.readyCandidateCount,
      chatGptManualUrl: ER4.chatGptManualUrl
    };
    var shortfallQueue = findQueueForDateV4_(ss, formatDateKey_(today));
    if (shortfallQueue && shortfallQueue.status === 'presented') {
      shortfallResponse.queueMeta = {
        planned: shortfallQueue.plannedCount,
        adjustedTarget: shortfallQueue.adjustedTarget,
        requested: ensured.dailyTarget,
        completedBeforeBatch: completedQuestionsForDateV4_(
          ss,
          shortfallQueue.dateKey,
          shortfallQueue.sessionId
        ),
        completedInBatch: countLockedDraftsV4_(ss, shortfallQueue.sessionId),
        queueKind: shortfallQueue.queueKind,
        due: shortfallQueue.rows.filter(function(item) {
          return stringValue_(
            item.values[shortfallQueue.headers['Selection Type']]
          ).toLowerCase() !== 'new';
        }).length,
        fresh: shortfallQueue.rows.filter(function(item) {
          return stringValue_(
            item.values[shortfallQueue.headers['Selection Type']]
          ).toLowerCase() === 'new';
        }).length
      };
    }
    return shortfallResponse;
  }
  var queue = findQueueForDateV4_(ss, formatDateKey_(today));
  if (!queue) {
    return {
      ok: true,
      state: 'waiting_next_queue',
      message: '今天暂时没有可开始的题组。如果你今天已经完成练习，下一场题目会按计划准备。',
      chatGptTaskUrl: ER4.chatGptTaskUrl,
      chatGptManualUrl: ER4.chatGptManualUrl
    };
  }
  validateMaterializedQueueV4_(queue.rows.map(function(item) { return item.values; }), queue.queueId);

  if (queue.status === 'committed') {
    var committedJournal = findJournalBySessionV4_(ss, queue.sessionId);
    if (committedJournal) {
      return responseForJournalV4_(committedJournal);
    }
    return {
      ok: true,
      state: 'committed_without_result',
      message: '本场学习记录已提交，但结果暂时无法显示。',
      queueId: queue.queueId,
      sessionId: queue.sessionId
    };
  }
  if (queue.sessionId) {
    var activeJournal = findJournalBySessionV4_(ss, queue.sessionId);
    if (activeJournal) return responseForJournalV4_(activeJournal);
  }

  var questionBatch;
  try {
    questionBatch = validatePreparedQuestionBatchV4_(ss, queue);
  } catch (error) {
    return {
      ok: true,
      state: 'question_invalid',
      message: error.message,
      queueId: queue.queueId,
      queueMeta: {
        planned: queue.plannedCount,
        adjustedTarget: queue.adjustedTarget,
        requested: readQuestionCountSettingsV4_(ss, queue.dateKey).targetCount,
        completedBeforeBatch: completedQuestionsForDateV4_(ss, queue.dateKey, queue.sessionId),
        completedInBatch: countLockedDraftsV4_(ss, queue.sessionId),
        queueKind: queue.queueKind,
        due: queue.rows.filter(function(item) {
          return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() !== 'new';
        }).length,
        fresh: queue.rows.filter(function(item) {
          return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() === 'new';
        }).length
      },
      chatGptTaskUrl: ER4.chatGptTaskUrl
    };
  }
  if (!questionBatch) {
    return {
      ok: true,
      state: 'preparing',
      message:
        '今天完整题组共 ' + queue.plannedCount +
        ' 道题，仍有题目正在内部暂存。自动化可以完成；你也可以复制完整出题提示词，交给任意可使用 Google Drive 的高模型。',
      queueId: queue.queueId,
      plannedCount: queue.plannedCount,
      queueMeta: {
        planned: queue.plannedCount,
        adjustedTarget: queue.adjustedTarget,
        requested: readQuestionCountSettingsV4_(ss, queue.dateKey).targetCount,
        completedBeforeBatch: completedQuestionsForDateV4_(ss, queue.dateKey, queue.sessionId),
        completedInBatch: countLockedDraftsV4_(ss, queue.sessionId),
        queueKind: queue.queueKind,
        due: queue.rows.filter(function(item) {
          return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() !== 'new';
        }).length,
        fresh: queue.rows.filter(function(item) {
          return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() === 'new';
        }).length
      },
      chatGptTaskUrl: ER4.chatGptTaskUrl,
      chatGptManualUrl: ER4.chatGptManualUrl
    };
  }
  return startOrResumeReviewSessionV4_(ss, queue, questionBatch);
}

function findQueueForDateV4_(ss, dateKey) {
  var sheet = requireSheet_(ss, DQ3.queueSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(
    headers,
    ['Queue Date', 'Queue ID', 'Position', 'Queue Status', 'Session ID', 'Contract Version',
      'Presented At', 'Planned Count', 'Adjusted Target', 'Queue Kind'],
    DQ3.queueSheet
  );
  var groups = {};
  for (var i = 1; i < values.length; i++) {
    if (
      isDateValue_(values[i][headers['Queue Date']]) &&
      formatDateKey_(values[i][headers['Queue Date']]) === dateKey &&
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion
    ) {
      var queueId = stringValue_(values[i][headers['Queue ID']]);
      if (!queueId) throw new Error('Daily Queue contains a row without Queue ID.');
      if (!groups[queueId]) groups[queueId] = [];
      groups[queueId].push({ rowNumber: i + 1, values: values[i] });
    }
  }
  var queueIds = Object.keys(groups);
  if (!queueIds.length) return null;
  var queues = queueIds.map(function(queueId) {
    var matches = groups[queueId];
    matches.sort(function(a, b) {
      return Number(a.values[headers.Position]) - Number(b.values[headers.Position]);
    });
    validateMaterializedQueueV4_(matches.map(function(item) { return item.values; }), queueId);
    var statuses = uniqueStringsV4_(matches.map(function(item) {
      return stringValue_(item.values[headers['Queue Status']]).toLowerCase();
    }));
    var aggregateStatus;
    if (statuses.length === 1 && ['planned', 'presented', 'superseded'].indexOf(statuses[0]) !== -1) {
      aggregateStatus = statuses[0];
    } else if (
      statuses.length >= 1 &&
      statuses.every(function(status) { return status === 'committed' || status === 'deferred'; }) &&
      statuses.indexOf('committed') !== -1
    ) {
      aggregateStatus = 'committed';
    } else {
      throw new Error(queueId + ' rows do not form one valid aggregate Queue status.');
    }
    var sessions = uniqueStringsV4_(matches.map(function(item) {
      return stringValue_(item.values[headers['Session ID']]);
    }).filter(Boolean));
    if (sessions.length > 1) throw new Error(queueId + ' rows do not share one Session ID.');
    return {
      sheet: sheet,
      headers: headers,
      rows: matches,
      queueId: queueId,
      status: aggregateStatus,
      sessionId: sessions[0] || '',
      dateKey: dateKey,
      plannedCount: queuePlannedCountFromRows_(matches.map(function(item) { return item.values; })),
      adjustedTarget: queueAdjustedTargetFromRowsV4_(matches.map(function(item) { return item.values; })),
      queueKind: stringValue_(matches[0].values[headers['Queue Kind']]) || 'primary'
    };
  });
  var active = queues.filter(function(queue) {
    return queue.status === 'planned' || queue.status === 'presented';
  });
  if (active.length > 1) throw new Error('Today has more than one active v4 Queue ID.');
  if (active.length === 1) return active[0];
  var completed = queues.filter(function(queue) { return queue.status === 'committed'; });
  if (!completed.length) return null;
  completed.sort(function(a, b) { return a.queueId < b.queueId ? 1 : -1; });
  return completed[0];
}

function validatePreparedQuestionBatchV4_(ss, queue) {
  var sheet = requireSheet_(ss, ER4.questionSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_QUESTION_HEADERS, ER4.questionSheet);
  var groups = {};
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers['Queue ID']]) === queue.queueId &&
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion
    ) {
      var status = stringValue_(values[i][headers['Question Status']]).toLowerCase();
      if (['staged', 'ready', 'bound'].indexOf(status) === -1) continue;
      var generationId = stringValue_(values[i][headers['Generation ID']]);
      if (!generationId) throw new Error('Session Questions contains a row without Generation ID.');
      if (!groups[generationId]) groups[generationId] = [];
      groups[generationId].push({ rowNumber: i + 1, values: values[i] });
    }
  }
  var generationIds = Object.keys(groups);
  if (!generationIds.length) return null;
  // Existing bound rows win over later staging segments. This lets an active
  // daily set grow from 20 to 40 without replacing questions whose answers the
  // user has already revealed and locked.
  generationIds.sort(function(a, b) {
    var aBound = groups[a].some(function(item) {
      return stringValue_(item.values[headers['Question Status']]).toLowerCase() === 'bound';
    });
    var bBound = groups[b].some(function(item) {
      return stringValue_(item.values[headers['Question Status']]).toLowerCase() === 'bound';
    });
    if (aBound !== bBound) return aBound ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  var positionOwner = {};
  var allItems = [];
  var groupHashes = [];
  generationIds.forEach(function(generationId) {
    var items = groups[generationId];
    items.sort(function(a, b) {
      return Number(a.values[headers.Position]) - Number(b.values[headers.Position]);
    });
    var hasBound = items.some(function(item) {
      return stringValue_(item.values[headers['Question Status']]).toLowerCase() === 'bound';
    });
    try {
      validateQuestionItemsV4_(items, headers, queue);
      items.forEach(function(item) {
        var position = Number(item.values[headers.Position]);
        if (positionOwner[position]) {
          throw new Error(
            'Question position ' + position + ' is active in more than one Generation ID.'
          );
        }
      });
    } catch (error) {
      if (!hasBound) {
        items.forEach(function(item) {
          sheet.getRange(item.rowNumber, headers['Question Status'] + 1).setValue('rejected');
        });
        SpreadsheetApp.flush();
      }
      throw error;
    }
    var groupHash = questionContentHashV4_(items, headers);
    items.forEach(function(item) {
      var position = Number(item.values[headers.Position]);
      var rowStatus = stringValue_(item.values[headers['Question Status']]).toLowerCase();
      if (rowStatus === 'staged') {
        sheet.getRange(item.rowNumber, headers['Content Hash'] + 1).setValue(groupHash);
        sheet.getRange(item.rowNumber, headers['Question Status'] + 1).setValue('ready');
        item.values[headers['Content Hash']] = groupHash;
        item.values[headers['Question Status']] = 'ready';
      } else if (stringValue_(item.values[headers['Content Hash']]) !== groupHash) {
        throw new Error('Published question content hash mismatch in ' + generationId + '.');
      }
      positionOwner[position] = generationId;
      allItems.push(item);
    });
    groupHashes.push([generationId, groupHash]);
  });
  SpreadsheetApp.flush();

  if (allItems.length < queue.plannedCount) return null;
  if (allItems.length !== queue.plannedCount) {
    throw new Error('Active question rows exceed the Daily Queue Planned Count.');
  }
  for (var position = 1; position <= queue.plannedCount; position++) {
    if (!positionOwner[position]) {
      throw new Error('Question preparation is missing position ' + position + '.');
    }
  }
  allItems.sort(function(a, b) {
    return Number(a.values[headers.Position]) - Number(b.values[headers.Position]);
  });
  return {
    sheet: sheet,
    headers: headers,
    rows: allItems,
    generationIds: generationIds,
    generationId: generationIds.join(','),
    contentHash: hashV4_(groupHashes)
  };
}

function questionContentHashV4_(items, headers) {
  return hashV4_(items.map(function(item) {
    var row = item.values;
    return [
      Number(row[headers.Position]),
      stringValue_(row[headers['Phrase ID']]),
      stringValue_(row[headers['Candidate ID']]),
      stringValue_(row[headers['Question Type']]),
      stringValue_(row[headers['Prompt ZH']]),
      stringValue_(row[headers['Prompt EN']]),
      stringValue_(row[headers['Expected Answers JSON']]),
      stringValue_(row[headers['Accepted Variants JSON']]),
      stringValue_(row[headers['Semantic Boundary']]),
      stringValue_(row[headers['Grading Rubric']])
    ];
  }));
}

function validateQuestionItemsV4_(items, headers, queue) {
  var plannedCount = queue.plannedCount || queue.rows.length;
  if (!items.length || items.length > plannedCount) {
    throw new Error('Question staging segment has an invalid cardinality.');
  }
  var queueByPosition = {};
  queue.rows.forEach(function(item) {
    queueByPosition[Number(item.values[queue.headers.Position])] = item.values;
  });
  var positions = {};
  items.forEach(function(item) {
    var row = item.values;
    var position = Number(row[headers.Position]);
    if (position < 1 || position > plannedCount || positions[position]) {
      throw new Error('Question batch has an invalid or duplicate position: ' + position + '.');
    }
    positions[position] = true;
    var queueRow = queueByPosition[position];
    if (!queueRow) throw new Error('Question position does not exist in Daily Queue: ' + position + '.');
    ['Phrase ID', 'Candidate ID'].forEach(function(header) {
      if (
        stringValue_(row[headers[header]]) !==
        stringValue_(queueRow[queue.headers[header]])
      ) {
        throw new Error('Question identity mismatch at position ' + position + '.');
      }
    });
    var questionType = stringValue_(row[headers['Question Type']]).toLowerCase();
    if (ER4_QUESTION_TYPES.indexOf(questionType) === -1) {
      throw new Error('Unsupported Question Type at position ' + position + '.');
    }
    var promptZh = stringValue_(row[headers['Prompt ZH']]);
    var promptEn = stringValue_(row[headers['Prompt EN']]);
    if (!promptZh && !promptEn) throw new Error('Question prompt is blank at position ' + position + '.');
    var expected = parseJsonArrayV4_(row[headers['Expected Answers JSON']], 'Expected Answers JSON', position);
    parseJsonArrayV4_(row[headers['Accepted Variants JSON']], 'Accepted Variants JSON', position);
    if (!stringValue_(row[headers['Semantic Boundary']])) {
      throw new Error('Semantic Boundary is blank at position ' + position + '.');
    }
    if (!stringValue_(row[headers['Grading Rubric']])) {
      throw new Error('Grading Rubric is blank at position ' + position + '.');
    }
    var visible = normalizeChunk_((promptZh + ' ' + promptEn).toLowerCase());
    expected.forEach(function(answer) {
      var normalized = normalizeChunk_(answer);
      if (normalized.length > 2 && visible.indexOf(normalized) !== -1) {
        throw new Error('Question reveals an expected answer at position ' + position + '.');
      }
    });
  });
}

function startOrResumeReviewSessionV4_(ss, queue, batch) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    queue = findQueueForDateV4_(ss, queue.dateKey);
    batch = validatePreparedQuestionBatchV4_(ss, queue);
    if (!batch) throw new Error('Question batch is no longer available.');

    var sessionId = queue.sessionId;
    var presentedAt = null;
    if (queue.status === 'planned') {
      sessionId = allocateSessionIdV4_(ss, queue.dateKey);
      presentedAt = new Date();
      queue.rows.forEach(function(item) {
        queue.sheet.getRange(item.rowNumber, queue.headers['Queue Status'] + 1).setValue('presented');
        queue.sheet.getRange(item.rowNumber, queue.headers['Session ID'] + 1).setValue(sessionId);
        queue.sheet.getRange(item.rowNumber, queue.headers['Presented At'] + 1)
          .setValue(presentedAt)
          .setNumberFormat('yyyy-mm-dd hh:mm:ss');
      });
      batch.rows.forEach(function(item) {
        batch.sheet.getRange(item.rowNumber, batch.headers['Question Status'] + 1).setValue('bound');
        batch.sheet.getRange(item.rowNumber, batch.headers['Session ID'] + 1).setValue(sessionId);
        batch.sheet.getRange(item.rowNumber, batch.headers['Bound At'] + 1)
          .setValue(presentedAt)
          .setNumberFormat('yyyy-mm-dd hh:mm:ss');
      });
      SpreadsheetApp.flush();
    } else if (queue.status === 'presented') {
      if (!sessionId) throw new Error('Presented Queue is missing Session ID.');
      var presentedValues = uniqueDateTimesV4_(queue.rows.map(function(item) {
        return item.values[queue.headers['Presented At']];
      }));
      if (presentedValues.length !== 1) {
        throw new Error('Presented Queue does not have one shared Presented At timestamp.');
      }
      presentedAt = queue.rows[0].values[queue.headers['Presented At']];
      batch.rows.forEach(function(item) {
        var status = stringValue_(
          item.values[batch.headers['Question Status']]
        ).toLowerCase();
        var boundSession = stringValue_(item.values[batch.headers['Session ID']]);
        if (status === 'bound') {
          if (boundSession !== sessionId) {
            throw new Error('A bound question belongs to a different Session.');
          }
          return;
        }
        if (status !== 'ready' || boundSession) {
          throw new Error('A newly prepared question is not ready for Session binding.');
        }
        batch.sheet.getRange(item.rowNumber, batch.headers['Question Status'] + 1)
          .setValue('bound');
        batch.sheet.getRange(item.rowNumber, batch.headers['Session ID'] + 1)
          .setValue(sessionId);
        batch.sheet.getRange(item.rowNumber, batch.headers['Bound At'] + 1)
          .setValue(presentedAt)
          .setNumberFormat('yyyy-mm-dd hh:mm:ss');
      });
      SpreadsheetApp.flush();
    } else {
      throw new Error('Queue cannot start from status ' + queue.status + '.');
    }

    var readbackQueue = findQueueForDateV4_(ss, queue.dateKey);
    if (
      readbackQueue.status !== 'presented' ||
      readbackQueue.sessionId !== sessionId ||
      readbackQueue.rows.length !== readbackQueue.plannedCount
    ) {
      throw new Error('Session opening readback failed.');
    }
    var readbackBatch = validatePreparedQuestionBatchV4_(ss, readbackQueue);
    var boundSessions = uniqueStringsV4_(readbackBatch.rows.map(function(item) {
      return stringValue_(item.values[readbackBatch.headers['Session ID']]);
    }));
    if (boundSessions.length !== 1 || boundSessions[0] !== sessionId) {
      throw new Error('Question binding readback failed.');
    }
    return buildQuizResponseV4_(ss, readbackQueue, readbackBatch, presentedAt);
  } finally {
    lock.releaseLock();
  }
}

function allocateSessionIdV4_(ss, dateKey) {
  var sheet = requireSheet_(ss, 'Session Log');
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ['Session ID', 'Date'], 'Session Log');
  var maxSequence = 0;
  var pattern = new RegExp('^' + dateKey.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '-English-SRS-(\\d{3})$');
  for (var i = 1; i < values.length; i++) {
    var match = stringValue_(values[i][headers['Session ID']]).match(pattern);
    if (match) maxSequence = Math.max(maxSequence, Number(match[1]));
  }
  return dateKey + '-English-SRS-' + String(maxSequence + 1).padStart(3, '0');
}

function buildQuizResponseV4_(ss, queue, batch, presentedAt) {
  var drafts = readDraftsForSessionV4_(ss, queue.sessionId);
  var draftByPosition = {};
  drafts.forEach(function(item) { draftByPosition[item.position] = item; });
  var visiblePositions = {};
  var visibleCount = 0;
  drafts.forEach(function(draft) {
    if (isDraftRevealedV4_(draft, queue.sessionId)) {
      visiblePositions[draft.position] = true;
      visibleCount++;
    }
  });
  var desiredVisibleCount = Math.max(Number(queue.adjustedTarget) || 0, visibleCount);
  batch.rows.slice().sort(function(a, b) {
    return Number(a.values[batch.headers.Position]) - Number(b.values[batch.headers.Position]);
  }).forEach(function(item) {
    var position = Number(item.values[batch.headers.Position]);
    if (!visiblePositions[position] && visibleCount < desiredVisibleCount) {
      visiblePositions[position] = true;
      visibleCount++;
    }
  });
  var questions = batch.rows.filter(function(item) {
    return visiblePositions[Number(item.values[batch.headers.Position])];
  }).map(function(item) {
    var row = item.values;
    var position = Number(row[batch.headers.Position]);
    var draft = draftByPosition[position] || {
      answer: '',
      revision: 0,
      submitStatus: '',
      submissionId: '',
      answerHash: ''
    };
    var revealed = isDraftRevealedV4_(draft, queue.sessionId);
    return {
      position: position,
      questionType: stringValue_(row[batch.headers['Question Type']]),
      promptZh: stringValue_(row[batch.headers['Prompt ZH']]),
      promptEn: stringValue_(row[batch.headers['Prompt EN']]),
      answer: draft.answer,
      revision: draft.revision,
      revealed: revealed,
      locked: revealed,
      // This is intentionally preloaded for the single-user study app. The
      // browser keeps it in memory and the UI only renders it after reveal.
      expectedAnswer: expectedAnswerForQuestionRowV4_(row, batch.headers, position)
    };
  });
  questions.sort(function(a, b) { return a.position - b.position; });
  var journal = findJournalBySessionV4_(ss, queue.sessionId);
  if (journal) return responseForJournalV4_(journal);
  var countSettings = readQuestionCountSettingsV4_(ss, queue.dateKey);
  var completedBeforeBatch = completedQuestionsForDateV4_(ss, queue.dateKey, queue.sessionId);
  questions.forEach(function(question, index) {
    question.displayPosition = completedBeforeBatch + index + 1;
  });
  return {
    ok: true,
    state: 'answering',
    sessionId: queue.sessionId,
    queueId: queue.queueId,
    presentedAt: formatDateTimeV4_(presentedAt),
    generationId: batch.generationId,
    contentHash: batch.contentHash,
    queueMeta: {
      planned: queue.plannedCount || queue.rows.length,
      adjustedTarget: queue.adjustedTarget == null
        ? (queue.plannedCount || queue.rows.length)
        : queue.adjustedTarget,
      requested: countSettings.targetCount,
      completedBeforeBatch: completedBeforeBatch,
      queueKind: queue.queueKind || 'primary',
      due: queue.rows.filter(function(item) {
        return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() !== 'new';
      }).length,
      fresh: queue.rows.filter(function(item) {
        return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() === 'new';
      }).length
    },
    questions: questions,
    chatGptTaskUrl: ER4.chatGptTaskUrl,
    chatGptManualUrl: ER4.chatGptManualUrl
  };
}

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
        submitStatus: stringValue_(values[i][headers['Submit Status']]),
        submissionId: stringValue_(values[i][headers['Submission ID']]),
        answerHash: stringValue_(values[i][headers['Answer Hash']])
      });
    }
  }
  return rows;
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

function expectedAnswerForQuestionRowV4_(row, headers, position) {
  return parseJsonArrayV4_(
    row[headers['Expected Answers JSON']],
    'Expected Answers JSON',
    position
  )[0];
}

function saveDraftV4(sessionId, position, answer, expectedRevision) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    position = Number(position);
    answer = stringValue_(answer);
    expectedRevision = Number(expectedRevision) || 0;
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
        answer: currentAnswer
      };
    }
    if (currentRevision !== expectedRevision) {
      return {
        ok: false,
        conflict: true,
        position: position,
        revision: currentRevision,
        answer: existingRow ? stringValue_(values[existingRow - 1][headers.Answer]) : ''
      };
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
    return { ok: true, position: position, revision: revision, answer: answer };
  } finally {
    lock.releaseLock();
  }
}

function revealAnswerV4(sessionId, position, answer, expectedRevision) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    sessionId = stringValue_(sessionId);
    position = Number(position);
    answer = stringValue_(answer);
    expectedRevision = Number(expectedRevision) || 0;
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
      answerHash: stringValue_(item.values[headers['Answer Hash']])
    } : {
      position: position,
      answer: '',
      revision: 0,
      submitStatus: '',
      submissionId: '',
      answerHash: ''
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
      return {
        ok: true,
        position: position,
        revision: current.revision,
        answer: current.answer,
        revealed: true,
        locked: true,
        expectedAnswer: expectedAnswer
      };
    }
    if (item && (
      current.answerHash ||
      stringValue_(current.submitStatus).toLowerCase() !== 'draft' ||
      current.submissionId
    )) {
      throw new Error('The draft cannot be revealed from its current state.');
    }
    // The reveal call is also the background save. An autosave may win the
    // script lock first, so accept a same-answer draft at a newer revision;
    // a different answer still requires the normal conflict flow.
    if (
      (!item && expectedRevision !== 0) ||
      (item && current.revision < expectedRevision) ||
      (item && current.answer !== answer)
    ) {
      return {
        ok: false,
        conflict: true,
        position: position,
        revision: current.revision,
        answer: current.answer
      };
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
    return {
      ok: true,
      position: position,
      revision: nextRevision,
      answer: answer,
      revealed: true,
      locked: true,
      expectedAnswer: expectedAnswer
    };
  } finally {
    lock.releaseLock();
  }
}

function submitSessionV4(sessionId, answers) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
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
    response.queueMeta = {
      planned: queue.plannedCount,
      adjustedTarget: queue.adjustedTarget,
      requested: settings.targetCount,
      completedBeforeBatch: completedQuestionsForDateV4_(ss, queue.dateKey, queue.sessionId),
      completedInBatch: readDraftsForSessionV4_(ss, queue.sessionId).filter(function(item) {
        return stringValue_(item.submitStatus).toLowerCase() === 'submitted';
      }).length,
      queueKind: queue.queueKind,
      due: queue.rows.filter(function(item) {
        return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() !== 'new';
      }).length,
      fresh: queue.rows.filter(function(item) {
        return stringValue_(item.values[queue.headers['Selection Type']]).toLowerCase() === 'new';
      }).length
    };
  }
  if (journal.resultJson) {
    try { response.result = JSON.parse(journal.resultJson); } catch (ignore) {}
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
    details.count = queue.plannedCount;
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
  return {
    complete: true,
    rows: staged.rows,
    gradingBatchId: gradingBatchIds.join(','),
    gradingBatchIds: gradingBatchIds,
    grades: grades,
    candidateSuggestions: suggestions
  };
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
  if (!Array.isArray(snapshot.candidateSuggestions) || !Array.isArray(plan.suggestionPlans)) {
    throw new Error('Frozen candidate replenishment plan is missing.');
  }
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
          rowNumber + ')),"")'
        );
      sheet.getRange(rowNumber, headers['Times Seen'] + 1)
        .setFormula('=COUNTIF(\'Review Log\'!$H$2:$H,$A' + rowNumber + ')');
      sheet.getRange(rowNumber, headers['Times Correct'] + 1)
        .setFormula(
          '=COUNTIFS(\'Review Log\'!$H$2:$H,$A' + rowNumber +
          ',\'Review Log\'!$G$2:$G,"normal")+COUNTIFS(\'Review Log\'!$H$2:$H,$A' +
          rowNumber + ',\'Review Log\'!$G$2:$G,"mastered")'
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
function saveContextV4(payload) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  payload = payload || {};
  var rawText = String(payload.rawText == null ? '' : payload.rawText).replace(/\r\n?/g, '\n');
  if (!rawText.trim()) throw new Error('请先粘贴英文句子或自然段。');
  if (rawText.length > ER4.maxContextLength) {
    throw new Error('原文过长；单条语料最多 ' + ER4.maxContextLength + ' 个字符。');
  }
  var spans = validateContextSpansV4_(rawText, payload.selectedSpans || []);
  var sourceUrl = validateContextUrlV4_(payload.sourceUrl);
  var sourceTitle = limitedContextTextV4_(payload.sourceTitle, 300, '来源标题');
  var userNote = limitedContextTextV4_(payload.userNote, 2000, '备注');
  var requestId = stringValue_(payload.requestId);
  if (!/^[A-Za-z0-9._:-]{12,220}$/.test(requestId)) {
    throw new Error('语料提交标识无效，请刷新页面后重试。');
  }

  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    var sheet = requireSheet_(ss, ER4.contextSheet);
    var values = sheet.getDataRange().getValues();
    var headers = headerMap_(values[0]);
    requireHeaders_(headers, ER4_CONTEXT_HEADERS, ER4.contextSheet);
    var nextNumber = 0;
    for (var i = 1; i < values.length; i++) {
      var existingId = stringValue_(values[i][headers['Context ID']]);
      nextNumber = Math.max(nextNumber, numericSuffixV4_(existingId, 'CTX-'));
      if (stringValue_(values[i][headers['Capture Request ID']]) === requestId) {
        return {
          ok: true,
          idempotent: true,
          contextId: existingId,
          status: stringValue_(values[i][headers['Processing Status']])
        };
      }
    }
    var contextId = 'CTX-' + String(nextNumber + 1).padStart(6, '0');
    var createdAt = new Date();
    var row = [
      contextId,
      rawText,
      JSON.stringify(spans),
      sourceUrl,
      sourceTitle,
      userNote,
      'pending',
      '',
      createdAt,
      '',
      requestId,
      ER4.contractVersion
    ];
    var rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, headers['Contract Version'] + 1).setNumberFormat('@');
    sheet.getRange(rowNumber, 1, 1, ER4_CONTEXT_HEADERS.length).setValues([row]);
    sheet.getRange(rowNumber, headers['Created At'] + 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(rowNumber, headers['Contract Version'] + 1)
      .setNumberFormat('@')
      .setValue(ER4.contractVersion);
    SpreadsheetApp.flush();
    var readback = sheet.getRange(rowNumber, 1, 1, ER4_CONTEXT_HEADERS.length).getValues()[0];
    if (
      stringValue_(readback[headers['Context ID']]) !== contextId ||
      stringValue_(readback[headers['Raw Text']]) !== rawText ||
      stringValue_(readback[headers['Selected Spans JSON']]) !== JSON.stringify(spans) ||
      stringValue_(readback[headers['Processing Status']]) !== 'pending' ||
      stringValue_(readback[headers['Capture Request ID']]) !== requestId ||
      stringValue_(readback[headers['Contract Version']]) !== ER4.contractVersion
    ) {
      throw new Error('语料保存后的精确回读不一致。');
    }
    return { ok: true, contextId: contextId, status: 'pending', selectedSpanCount: spans.length };
  } finally {
    lock.releaseLock();
  }
}

function getContextInboxV4() {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    reconcileContextStatusesV4_(ss);
    var contextTable = readDashboardTableV4_(ss, ER4.contextSheet, ER4_CONTEXT_HEADERS);
    var proposalTable = readDashboardTableV4_(
      ss,
      ER4.contextCandidateSheet,
      ER4_CONTEXT_CANDIDATE_HEADERS
    );
    var proposalsByContext = {};
    proposalTable.rows.forEach(function(row) {
      if (dashboardStringV4_(row, proposalTable.headers, 'Contract Version') !== ER4.contractVersion) return;
      var contextId = dashboardStringV4_(row, proposalTable.headers, 'Context ID');
      if (!contextId) return;
      if (!proposalsByContext[contextId]) proposalsByContext[contextId] = [];
      proposalsByContext[contextId].push(contextProposalPayloadV4_(row, proposalTable.headers));
    });
    Object.keys(proposalsByContext).forEach(function(contextId) {
      proposalsByContext[contextId].sort(function(a, b) { return a.position - b.position; });
    });
    var items = contextTable.rows.map(function(row) {
      var contextId = dashboardStringV4_(row, contextTable.headers, 'Context ID');
      if (!contextId) return null;
      return {
        contextId: contextId,
        rawText: dashboardStringV4_(row, contextTable.headers, 'Raw Text'),
        selectedSpans: parseContextSpansV4_(
          dashboardStringV4_(row, contextTable.headers, 'Selected Spans JSON')
        ),
        sourceUrl: dashboardStringV4_(row, contextTable.headers, 'Source URL'),
        sourceTitle: dashboardStringV4_(row, contextTable.headers, 'Source Title'),
        userNote: dashboardStringV4_(row, contextTable.headers, 'User Note'),
        status: dashboardStringV4_(row, contextTable.headers, 'Processing Status'),
        processingBatchId: dashboardStringV4_(row, contextTable.headers, 'Processing Batch ID'),
        createdAt: dashboardTimestampV4_(row[contextTable.headers['Created At']]),
        processedAt: dashboardTimestampV4_(row[contextTable.headers['Processed At']]),
        proposals: proposalsByContext[contextId] || []
      };
    }).filter(Boolean).sort(function(a, b) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }).slice(0, 50);
    var counts = { pending: 0, needsDecision: 0, committed: 0, errors: 0 };
    items.forEach(function(item) {
      if (item.status === 'pending' || item.status === 'processing') counts.pending++;
      if (item.status === 'error' || item.status === 'needs_review') counts.errors++;
      item.proposals.forEach(function(proposal) {
        if (proposal.decisionStatus === 'staged') counts.needsDecision++;
        if (proposal.decisionStatus === 'committed') counts.committed++;
      });
    });
    return {
      ok: true,
      generatedAt: Utilities.formatDate(new Date(), ER4.timezone, 'yyyy-MM-dd HH:mm:ss'),
      counts: counts,
      items: items,
      processingPrompt: ER4_CONTEXT_PROCESSING_PROMPT,
      contextProcessingConversationUrl: ER4.contextProcessingConversationUrl
    };
  } finally {
    lock.releaseLock();
  }
}

function decideContextCandidateV4(contextId, proposalPosition, action, editedCandidate) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  contextId = stringValue_(contextId);
  proposalPosition = Number(proposalPosition);
  action = stringValue_(action).toLowerCase();
  if (!/^CTX-\d{6,}$/.test(contextId)) throw new Error('无效的 Context ID。');
  if (!Number.isInteger(proposalPosition) || proposalPosition < 0 || proposalPosition > ER4.maxContextProposals) {
    throw new Error('无效的语料建议位置。');
  }
  if (['accept', 'edit', 'reject', 'known', 'explanation_only'].indexOf(action) === -1) {
    throw new Error('不支持的语料建议操作。');
  }
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assertContractV4_(ss);
    var context = findContextRowV4_(ss, contextId);
    var staged = findContextCandidateRowV4_(ss, contextId, proposalPosition);
    var sheet = staged.sheet;
    var h = staged.headers;
    var rowNumber = staged.rowNumber;
    var row = staged.values;
    var currentStatus = stringValue_(row[h['Decision Status']]).toLowerCase();
    if (currentStatus === 'committed') {
      return {
        ok: true,
        idempotent: true,
        contextId: contextId,
        proposalPosition: proposalPosition,
        decisionStatus: currentStatus,
        candidateId: stringValue_(row[h['Candidate ID']])
      };
    }
    if (['duplicate', 'rejected', 'known', 'explanation_only', 'invalid'].indexOf(currentStatus) !== -1) {
      return {
        ok: true,
        idempotent: true,
        contextId: contextId,
        proposalPosition: proposalPosition,
        decisionStatus: currentStatus,
        candidateId: stringValue_(row[h['Candidate ID']])
      };
    }
    if (currentStatus !== 'staged' && currentStatus !== 'accepted' && currentStatus !== 'edited') {
      throw new Error('该建议当前不可处理：' + currentStatus + '。');
    }
    if (action === 'reject' || action === 'known' || action === 'explanation_only') {
      var terminalStatus = action === 'reject' ? 'rejected' : action;
      sheet.getRange(rowNumber, h['Decision Status'] + 1).setValue(terminalStatus);
      SpreadsheetApp.flush();
      if (stringValue_(sheet.getRange(rowNumber, h['Decision Status'] + 1).getValue()) !== terminalStatus) {
        throw new Error('语料建议决策回读失败。');
      }
      return {
        ok: true,
        contextId: contextId,
        proposalPosition: proposalPosition,
        decisionStatus: terminalStatus
      };
    }

    var candidate = action === 'edit'
      ? limitedContextTextV4_(editedCandidate, 120, '修改后的搭配')
      : stringValue_(row[h.Candidate]);
    if (!candidate || !normalizeChunk_(candidate) || candidate.length > 120) {
      throw new Error('候选搭配无效。');
    }
    if (stringValue_(row[h['Candidate Type']]).toLowerCase() !== 'chunk') {
      throw new Error('只有 chunk 类型建议可以进入候选池。');
    }
    var chineseCue = stringValue_(row[h['Chinese Cue']]);
    var topic = stringValue_(row[h.Topic]);
    var difficulty = stringValue_(row[h.Difficulty]).toLowerCase();
    var naturalExample = stringValue_(row[h['Natural Example']]);
    if (!chineseCue || !topic || ['easy', 'medium', 'hard'].indexOf(difficulty) === -1 || !naturalExample) {
      throw new Error('建议缺少进入 Candidate Bank 所需的结构化字段。');
    }
    var duplicate = findContextCandidateDuplicateV4_(ss, candidate);
    if (duplicate) {
      sheet.getRange(rowNumber, h['Decision Status'] + 1).setValue('duplicate');
      if (duplicate.candidateId) {
        sheet.getRange(rowNumber, h['Candidate ID'] + 1).setValue(duplicate.candidateId);
      }
      SpreadsheetApp.flush();
      return {
        ok: true,
        contextId: contextId,
        proposalPosition: proposalPosition,
        decisionStatus: 'duplicate',
        duplicate: duplicate
      };
    }

    ensureCandidateMetadataColumns_(ss);
    var candidateSheet = requireSheet_(ss, DQ3.candidateSheet);
    var candidateValues = candidateSheet.getDataRange().getValues();
    var candidateHeaders = headerMap_(candidateValues[0]);
    var candidateRequired = [
      'Candidate ID', 'Date Added', 'Candidate', 'Candidate Type', 'Source',
      'Context', 'Why Useful', 'Status', 'Promoted Phrase ID', 'Date Promoted',
      'Deferral Reason', 'Source Note Row', '中文提示', 'Topic', 'Difficulty',
      'Natural Example', 'Common Mistake', 'Origin Type', 'Origin Context ID',
      'Selected Text', 'Source URL', 'Intake Priority'
    ];
    requireHeaders_(candidateHeaders, candidateRequired, DQ3.candidateSheet);
    var nextCandidateNumber = 0;
    for (var c = 1; c < candidateValues.length; c++) {
      nextCandidateNumber = Math.max(
        nextCandidateNumber,
        numericSuffixV4_(candidateValues[c][candidateHeaders['Candidate ID']], 'CAN-')
      );
    }
    var candidateId = 'CAN-' + String(nextCandidateNumber + 1).padStart(4, '0');
    var dateAdded = parseDateKey_(formatDateKey_(new Date()));
    var selectedText = stringValue_(row[h['Selected Text']]);
    var sourceUrl = stringValue_(context.values[context.headers['Source URL']]);
    var candidateRow = [
      candidateId,
      dateAdded,
      candidate,
      'chunk',
      'user_context',
      stringValue_(row[h['Context Meaning']]) || stringValue_(context.values[context.headers['Raw Text']]),
      stringValue_(row[h['Why Useful']]),
      'ready',
      '',
      '',
      '',
      '',
      chineseCue,
      topic,
      difficulty,
      naturalExample,
      stringValue_(row[h['Common Mistake']]),
      'user_context',
      contextId,
      selectedText,
      sourceUrl,
      'high'
    ];
    var candidateRowNumber = candidateSheet.getLastRow() + 1;
    candidateSheet.getRange(candidateRowNumber, 1, 1, candidateRequired.length).setValues([candidateRow]);
    candidateSheet.getRange(candidateRowNumber, candidateHeaders['Date Added'] + 1)
      .setNumberFormat('yyyy-mm-dd');
    SpreadsheetApp.flush();
    var candidateReadback = candidateSheet.getRange(
      candidateRowNumber,
      1,
      1,
      candidateRequired.length
    ).getValues()[0];
    if (
      stringValue_(candidateReadback[candidateHeaders['Candidate ID']]) !== candidateId ||
      normalizeChunk_(candidateReadback[candidateHeaders.Candidate]) !== normalizeChunk_(candidate) ||
      stringValue_(candidateReadback[candidateHeaders.Status]).toLowerCase() !== 'ready' ||
      stringValue_(candidateReadback[candidateHeaders['Origin Type']]) !== 'user_context' ||
      stringValue_(candidateReadback[candidateHeaders['Origin Context ID']]) !== contextId
    ) {
      throw new Error('Candidate Bank 正式写入后的精确回读不一致。');
    }
    if (action === 'edit') {
      sheet.getRange(rowNumber, h['Edited Candidate'] + 1).setValue(candidate);
    }
    sheet.getRange(rowNumber, h['Decision Status'] + 1).setValue('committed');
    sheet.getRange(rowNumber, h['Committed At'] + 1)
      .setValue(new Date())
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(rowNumber, h['Candidate ID'] + 1).setValue(candidateId);
    SpreadsheetApp.flush();
    var decisionReadback = sheet.getRange(rowNumber, 1, 1, ER4_CONTEXT_CANDIDATE_HEADERS.length)
      .getValues()[0];
    if (
      stringValue_(decisionReadback[h['Decision Status']]) !== 'committed' ||
      stringValue_(decisionReadback[h['Candidate ID']]) !== candidateId
    ) {
      throw new Error('语料建议提交状态回读失败。');
    }
    invalidateLearningDashboardCacheV4_();
    return {
      ok: true,
      contextId: contextId,
      proposalPosition: proposalPosition,
      decisionStatus: 'committed',
      candidateId: candidateId,
      candidate: candidate
    };
  } finally {
    lock.releaseLock();
  }
}

function validateContextSpansV4_(rawText, spans) {
  if (typeof spans === 'string') {
    try { spans = JSON.parse(spans); } catch (error) { throw new Error('标记数据不是合法 JSON。'); }
  }
  if (!Array.isArray(spans)) throw new Error('标记数据格式无效。');
  if (spans.length > 20) throw new Error('单条语料最多标记 20 处。');
  var normalized = spans.map(function(span) {
    var start = Number(span && span.start);
    var end = Number(span && span.end);
    var text = String(span && span.text == null ? '' : span.text);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > rawText.length || start >= end) {
      throw new Error('存在越界或为空的原文标记。');
    }
    if (rawText.slice(start, end) !== text) throw new Error('原文已变化，请重新标记不懂的部分。');
    return { text: text, start: start, end: end };
  }).sort(function(a, b) { return a.start - b.start || a.end - b.end; });
  for (var i = 1; i < normalized.length; i++) {
    if (normalized[i].start < normalized[i - 1].end) throw new Error('第一版不允许重叠标记。');
    if (normalized[i].start === normalized[i - 1].start && normalized[i].end === normalized[i - 1].end) {
      throw new Error('请勿重复标记同一段文字。');
    }
  }
  return normalized;
}

function parseContextSpansV4_(value) {
  if (!value) return [];
  try {
    var parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (ignore) {
    return [];
  }
}

function validateContextUrlV4_(value) {
  value = stringValue_(value);
  if (!value) return '';
  if (value.length > 2048 || !/^https?:\/\/[^\s]+$/i.test(value)) {
    throw new Error('来源链接必须是有效的 http 或 https 地址。');
  }
  return value;
}

function limitedContextTextV4_(value, maxLength, label) {
  value = stringValue_(value);
  if (value.length > maxLength) throw new Error(label + '最多 ' + maxLength + ' 个字符。');
  return value;
}

function findContextRowV4_(ss, contextId) {
  var sheet = requireSheet_(ss, ER4.contextSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_CONTEXT_HEADERS, ER4.contextSheet);
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][headers['Context ID']]) === contextId) {
      matches.push({ sheet: sheet, headers: headers, rowNumber: i + 1, values: values[i] });
    }
  }
  if (matches.length !== 1) throw new Error('Context ID 必须精确命中一行；当前命中 ' + matches.length + ' 行。');
  return matches[0];
}

function findContextCandidateRowV4_(ss, contextId, proposalPosition) {
  var sheet = requireSheet_(ss, ER4.contextCandidateSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  requireHeaders_(headers, ER4_CONTEXT_CANDIDATE_HEADERS, ER4.contextCandidateSheet);
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers['Context ID']]) === contextId &&
      Number(values[i][headers['Proposal Position']]) === proposalPosition &&
      stringValue_(values[i][headers['Contract Version']]) === ER4.contractVersion
    ) {
      matches.push({ sheet: sheet, headers: headers, rowNumber: i + 1, values: values[i] });
    }
  }
  if (matches.length !== 1) {
    throw new Error('语料建议必须精确命中一行；当前命中 ' + matches.length + ' 行。');
  }
  return matches[0];
}

function contextProposalPayloadV4_(row, h) {
  return {
    position: Number(row[h['Proposal Position']]) || 0,
    selectedText: stringValue_(row[h['Selected Text']]),
    candidate: stringValue_(row[h.Candidate]),
    chineseCue: stringValue_(row[h['Chinese Cue']]),
    candidateType: stringValue_(row[h['Candidate Type']]),
    contextMeaning: stringValue_(row[h['Context Meaning']]),
    whyUseful: stringValue_(row[h['Why Useful']]),
    topic: stringValue_(row[h.Topic]),
    difficulty: stringValue_(row[h.Difficulty]),
    naturalExample: stringValue_(row[h['Natural Example']]),
    commonMistake: stringValue_(row[h['Common Mistake']]),
    extractionRationale: stringValue_(row[h['Extraction Rationale']]),
    confidence: Number(row[h.Confidence]) || 0,
    decisionStatus: stringValue_(row[h['Decision Status']]),
    editedCandidate: stringValue_(row[h['Edited Candidate']]),
    processingBatchId: stringValue_(row[h['Processing Batch ID']]),
    candidateId: stringValue_(row[h['Candidate ID']])
  };
}

function reconcileContextStatusesV4_(ss) {
  var contextSheet = requireSheet_(ss, ER4.contextSheet);
  var contextValues = contextSheet.getDataRange().getValues();
  var ch = headerMap_(contextValues[0]);
  requireHeaders_(ch, ER4_CONTEXT_HEADERS, ER4.contextSheet);
  var proposalSheet = requireSheet_(ss, ER4.contextCandidateSheet);
  var proposalValues = proposalSheet.getDataRange().getValues();
  var ph = headerMap_(proposalValues[0]);
  requireHeaders_(ph, ER4_CONTEXT_CANDIDATE_HEADERS, ER4.contextCandidateSheet);
  var byContext = {};
  for (var p = 1; p < proposalValues.length; p++) {
    if (stringValue_(proposalValues[p][ph['Contract Version']]) !== ER4.contractVersion) continue;
    var contextId = stringValue_(proposalValues[p][ph['Context ID']]);
    if (!contextId) continue;
    if (!byContext[contextId]) byContext[contextId] = [];
    byContext[contextId].push(proposalValues[p]);
  }
  for (var c = 1; c < contextValues.length; c++) {
    var id = stringValue_(contextValues[c][ch['Context ID']]);
    var status = stringValue_(contextValues[c][ch['Processing Status']]).toLowerCase();
    var proposals = byContext[id] || [];
    if (!proposals.length || ['rejected', 'error'].indexOf(status) !== -1) continue;
    var batches = dashboardUniqueV4_(proposals.map(function(row) {
      return stringValue_(row[ph['Processing Batch ID']]);
    }).filter(Boolean));
    var nextStatus = batches.length === 1 ? 'processed' : 'error';
    var onlyExplanation = proposals.every(function(row) {
      return stringValue_(row[ph['Candidate Type']]).toLowerCase() === 'explanation_only';
    });
    if (onlyExplanation && batches.length === 1) nextStatus = 'explanation_only';
    contextSheet.getRange(c + 1, ch['Processing Status'] + 1).setValue(nextStatus);
    contextSheet.getRange(c + 1, ch['Processing Batch ID'] + 1).setValue(batches.join(', '));
    if (!contextValues[c][ch['Processed At']]) {
      contextSheet.getRange(c + 1, ch['Processed At'] + 1)
        .setValue(new Date())
        .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    }
  }
  SpreadsheetApp.flush();
}

function findContextCandidateDuplicateV4_(ss, candidate) {
  var key = normalizeChunk_(candidate);
  var candidateSheet = requireSheet_(ss, DQ3.candidateSheet);
  var candidateValues = candidateSheet.getDataRange().getValues();
  var candidateHeaders = headerMap_(candidateValues[0]);
  requireHeaders_(candidateHeaders, ['Candidate ID', 'Candidate'], DQ3.candidateSheet);
  for (var c = 1; c < candidateValues.length; c++) {
    if (normalizeChunk_(candidateValues[c][candidateHeaders.Candidate]) === key) {
      return {
        type: 'candidate',
        candidateId: stringValue_(candidateValues[c][candidateHeaders['Candidate ID']]),
        value: stringValue_(candidateValues[c][candidateHeaders.Candidate])
      };
    }
  }
  var phraseSheet = requireSheet_(ss, DQ3.phraseSheet);
  var phraseValues = phraseSheet.getDataRange().getValues();
  var phraseHeaders = headerMap_(phraseValues[0]);
  requireHeaders_(phraseHeaders, ['ID', 'Chunk', 'Canonical Pattern'], DQ3.phraseSheet);
  for (var p = 1; p < phraseValues.length; p++) {
    if (
      normalizeChunk_(phraseValues[p][phraseHeaders.Chunk]) === key ||
      normalizeChunk_(phraseValues[p][phraseHeaders['Canonical Pattern']]) === key
    ) {
      return {
        type: 'phrase',
        phraseId: stringValue_(phraseValues[p][phraseHeaders.ID]),
        value: stringValue_(phraseValues[p][phraseHeaders.Chunk])
      };
    }
  }
  return null;
}

function dashboardTimestampV4_(value) {
  if (isDateValue_(value)) return Utilities.formatDate(value, ER4.timezone, 'yyyy-MM-dd HH:mm:ss');
  return stringValue_(value);
}

function getLearningDashboardV4() {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  ensureDynamicQuestionCountSchemaV4_(ss);
  var todayKey = formatDateKey_(new Date());
  var cache = CacheService.getUserCache();
  var cacheKey = 'ER4_DASHBOARD_V1_' + todayKey;
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (ignore) {}
  }

  var dashboard = buildLearningDashboardV4_(ss, todayKey);
  try {
    cache.put(cacheKey, JSON.stringify(dashboard), 300);
  } catch (ignore2) {}
  return dashboard;
}

function buildLearningDashboardV4_(ss, todayKey) {
  var phraseTable = readDashboardTableV4_(
    ss,
    'Phrase Bank',
    ['ID', 'Chunk', '中文提示', 'Type', 'Topic', 'Difficulty', 'Status', 'Review Stage',
      'Last Reviewed', 'Next Review', 'Times Seen', 'Times Correct', 'Common Mistake',
      'Natural Example', 'Created Date', 'Mastery Streak', 'Last Result']
  );
  var reviewTable = readDashboardTableV4_(
    ss,
    'Review Log',
    ['Date', 'Session ID', 'Question #', 'User Answer', 'Result', 'Tag', 'Notes',
      'Attempt Type', 'Question Type', 'Affects SRS?']
  );
  var errorTable = readDashboardTableV4_(
    ss,
    'Error Log',
    ['Date', 'Chunk', 'Error Type', 'User Answer', 'Correction', 'Explanation',
      'Phrase ID', 'Session ID']
  );
  var queueTable = readDashboardTableV4_(
    ss,
    DQ3.queueSheet,
    ['Queue Date', 'Queue ID', 'Position', 'Selection Type', 'Queue Status', 'Session ID',
      'Committed At', 'Presented At', 'Contract Version', 'Planned Count',
      'Adjusted Target', 'Queue Kind']
  );
  var questionTable = readDashboardTableV4_(
    ss,
    ER4.questionSheet,
    ['Queue ID', 'Position', 'Generation ID', 'Question Status', 'Session ID', 'Created At',
      'Contract Version']
  );
  var gradeTable = readDashboardTableV4_(
    ss,
    ER4.gradeSheet,
    ['Session ID', 'Position', 'Grade Status', 'Created At', 'Contract Version']
  );
  var journalTable = readDashboardTableV4_(
    ss,
    ER4.journalSheet,
    ['Session ID', 'Status', 'Last Completed Step', 'Updated At', 'Completed At',
      'Readback Status', 'Contract Version']
  );
  var sessionTable = readDashboardTableV4_(
    ss,
    'Session Log',
    ['Session ID', 'Date', 'Questions Logged', 'Database Write Status', 'Readback Status',
      'Contract Version']
  );
  var contextTable = readDashboardTableV4_(ss, ER4.contextSheet, ER4_CONTEXT_HEADERS);
  var contextCandidateTable = readDashboardTableV4_(
    ss,
    ER4.contextCandidateSheet,
    ER4_CONTEXT_CANDIDATE_HEADERS
  );
  var pendingContextCount = contextTable.rows.filter(function(row) {
    var status = dashboardStringV4_(row, contextTable.headers, 'Processing Status').toLowerCase();
    return status === 'pending' || status === 'processing';
  }).length;
  var contextErrorCount = contextTable.rows.filter(function(row) {
    var status = dashboardStringV4_(row, contextTable.headers, 'Processing Status').toLowerCase();
    return status === 'error' || status === 'needs_review';
  }).length;
  var pendingContextDecisionCount = contextCandidateTable.rows.filter(function(row) {
    return dashboardStringV4_(row, contextCandidateTable.headers, 'Decision Status').toLowerCase() === 'staged';
  }).length;
  var latestContextBatch = '';
  contextCandidateTable.rows.forEach(function(row) {
    var batch = dashboardStringV4_(row, contextCandidateTable.headers, 'Processing Batch ID');
    if (batch) latestContextBatch = batch;
  });

  var queueIdentity = {};
  queueTable.rows.forEach(function(row) {
    var sessionId = dashboardStringV4_(row, queueTable.headers, 'Session ID');
    var position = dashboardNumberV4_(row, queueTable.headers, 'Position');
    if (sessionId && position) {
      queueIdentity[sessionId + '|' + position] =
        dashboardStringV4_(row, queueTable.headers, 'Selection Type').toLowerCase();
    }
  });

  var phraseById = {};
  var phraseHistory = {};
  var phrases = [];
  phraseTable.rows.forEach(function(row) {
    var id = dashboardStringV4_(row, phraseTable.headers, 'ID');
    if (!id) return;
    var status = dashboardStringV4_(row, phraseTable.headers, 'Status').toLowerCase();
    var nextReview = dashboardDateKeyV4_(row[phraseTable.headers['Next Review']]);
    var item = {
      id: id,
      chunk: dashboardStringV4_(row, phraseTable.headers, 'Chunk'),
      chineseCue: dashboardStringV4_(row, phraseTable.headers, '中文提示'),
      type: dashboardStringV4_(row, phraseTable.headers, 'Type'),
      topic: dashboardStringV4_(row, phraseTable.headers, 'Topic'),
      difficulty: dashboardStringV4_(row, phraseTable.headers, 'Difficulty'),
      status: status,
      stage: dashboardNumberV4_(row, phraseTable.headers, 'Review Stage'),
      lastReviewed: dashboardDateKeyV4_(row[phraseTable.headers['Last Reviewed']]),
      nextReview: nextReview,
      timesSeen: dashboardNumberV4_(row, phraseTable.headers, 'Times Seen'),
      timesCorrect: dashboardNumberV4_(row, phraseTable.headers, 'Times Correct'),
      commonMistake: dashboardStringV4_(row, phraseTable.headers, 'Common Mistake'),
      naturalExample: dashboardStringV4_(row, phraseTable.headers, 'Natural Example'),
      createdDate: dashboardDateKeyV4_(row[phraseTable.headers['Created Date']]),
      masteryStreak: dashboardNumberV4_(row, phraseTable.headers, 'Mastery Streak'),
      lastResult: dashboardStringV4_(row, phraseTable.headers, 'Last Result').toLowerCase(),
      dueState: status === 'suspended' ? 'paused' :
        (nextReview && nextReview < todayKey ? 'overdue' :
          (nextReview === todayKey ? 'due_today' : 'scheduled'))
    };
    phraseById[id] = item;
    phraseHistory[id] = [];
    phrases.push(item);
  });

  var trendByDate = {};
  var activeDates = {};
  var thirtyStart = dashboardAddDaysV4_(todayKey, -29);
  var sevenStart = dashboardAddDaysV4_(todayKey, -6);
  var reviewRows = [];
  reviewTable.rows.forEach(function(row) {
    var attemptType = dashboardStringV4_(row, reviewTable.headers, 'Attempt Type').toLowerCase();
    var affectsSrs = dashboardStringV4_(row, reviewTable.headers, 'Affects SRS?').toLowerCase();
    if (attemptType && attemptType !== 'primary') return;
    if (affectsSrs && affectsSrs !== 'yes') return;
    var dateKey = dashboardDateKeyV4_(row[reviewTable.headers.Date]);
    var result = dashboardStringV4_(row, reviewTable.headers, 'Result').toLowerCase();
    var phraseId = dashboardStringV4_(row, reviewTable.headers, 'Tag');
    var sessionId = dashboardStringV4_(row, reviewTable.headers, 'Session ID');
    var position = dashboardNumberV4_(row, reviewTable.headers, 'Question #');
    if (!dateKey || ER4_RESULTS.indexOf(result) === -1) return;
    var isCorrect = result === 'normal' || result === 'mastered';
    var selectionType = queueIdentity[sessionId + '|' + position] || 'unknown';
    var item = {
      date: dateKey,
      sessionId: sessionId,
      position: position,
      phraseId: phraseId,
      result: result,
      isCorrect: isCorrect,
      selectionType: selectionType,
      questionType: dashboardStringV4_(row, reviewTable.headers, 'Question Type'),
      answer: dashboardStringV4_(row, reviewTable.headers, 'User Answer'),
      notes: dashboardStringV4_(row, reviewTable.headers, 'Notes')
    };
    reviewRows.push(item);
    activeDates[dateKey] = true;
    if (phraseHistory[phraseId]) phraseHistory[phraseId].push(item);
    if (dateKey >= thirtyStart && dateKey <= todayKey) {
      if (!trendByDate[dateKey]) {
        trendByDate[dateKey] = {
          date: dateKey,
          total: 0,
          correct: 0,
          newTotal: 0,
          newCorrect: 0,
          reviewTotal: 0,
          reviewCorrect: 0
        };
      }
      var trend = trendByDate[dateKey];
      trend.total++;
      if (isCorrect) trend.correct++;
      if (selectionType === 'new') {
        trend.newTotal++;
        if (isCorrect) trend.newCorrect++;
      } else {
        trend.reviewTotal++;
        if (isCorrect) trend.reviewCorrect++;
      }
    }
  });

  Object.keys(phraseHistory).forEach(function(id) {
    phraseHistory[id].sort(function(a, b) {
      return a.date === b.date ? b.position - a.position : (a.date < b.date ? 1 : -1);
    });
    var recent = phraseHistory[id].slice(0, 5);
    var weakCount = recent.filter(function(item) { return !item.isCorrect; }).length;
    var consecutiveWeak = recent.length >= 2 && !recent[0].isCorrect && !recent[1].isCorrect;
    phraseById[id].hard = weakCount >= 3 || consecutiveWeak;
    phraseById[id].recentCorrect = recent.filter(function(item) { return item.isCorrect; }).length;
    phraseById[id].recentTotal = recent.length;
  });

  var stageOrder = ['未学习', '初学', '学习中', '稳定', '熟练', '困难项', '暂停'];
  var stageCounts = {};
  stageOrder.forEach(function(label) { stageCounts[label] = 0; });
  phrases.forEach(function(item) {
    var label;
    if (item.status === 'suspended') label = '暂停';
    else if (item.hard) label = '困难项';
    else if (!item.timesSeen) label = '未学习';
    else if (item.stage <= 2) label = '初学';
    else if (item.stage <= 4) label = '学习中';
    else if (item.stage <= 6) label = '稳定';
    else label = '熟练';
    item.masteryBand = label;
    stageCounts[label]++;
  });

  var trend = [];
  for (var offset = 0; offset < 30; offset++) {
    var trendDate = dashboardAddDaysV4_(thirtyStart, offset);
    var point = trendByDate[trendDate] || {
      date: trendDate,
      total: 0,
      correct: 0,
      newTotal: 0,
      newCorrect: 0,
      reviewTotal: 0,
      reviewCorrect: 0
    };
    point.accuracy = dashboardPercentV4_(point.correct, point.total);
    point.newAccuracy = dashboardPercentV4_(point.newCorrect, point.newTotal);
    point.reviewAccuracy = dashboardPercentV4_(point.reviewCorrect, point.reviewTotal);
    trend.push(point);
  }

  var recentThirty = reviewRows.filter(function(item) {
    return item.date >= thirtyStart && item.date <= todayKey;
  });
  var recentSeven = recentThirty.filter(function(item) { return item.date >= sevenStart; });
  var todayRows = recentThirty.filter(function(item) { return item.date === todayKey; });
  var questionCountControl = buildQuestionCountControlV4_(ss, todayKey);
  var currentQueue = findQueueForDateV4_(ss, todayKey);
  var currentQueueId = currentQueue ? currentQueue.queueId : '';
  var todayQueueRows = queueTable.rows.filter(function(row) {
    return dashboardDateKeyV4_(row[queueTable.headers['Queue Date']]) === todayKey &&
      dashboardStringV4_(row, queueTable.headers, 'Queue ID') === currentQueueId &&
      dashboardStringV4_(row, queueTable.headers, 'Contract Version') === ER4.contractVersion;
  });
  todayQueueRows.sort(function(a, b) {
    return dashboardNumberV4_(a, queueTable.headers, 'Position') -
      dashboardNumberV4_(b, queueTable.headers, 'Position');
  });
  var queueId = currentQueueId;
  var sessionId = currentQueue ? currentQueue.sessionId : '';
  var queueStatus = currentQueue ? currentQueue.status : 'missing';
  var expectedQueueCount = currentQueue ? currentQueue.plannedCount : 0;
  var todayQuestions = questionTable.rows.filter(function(row) {
    return queueId && dashboardStringV4_(row, questionTable.headers, 'Queue ID') === queueId &&
      dashboardStringV4_(row, questionTable.headers, 'Contract Version') === ER4.contractVersion &&
      dashboardStringV4_(row, questionTable.headers, 'Question Status').toLowerCase() !== 'rejected';
  });
  var todayGrades = gradeTable.rows.filter(function(row) {
    return sessionId && dashboardStringV4_(row, gradeTable.headers, 'Session ID') === sessionId &&
      dashboardStringV4_(row, gradeTable.headers, 'Contract Version') === ER4.contractVersion;
  });
  var todayJournals = journalTable.rows.filter(function(row) {
    return sessionId && dashboardStringV4_(row, journalTable.headers, 'Session ID') === sessionId &&
      dashboardStringV4_(row, journalTable.headers, 'Contract Version') === ER4.contractVersion;
  });
  var todaySessions = sessionTable.rows.filter(function(row) {
    return sessionId && dashboardStringV4_(row, sessionTable.headers, 'Session ID') === sessionId;
  });
  var latestJournal = todayJournals.length ? todayJournals[todayJournals.length - 1] : null;
  var latestSession = todaySessions.length ? todaySessions[todaySessions.length - 1] : null;
  var pendingGrades = todayGrades.filter(function(row) {
    return dashboardStringV4_(row, gradeTable.headers, 'Grade Status').toLowerCase() !== 'committed';
  }).length;
  var generationIds = dashboardUniqueV4_(todayQuestions.map(function(row) {
    return dashboardStringV4_(row, questionTable.headers, 'Generation ID');
  }).filter(Boolean));

  var futureDue = [];
  for (var futureOffset = 0; futureOffset < 14; futureOffset++) {
    var dueDate = dashboardAddDaysV4_(todayKey, futureOffset);
    futureDue.push({
      date: dueDate,
      count: phrases.filter(function(item) {
        return item.status !== 'suspended' && item.nextReview === dueDate;
      }).length
    });
  }
  var overdueCount = phrases.filter(function(item) { return item.dueState === 'overdue'; }).length;

  var errorStart = thirtyStart;
  var errorCategoryCounts = {};
  var phraseErrorCounts = {};
  errorTable.rows.forEach(function(row) {
    var dateKey = dashboardDateKeyV4_(row[errorTable.headers.Date]);
    if (!dateKey || dateKey < errorStart || dateKey > todayKey) return;
    var category = dashboardStringV4_(row, errorTable.headers, 'Error Type') || '未分类';
    var phraseId = dashboardStringV4_(row, errorTable.headers, 'Phrase ID');
    errorCategoryCounts[category] = (errorCategoryCounts[category] || 0) + 1;
    if (phraseId) phraseErrorCounts[phraseId] = (phraseErrorCounts[phraseId] || 0) + 1;
  });
  var errorCategories = Object.keys(errorCategoryCounts).map(function(category) {
    return { category: category, count: errorCategoryCounts[category] };
  }).sort(function(a, b) { return b.count - a.count || a.category.localeCompare(b.category); });
  var topErrors = Object.keys(phraseErrorCounts).map(function(id) {
    var phrase = phraseById[id] || { id: id, chunk: id, chineseCue: '', recentCorrect: 0, recentTotal: 0 };
    return {
      phraseId: id,
      chunk: phrase.chunk,
      chineseCue: phrase.chineseCue,
      errorCount: phraseErrorCounts[id],
      recentCorrect: phrase.recentCorrect || 0,
      recentTotal: phrase.recentTotal || 0,
      nextReview: phrase.nextReview || ''
    };
  }).sort(function(a, b) {
    return b.errorCount - a.errorCount || a.chunk.localeCompare(b.chunk);
  }).slice(0, 10);

  var latestActivity = '';
  todayQueueRows.forEach(function(row) {
    ['Committed At', 'Presented At'].forEach(function(header) {
      var value = formatDateTimeV4_(row[queueTable.headers[header]]);
      if (value && value > latestActivity) latestActivity = value;
    });
  });
  todayJournals.forEach(function(row) {
    ['Updated At', 'Completed At'].forEach(function(header) {
      var value = formatDateTimeV4_(row[journalTable.headers[header]]);
      if (value && value > latestActivity) latestActivity = value;
    });
  });

  var journalStatus = latestJournal
    ? dashboardStringV4_(latestJournal, journalTable.headers, 'Status').toLowerCase()
    : '';
  var journalReadback = latestJournal
    ? dashboardStringV4_(latestJournal, journalTable.headers, 'Readback Status').toLowerCase()
    : '';
  var sessionWrite = latestSession
    ? dashboardStringV4_(latestSession, sessionTable.headers, 'Database Write Status').toLowerCase()
    : '';
  var sessionReadback = latestSession
    ? dashboardStringV4_(latestSession, sessionTable.headers, 'Readback Status').toLowerCase()
    : '';
  var queueHealthy = !currentQueue || todayQueueRows.length === expectedQueueCount;
  var questionsHealthy = !todayQueueRows.length || todayQuestions.length === expectedQueueCount;
  var formalHealthy = queueStatus !== 'committed' ||
    (journalStatus === 'committed' && journalReadback === 'verified' &&
      sessionWrite === 'verified' && sessionReadback === 'verified' && pendingGrades === 0);
  var pipelineTone = questionCountControl.shortfallCount > 0 ? 'warn' :
    (queueHealthy && questionsHealthy && formalHealthy ? 'good' :
      (!todayQueueRows.length ? 'neutral' : 'warn'));

  return {
    ok: true,
    today: todayKey,
    generatedAt: Utilities.formatDate(new Date(), ER4.timezone, 'yyyy-MM-dd HH:mm:ss'),
    definitions: {
      firstCorrect: '每个搭配在每场练习中的第一次作答里，“基本掌握”或“熟练掌握”所占的比例。',
      difficult: '最近 5 次作答中至少 3 次没有答对，或最近连续 2 次没有答对。',
      overdue: '仍在学习或已经掌握、且下次复习日期早于今天的搭配数量。'
    },
    overview: {
      todayPlanned: questionCountControl.requestedCount,
      todayCompleted: todayRows.length,
      todayAccuracy: dashboardAccuracyV4_(todayRows),
      sevenDayAccuracy: dashboardAccuracyV4_(recentSeven),
      thirtyDayAccuracy: dashboardAccuracyV4_(recentThirty),
      totalPhrases: phrases.length,
      masteredPhrases: phrases.filter(function(item) { return item.status === 'mastered'; }).length,
      hardPhrases: phrases.filter(function(item) { return item.hard; }).length,
      overdue: overdueCount,
      streak: dashboardLearningStreakV4_(activeDates, todayKey)
    },
    todayPlan: {
      queueId: queueId,
      sessionId: sessionId,
      status: queueStatus,
      planned: questionCountControl.requestedCount,
      batchPlanned: expectedQueueCount,
      adjustedTarget: currentQueue ? currentQueue.adjustedTarget : 0,
      due: todayQueueRows.filter(function(row) {
        return dashboardStringV4_(row, queueTable.headers, 'Selection Type').toLowerCase() !== 'new';
      }).length,
      fresh: todayQueueRows.filter(function(row) {
        return dashboardStringV4_(row, queueTable.headers, 'Selection Type').toLowerCase() === 'new';
      }).length,
      completed: todayRows.length
    },
    questionCount: questionCountControl,
    trend: trend,
    futureDue: futureDue,
    mastery: stageOrder.map(function(label) { return { label: label, count: stageCounts[label] }; }),
    errorCategories: errorCategories,
    topErrors: topErrors,
    phrases: phrases.sort(function(a, b) { return a.chunk.localeCompare(b.chunk); }),
    system: {
      tone: pipelineTone,
      contractVersion: ER4.contractVersion,
      queueCount: todayQueueRows.length,
      queueExpectedCount: expectedQueueCount,
      queueStatus: queueStatus,
      questionCount: todayQuestions.length,
      generationCount: generationIds.length,
      gradeCount: todayGrades.length,
      pendingGradeCount: pendingGrades,
      materialShortfallCount: questionCountControl.shortfallCount,
      materialShortfallStatus: questionCountControl.shortfallStatus,
      pendingContextCount: pendingContextCount,
      pendingContextDecisionCount: pendingContextDecisionCount,
      contextErrorCount: contextErrorCount,
      latestContextBatch: latestContextBatch,
      journalStatus: journalStatus || 'missing',
      journalStep: latestJournal
        ? dashboardStringV4_(latestJournal, journalTable.headers, 'Last Completed Step')
        : '',
      journalReadback: journalReadback || 'missing',
      sessionWrite: sessionWrite || 'missing',
      sessionReadback: sessionReadback || 'missing',
      latestActivity: latestActivity
    }
  };
}

function getPhraseDetailV4(phraseId) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
  phraseId = stringValue_(phraseId);
  if (!/^ENG-\d{4,}$/.test(phraseId)) throw new Error('Invalid Phrase ID.');
  var phraseTable = readDashboardTableV4_(
    ss,
    'Phrase Bank',
    ['ID', 'Chunk', '中文提示', 'Type', 'Topic', 'Difficulty', 'Status', 'Review Stage',
      'Last Reviewed', 'Next Review', 'Times Seen', 'Times Correct', 'Common Mistake',
      'Natural Example', 'Notes', 'Source', 'Created Date', 'Source Candidate ID',
      'Mastery Streak', 'Last Result']
  );
  var phraseRow = null;
  phraseTable.rows.some(function(row) {
    if (dashboardStringV4_(row, phraseTable.headers, 'ID') === phraseId) {
      phraseRow = row;
      return true;
    }
    return false;
  });
  if (!phraseRow) throw new Error('Phrase was not found.');
  var reviewTable = readDashboardTableV4_(
    ss,
    'Review Log',
    ['Date', 'Session ID', 'Question #', 'Prompt', 'Expected Answer', 'User Answer',
      'Result', 'Tag', 'Notes', 'Attempt Type', 'Question Type', 'Affects SRS?']
  );
  var errorTable = readDashboardTableV4_(
    ss,
    'Error Log',
    ['Date', 'Chunk', 'Error Type', 'User Answer', 'Correction', 'Explanation',
      'Phrase ID', 'Session ID']
  );
  var history = reviewTable.rows.filter(function(row) {
    return dashboardStringV4_(row, reviewTable.headers, 'Tag') === phraseId;
  }).map(function(row) {
    return {
      date: dashboardDateKeyV4_(row[reviewTable.headers.Date]),
      sessionId: dashboardStringV4_(row, reviewTable.headers, 'Session ID'),
      position: dashboardNumberV4_(row, reviewTable.headers, 'Question #'),
      prompt: dashboardStringV4_(row, reviewTable.headers, 'Prompt'),
      expectedAnswer: dashboardStringV4_(row, reviewTable.headers, 'Expected Answer'),
      userAnswer: dashboardStringV4_(row, reviewTable.headers, 'User Answer'),
      result: dashboardStringV4_(row, reviewTable.headers, 'Result'),
      notes: dashboardStringV4_(row, reviewTable.headers, 'Notes'),
      attemptType: dashboardStringV4_(row, reviewTable.headers, 'Attempt Type'),
      questionType: dashboardStringV4_(row, reviewTable.headers, 'Question Type'),
      affectsSrs: dashboardStringV4_(row, reviewTable.headers, 'Affects SRS?')
    };
  }).sort(function(a, b) {
    return a.date === b.date ? b.position - a.position : (a.date < b.date ? 1 : -1);
  }).slice(0, 20);
  var errors = errorTable.rows.filter(function(row) {
    return dashboardStringV4_(row, errorTable.headers, 'Phrase ID') === phraseId;
  }).map(function(row) {
    return {
      date: dashboardDateKeyV4_(row[errorTable.headers.Date]),
      type: dashboardStringV4_(row, errorTable.headers, 'Error Type'),
      userAnswer: dashboardStringV4_(row, errorTable.headers, 'User Answer'),
      correction: dashboardStringV4_(row, errorTable.headers, 'Correction'),
      explanation: dashboardStringV4_(row, errorTable.headers, 'Explanation')
    };
  }).sort(function(a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 12);
  var origin = null;
  var sourceCandidateId = dashboardStringV4_(phraseRow, phraseTable.headers, 'Source Candidate ID');
  if (sourceCandidateId) {
    var candidateTable = readDashboardTableV4_(
      ss,
      DQ3.candidateSheet,
      ['Candidate ID', 'Origin Type', 'Origin Context ID', 'Selected Text', 'Source URL']
    );
    var sourceCandidate = null;
    candidateTable.rows.some(function(row) {
      if (dashboardStringV4_(row, candidateTable.headers, 'Candidate ID') === sourceCandidateId) {
        sourceCandidate = row;
        return true;
      }
      return false;
    });
    if (sourceCandidate && dashboardStringV4_(sourceCandidate, candidateTable.headers, 'Origin Type') === 'user_context') {
      var contextId = dashboardStringV4_(sourceCandidate, candidateTable.headers, 'Origin Context ID');
      var contextTable = readDashboardTableV4_(
        ss,
        ER4.contextSheet,
        ['Context ID', 'Raw Text', 'Source URL', 'Source Title', 'Created At']
      );
      var contextRow = null;
      contextTable.rows.some(function(row) {
        if (dashboardStringV4_(row, contextTable.headers, 'Context ID') === contextId) {
          contextRow = row;
          return true;
        }
        return false;
      });
      origin = {
        type: 'user_context',
        contextId: contextId,
        selectedText: dashboardStringV4_(sourceCandidate, candidateTable.headers, 'Selected Text'),
        sourceUrl: dashboardStringV4_(sourceCandidate, candidateTable.headers, 'Source URL'),
        sourceTitle: contextRow ? dashboardStringV4_(contextRow, contextTable.headers, 'Source Title') : '',
        rawText: contextRow ? dashboardStringV4_(contextRow, contextTable.headers, 'Raw Text') : '',
        capturedAt: contextRow ? dashboardTimestampV4_(contextRow[contextTable.headers['Created At']]) : ''
      };
    }
  }
  return {
    ok: true,
    phrase: {
      id: phraseId,
      chunk: dashboardStringV4_(phraseRow, phraseTable.headers, 'Chunk'),
      chineseCue: dashboardStringV4_(phraseRow, phraseTable.headers, '中文提示'),
      type: dashboardStringV4_(phraseRow, phraseTable.headers, 'Type'),
      topic: dashboardStringV4_(phraseRow, phraseTable.headers, 'Topic'),
      difficulty: dashboardStringV4_(phraseRow, phraseTable.headers, 'Difficulty'),
      status: dashboardStringV4_(phraseRow, phraseTable.headers, 'Status'),
      stage: dashboardNumberV4_(phraseRow, phraseTable.headers, 'Review Stage'),
      lastReviewed: dashboardDateKeyV4_(phraseRow[phraseTable.headers['Last Reviewed']]),
      nextReview: dashboardDateKeyV4_(phraseRow[phraseTable.headers['Next Review']]),
      timesSeen: dashboardNumberV4_(phraseRow, phraseTable.headers, 'Times Seen'),
      timesCorrect: dashboardNumberV4_(phraseRow, phraseTable.headers, 'Times Correct'),
      commonMistake: dashboardStringV4_(phraseRow, phraseTable.headers, 'Common Mistake'),
      naturalExample: dashboardStringV4_(phraseRow, phraseTable.headers, 'Natural Example'),
      notes: dashboardStringV4_(phraseRow, phraseTable.headers, 'Notes'),
      source: dashboardStringV4_(phraseRow, phraseTable.headers, 'Source'),
      createdDate: dashboardDateKeyV4_(phraseRow[phraseTable.headers['Created Date']]),
      masteryStreak: dashboardNumberV4_(phraseRow, phraseTable.headers, 'Mastery Streak'),
      lastResult: dashboardStringV4_(phraseRow, phraseTable.headers, 'Last Result')
    },
    history: history,
    errors: errors,
    origin: origin
  };
}

function readDashboardTableV4_(ss, sheetName, requiredHeaders) {
  var sheet = requireSheet_(ss, sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0] || []);
  requireHeaders_(headers, requiredHeaders, sheetName);
  return { sheet: sheet, headers: headers, rows: values.slice(1) };
}

function dashboardStringV4_(row, headers, header) {
  return stringValue_(row[headers[header]]);
}

function dashboardNumberV4_(row, headers, header) {
  var value = Number(row[headers[header]]);
  return isFinite(value) ? value : 0;
}

function dashboardDateKeyV4_(value) {
  if (isDateValue_(value)) return formatDateKey_(value);
  var text = stringValue_(value);
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
}

function dashboardAddDaysV4_(dateKey, offset) {
  var parts = String(dateKey).split('-').map(Number);
  var date = new Date(parts[0], parts[1] - 1, parts[2] + Number(offset || 0), 12, 0, 0);
  return Utilities.formatDate(date, ER4.timezone, 'yyyy-MM-dd');
}

function dashboardPercentV4_(numerator, denominator) {
  return denominator ? Math.round((Number(numerator) / Number(denominator)) * 1000) / 10 : null;
}

function dashboardAccuracyV4_(rows) {
  var correct = rows.filter(function(item) { return item.isCorrect; }).length;
  return { correct: correct, total: rows.length, percent: dashboardPercentV4_(correct, rows.length) };
}

function dashboardLearningStreakV4_(activeDates, todayKey) {
  var cursor = activeDates[todayKey] ? todayKey : dashboardAddDaysV4_(todayKey, -1);
  if (!activeDates[cursor]) return 0;
  var streak = 0;
  while (activeDates[cursor]) {
    streak++;
    cursor = dashboardAddDaysV4_(cursor, -1);
  }
  return streak;
}

function dashboardUniqueV4_(values) {
  var seen = {};
  values.forEach(function(value) { seen[String(value)] = true; });
  return Object.keys(seen);
}

function invalidateLearningDashboardCacheV4_() {
  try {
    CacheService.getUserCache().remove('ER4_DASHBOARD_V1_' + formatDateKey_(new Date()));
  } catch (ignore) {}
}

function markGradeRowsCommittedV4_(ss, submissionId, sessionId) {
  var sheet = requireSheet_(ss, ER4.gradeSheet);
  var values = sheet.getDataRange().getValues();
  var h = headerMap_(values[0]);
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][h['Submission ID']]) === submissionId &&
      stringValue_(values[i][h['Session ID']]) === sessionId &&
      ['accepted', 'needs_confirmation'].indexOf(
        stringValue_(values[i][h['Grade Status']]).toLowerCase()
      ) !== -1
    ) {
      sheet.getRange(i + 1, h['Grade Status'] + 1).setValue('committed');
    }
  }
  SpreadsheetApp.flush();
}

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
  var baseline = SpreadsheetApp.openById('YOUR_SPREADSHEET_ID');
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
  expect('personal origin precedes fallback', candidateOriginRank_('user_context') < candidateOriginRank_('ai_fallback'), true);
  expect('learning evidence precedes legacy', candidateOriginRank_('learning_evidence') < candidateOriginRank_('legacy'), true);
  expect('fallback blocked by personal inventory', shouldGenerateAiFallbackV4_(1, 1, 0), false);
  expect('fallback blocked by personal backlog', shouldGenerateAiFallbackV4_(0, 0, 1), false);
  expect('fixed fallback reserve disabled', shouldGenerateAiFallbackV4_(0, 0, 0), false);
  expect('fallback not duplicated above target', shouldGenerateAiFallbackV4_(0, 20, 0), false);
  if (failures.length) throw new Error('v4 self-test failed: ' + failures.join('; '));
  return { ok: true, tests: testCount, contractVersion: ER4.contractVersion };
}
