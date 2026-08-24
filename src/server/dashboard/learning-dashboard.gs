
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
  var queueStatus = currentQueue ? currentQueue.status : 'missing';
  var todayQueueRows = queueTable.rows.filter(function(row) {
    var rowStatus = dashboardStringV4_(row, queueTable.headers, 'Queue Status').toLowerCase();
    var activeStatus = queueStatus === 'committed' ? rowStatus === 'committed' : rowStatus === queueStatus;
    return activeStatus &&
      dashboardDateKeyV4_(row[queueTable.headers['Queue Date']]) === todayKey &&
      dashboardStringV4_(row, queueTable.headers, 'Queue ID') === currentQueueId &&
      dashboardStringV4_(row, queueTable.headers, 'Contract Version') === ER4.contractVersion;
  });
  todayQueueRows.sort(function(a, b) {
    return dashboardNumberV4_(a, queueTable.headers, 'Position') -
      dashboardNumberV4_(b, queueTable.headers, 'Position');
  });
  var queueId = currentQueueId;
  var sessionId = currentQueue ? currentQueue.sessionId : '';
  var storedQueueCount = currentQueue ? currentQueue.plannedCount : 0;
  var expectedQueueCount = currentQueue
    ? activeQuestionPositionsV4_(ss, currentQueue).count
    : 0;
  var todayQuestions = questionTable.rows.filter(function(row) {
    var questionStatus = dashboardStringV4_(row, questionTable.headers, 'Question Status').toLowerCase();
    return queueId && dashboardStringV4_(row, questionTable.headers, 'Queue ID') === queueId &&
      dashboardStringV4_(row, questionTable.headers, 'Contract Version') === ER4.contractVersion &&
      ['staged', 'ready', 'bound'].indexOf(questionStatus) !== -1;
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
  var activeQueueCount = Math.min(todayQueueRows.length, expectedQueueCount);
  var activeQuestionCount = Math.min(todayQuestions.length, expectedQueueCount);

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
  var queueHealthy = !currentQueue || activeQueueCount === expectedQueueCount;
  var questionsHealthy = !todayQueueRows.length || activeQuestionCount === expectedQueueCount;
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
      queueCount: activeQueueCount,
      queueExpectedCount: expectedQueueCount,
      storedQueueCount: storedQueueCount,
      queueStatus: queueStatus,
      questionCount: activeQuestionCount,
      storedQuestionCount: todayQuestions.length,
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
