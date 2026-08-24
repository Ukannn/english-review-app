
function setupDailyQueueV3() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureCandidateMetadataColumns_(ss);
    ensureDailyQueueSheet_(ss);
    updateConfigV3_(ss);
    updateReadmeV3_(ss);
    installDailyQueueTrigger_();
    SpreadsheetApp.flush();
    return {
      ok: true,
      contractVersion: DQ3.contractVersion,
      queueSheet: DQ3.queueSheet,
      readyCandidates: countReadyCandidates_(ss),
      triggerHandler: DQ3.triggerHandler
    };
  } finally {
    lock.releaseLock();
  }
}

function scheduledBuildDailyQueue() {
  return buildDailyQueue();
}

function buildDailyQueue() {
  return buildDailyQueueForDate_(new Date());
}

function buildTomorrowDailyQueue() {
  return buildDailyQueueForDate_(tomorrowDate_());
}

function previewDailyQueue() {
  return previewDailyQueueForDate_(new Date());
}

function previewTomorrowDailyQueue() {
  return previewDailyQueueForDate_(tomorrowDate_());
}

function getTodayDailyQueue() {
  return getDailyQueueForDate_(new Date());
}

function getTomorrowDailyQueue() {
  return getDailyQueueForDate_(tomorrowDate_());
}
