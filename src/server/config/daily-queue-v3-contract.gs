/**
 * English Review Database v3.0
 *
 * Deterministic daily selection:
 *   1) all scheduled due items (active or mastered), capped at the frozen target;
 *   2) if due items are fewer than the frozen target, fill the remaining slots with
 *      Candidate Bank rows whose Status is "ready";
 *   3) never fill with non-due old Phrase Bank items;
 *   4) when due items exceed the current daily-set count, leave the unselected items overdue.
 *
 * Daily Queue is the durable audit record consumed by the ChatGPT task.
 */

var DQ3 = {
  timezone: 'Asia/Shanghai',
  contractVersion: '3.0',
  legacyQuestionCount: 20,
  minQuestionCount: 1,
  maxDailyQuestionCount: 150,
  // A Queue ID is one user-visible daily set. AI staging may still use
  // smaller internal segments, but the Queue itself supports the full range.
  maxBatchQuestionCount: 150,
  aiFallbackPoolTarget: 0,
  reviewEligibleStatuses: ['active', 'mastered'],
  phraseSheet: 'Phrase Bank',
  candidateSheet: 'Candidate Bank',
  queueSheet: 'Daily Queue',
  configSheet: 'Config',
  readmeSheet: 'README',
  triggerHandler: 'scheduledBuildDailyQueue'
};

var DQ3_QUEUE_HEADERS = [
  'Queue Date',
  'Queue ID',
  'Position',
  'Selection Type',
  'Phrase ID',
  'Candidate ID',
  'Chunk',
  '中文提示',
  'Topic',
  'Difficulty',
  'Natural Example',
  'Original Next Review',
  'Priority Reason',
  'Queue Status',
  'Session ID',
  'Created At',
  'Committed At',
  'Contract Version',
  'Presented At',
  'Planned Count',
  'Adjusted Target',
  'Queue Kind',
  'Plan Revision',
  'Superseded By',
  'Superseded At',
  'Change Reason'
];

var DQ3_CANDIDATE_EXTRA_HEADERS = [
  '中文提示',
  'Topic',
  'Difficulty',
  'Natural Example',
  'Common Mistake',
  'Origin Type',
  'Origin Context ID',
  'Selected Text',
  'Source URL',
  'Intake Priority'
];
