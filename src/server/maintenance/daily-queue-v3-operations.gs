
function installDailyQueueTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DQ3.triggerHandler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger(DQ3.triggerHandler)
    .timeBased()
    .atHour(8)
    .nearMinute(30)
    .everyDays(1)
    .inTimezone(DQ3.timezone)
    .create();
}

function countReadyCandidates_(ss) {
  var sheet = requireSheet_(ss, DQ3.candidateSheet);
  var values = sheet.getDataRange().getValues();
  var headers = headerMap_(values[0]);
  var count = 0;
  for (var i = 1; i < values.length; i++) {
    if (
      stringValue_(values[i][headers.Status]).toLowerCase() === 'ready' &&
      stringValue_(values[i][headers['Candidate Type']]).toLowerCase() === 'chunk'
    ) count++;
  }
  return count;
}

function assertContractV3_(ss) {
  var sheet = requireSheet_(ss, DQ3.configSheet);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (stringValue_(values[i][0]) === 'contract_version') {
      var version = stringValue_(values[i][1]);
      if (!isContractVersion_(version)) {
        throw new Error('Contract mismatch: expected 3.0, found ' + version + '.');
      }
      return;
    }
  }
  throw new Error('Config contract_version is missing.');
}

function requireSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Required sheet is missing: ' + name);
  return sheet;
}
