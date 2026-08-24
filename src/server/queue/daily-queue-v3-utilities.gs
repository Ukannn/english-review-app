
function headerMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    var key = stringValue_(header);
    if (key) map[key] = index;
  });
  return map;
}

function requireHeaders_(map, headers, sheetName) {
  headers.forEach(function(header) {
    if (map[header] === undefined) {
      throw new Error(sheetName + ' is missing required header: ' + header);
    }
  });
}

function formatDateKey_(value) {
  return Utilities.formatDate(new Date(value), DQ3.timezone, 'yyyy-MM-dd');
}

function parseDateKey_(dateKey) {
  return new Date(dateKey + 'T12:00:00+08:00');
}

function tomorrowDate_() {
  var todayAtNoon = parseDateKey_(formatDateKey_(new Date()));
  return new Date(todayAtNoon.getTime() + 24 * 60 * 60 * 1000);
}

function isDateValue_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
}

function stringValue_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isContractVersion_(value) {
  var text = stringValue_(value);
  return text === DQ3.contractVersion || text === '3';
}

function numberValue_(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function normalizeQuestionCount_(value, fallback) {
  var fallbackCount = Number(fallback);
  if (!isFinite(fallbackCount)) fallbackCount = DQ3.legacyQuestionCount;
  var count = Number(value);
  if (!isFinite(count) || Math.floor(count) !== count) count = fallbackCount;
  if (count < DQ3.minQuestionCount || count > DQ3.maxBatchQuestionCount) {
    throw new Error(
      'Question count must be an integer between ' + DQ3.minQuestionCount +
      ' and ' + DQ3.maxBatchQuestionCount + ' for one Daily Queue.'
    );
  }
  return count;
}

function queuePlannedCountFromRows_(rows) {
  if (!Array.isArray(rows) || !rows.length) return DQ3.legacyQuestionCount;
  var column = DQ3_QUEUE_HEADERS.indexOf('Planned Count');
  var values = {};
  rows.forEach(function(row) {
    var raw = column >= 0 ? Number(row[column]) : 0;
    if (isFinite(raw) && raw > 0) values[raw] = true;
  });
  var counts = Object.keys(values).map(Number);
  if (counts.length > 1) throw new Error('Queue rows do not share one Planned Count.');
  return normalizeQuestionCount_(counts.length ? counts[0] : DQ3.legacyQuestionCount, DQ3.legacyQuestionCount);
}

function normalizeChunk_(value) {
  return stringValue_(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedCandidateOriginType_(value) {
  var origin = stringValue_(value).toLowerCase();
  if (origin === 'auto_replenishment') return 'ai_fallback';
  if (
    ['user_context', 'learning_evidence', 'conversation_derived', 'legacy', 'ai_fallback']
      .indexOf(origin) !== -1
  ) return origin;
  return 'legacy';
}

function candidateOriginRank_(value) {
  var ranks = {
    user_context: 0,
    learning_evidence: 1,
    conversation_derived: 2,
    legacy: 3,
    ai_fallback: 4
  };
  return ranks[normalizedCandidateOriginType_(value)];
}

function candidateIntakePriorityRank_(value) {
  var ranks = { high: 0, normal: 1, fallback: 2 };
  var key = stringValue_(value).toLowerCase();
  return ranks[key] === undefined ? 1 : ranks[key];
}

function candidateOriginLabel_(value) {
  return 'origin=' + normalizedCandidateOriginType_(value);
}

function isPersonalCandidateOrigin_(value) {
  return normalizedCandidateOriginType_(value) !== 'ai_fallback';
}

function resultRank_(result) {
  var ranks = { forgotten: 0, difficult: 1, normal: 2, mastered: 3 };
  return ranks[result] === undefined ? 4 : ranks[result];
}

function isReviewEligibleStatus_(status) {
  return DQ3.reviewEligibleStatuses.indexOf(stringValue_(status).toLowerCase()) !== -1;
}

function compareValues_(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
