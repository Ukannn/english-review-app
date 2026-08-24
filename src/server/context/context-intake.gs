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
    invalidateLearningDashboardCacheV4_();
    return { ok: true, contextId: contextId, status: 'pending', selectedSpanCount: spans.length };
  } finally {
    lock.releaseLock();
  }
}

function getContextInboxV4(options) {
  assertV4Enabled_();
  assertAuthorizedV4_();
  options = options && typeof options === 'object' ? options : {};
  var limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertContractV4_(ss);
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
    var allItems = contextTable.rows.map(function(row) {
      var contextId = dashboardStringV4_(row, contextTable.headers, 'Context ID');
      if (!contextId) return null;
      var storedStatus = dashboardStringV4_(row, contextTable.headers, 'Processing Status');
      var derivedStatus = contextDerivedStatusV4_(
        storedStatus,
        proposalsByContext[contextId] || []
      );
      return {
        contextId: contextId,
        rawText: dashboardStringV4_(row, contextTable.headers, 'Raw Text'),
        selectedSpans: parseContextSpansV4_(
          dashboardStringV4_(row, contextTable.headers, 'Selected Spans JSON')
        ),
        sourceUrl: dashboardStringV4_(row, contextTable.headers, 'Source URL'),
        sourceTitle: dashboardStringV4_(row, contextTable.headers, 'Source Title'),
        userNote: dashboardStringV4_(row, contextTable.headers, 'User Note'),
        status: derivedStatus,
        processingBatchId: dashboardStringV4_(row, contextTable.headers, 'Processing Batch ID'),
        createdAt: dashboardTimestampV4_(row[contextTable.headers['Created At']]),
        processedAt: dashboardTimestampV4_(row[contextTable.headers['Processed At']]),
        proposals: proposalsByContext[contextId] || []
      };
    }).filter(Boolean).sort(function(a, b) {
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    var counts = { pending: 0, needsDecision: 0, committed: 0, errors: 0 };
    allItems.forEach(function(item) {
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
      items: allItems.slice(0, limit),
      totalItems: allItems.length,
      processingPrompt: ER4_CONTEXT_PROCESSING_PROMPT,
      contextProcessingConversationUrl: ER4.contextProcessingConversationUrl
    };
}

function contextDerivedStatusV4_(storedStatus, proposals) {
  var status = stringValue_(storedStatus).toLowerCase();
  if (!proposals.length || ['rejected', 'error'].indexOf(status) !== -1) return status;
  var batches = dashboardUniqueV4_(proposals.map(function(item) {
    return stringValue_(item.processingBatchId);
  }).filter(Boolean));
  if (batches.length !== 1) return 'error';
  return proposals.every(function(item) {
    return stringValue_(item.candidateType).toLowerCase() === 'explanation_only';
  }) ? 'explanation_only' : 'processed';
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
