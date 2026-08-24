
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
      var shortfallComposition = activeQueueCompositionV4_(shortfallQueue);
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
        due: shortfallComposition.due,
        fresh: shortfallComposition.fresh
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
    var invalidComposition = activeQueueCompositionV4_(queue);
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
        due: invalidComposition.due,
        fresh: invalidComposition.fresh
      },
      chatGptTaskUrl: ER4.chatGptTaskUrl
    };
  }
  if (!questionBatch) {
    var activeQuestionTarget = activeQuestionPositionsV4_(ss, queue).count;
    var preparingComposition = activeQueueCompositionV4_(queue);
    return {
      ok: true,
      state: 'preparing',
      message:
        '今日生效题数为 ' + activeQuestionTarget +
        ' 题，仍有题目尚未准备完成。你可以复制完整出题提示词，交给可使用 Google Drive 的高能力模型。',
      queueId: queue.queueId,
      plannedCount: activeQuestionTarget,
      queueMeta: {
        planned: queue.plannedCount,
        adjustedTarget: queue.adjustedTarget,
        requested: readQuestionCountSettingsV4_(ss, queue.dateKey).targetCount,
        completedBeforeBatch: completedQuestionsForDateV4_(ss, queue.dateKey, queue.sessionId),
        completedInBatch: countLockedDraftsV4_(ss, queue.sessionId),
        queueKind: queue.queueKind,
        due: preparingComposition.due,
        fresh: preparingComposition.fresh
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
      statuses.every(function(status) { return status === 'planned' || status === 'deferred'; }) &&
      statuses.indexOf('planned') !== -1
    ) {
      aggregateStatus = 'planned';
    } else if (
      statuses.every(function(status) { return status === 'presented' || status === 'deferred'; }) &&
      statuses.indexOf('presented') !== -1
    ) {
      aggregateStatus = 'presented';
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
      validateQuestionItemsV4_(ss, items, headers, queue);
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

  if (allItems.length > queue.plannedCount) {
    throw new Error('Active question rows exceed the Daily Queue Planned Count.');
  }
  var activePositions = activeQuestionPositionsV4_(ss, queue);
  var surplusPositions = Object.keys(positionOwner).map(Number).filter(function(position) {
    return !activePositions.byPosition[position];
  });
  if (surplusPositions.length) {
    throw new Error(
      'Active question rows remain outside the current target: ' +
      surplusPositions.sort(function(a, b) { return a - b; }).join(', ') + '.'
    );
  }
  for (var requiredIndex = 0; requiredIndex < activePositions.positions.length; requiredIndex++) {
    if (!positionOwner[activePositions.positions[requiredIndex]]) return null;
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

function validateQuestionItemsV4_(ss, items, headers, queue) {
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
    var promptVersion = stringValue_(row[headers['Prompt Version']]);
    if (promptVersion === 'english-review-v4-question-4') {
      var scopeMatches = promptZh.match(/【作答范围：(词块组成部分|完整目标词块)】/g) || [];
      if (scopeMatches.length !== 1) {
        throw new Error('Question must declare exactly one answer scope at position ' + position + '.');
      }
      if (/完整英文句子|整句翻译|翻译整句/.test(promptZh + ' ' + promptEn)) {
        throw new Error('Formal question asks for a full sentence at position ' + position + '.');
      }
      validateQuestionHistoryVariationV4_(ss, item, headers, position);
    }
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

function validateQuestionHistoryVariationV4_(ss, item, headers, position) {
  var row = item.values;
  var phraseId = stringValue_(row[headers['Phrase ID']]);
  var candidateId = stringValue_(row[headers['Candidate ID']]);
  var promptKey = normalizeQuestionPromptV4_(
    stringValue_(row[headers['Prompt ZH']]) + ' ' + stringValue_(row[headers['Prompt EN']])
  );
  var sheet = requireSheet_(ss, ER4.questionSheet);
  var values = sheet.getDataRange().getValues();
  var h = headerMap_(values[0]);
  for (var i = 1; i < values.length; i++) {
    if (i + 1 === item.rowNumber) continue;
    var sameIdentity = phraseId
      ? stringValue_(values[i][h['Phrase ID']]) === phraseId
      : stringValue_(values[i][h['Candidate ID']]) === candidateId;
    if (!sameIdentity) continue;
    var historicalKey = normalizeQuestionPromptV4_(
      stringValue_(values[i][h['Prompt ZH']]) + ' ' + stringValue_(values[i][h['Prompt EN']])
    );
    if (promptKey && historicalKey === promptKey) {
      throw new Error('Question repeats a historical prompt at position ' + position + '.');
    }
  }
}

function normalizeQuestionPromptV4_(value) {
  return stringValue_(value)
    .toLowerCase()
    .replace(/【作答范围：(?:词块组成部分|完整目标词块)】/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
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
  var activeComposition = activeQueueCompositionV4_(queue);
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
      due: activeComposition.due,
      fresh: activeComposition.fresh
    },
    questions: questions,
    chatGptTaskUrl: ER4.chatGptTaskUrl,
    chatGptManualUrl: ER4.chatGptManualUrl
  };
}
