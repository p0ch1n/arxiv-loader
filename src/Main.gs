/**
 * Main.gs — Daily orchestrator: fetch → deduplicate → push to dated branch.
 *
 * Entry points:
 *   runDailyDownload()  — called by the time-based trigger
 *   setupTrigger()      — one-time setup, run manually once
 *   runManual()         — run immediately for testing
 */

// ---------- Main entry point ----------

function runDailyDownload() {
  var config = getConfig();
  var today  = todayString();

  console.log('=== ArxivLoader start: ' + today + ' ===');

  // Ensure today's branch exists (creates from main if absent)
  ensureBranch(
    config.githubOwner,
    config.githubRepo,
    today,
    config.baseBranch,
    config.githubToken
  );

  // Load dedup index from main branch
  var dedupState  = loadDedupIndex(config);
  var existingIds = dedupState.ids;

  // Fetch papers per domain, filter duplicates
  var allNew  = [];
  var domainStats = {};

  var domainKeys = ['AI', 'Vision', 'Agent', 'Quant', 'Trading'];
  domainKeys.forEach(function(domainKey) {
    var domainConfig = config.domains[domainKey];

    console.log('[' + domainKey + '] Fetching...');
    var fetched = fetchArxivPapers(domainKey, domainConfig, config.maxResults);

    var fresh = filterNewPapers(fetched, existingIds);
    fresh.forEach(function(p) { existingIds[p.id] = true; });
    allNew = allNew.concat(fresh);

    domainStats[domainKey] = { fetched: fetched.length, new: fresh.length };
    console.log('[' + domainKey + '] fetched=' + fetched.length + ' new=' + fresh.length);

    Utilities.sleep(1500); // arXiv polite rate-limit
  });

  if (allNew.length === 0) {
    console.log('No new papers today — nothing pushed.');
    return;
  }

  // Push per-domain paper files to today's branch
  pushDomainFiles(config, allNew, today);

  // Push daily summary to today's branch
  pushSummary(config, allNew, today, domainStats);

  // Update dedup index on main branch
  dedupState.ids = existingIds;
  saveDedupIndex(config, allNew, dedupState);

  console.log('=== Done: ' + allNew.length + ' new papers pushed to branch ' + today + ' ===');
}

// ---------- File push helpers ----------

/**
 * Writes one JSON file per domain under {date}/{domain}/papers.json.
 * Appends to any existing content from earlier runs today.
 */
function pushDomainFiles(config, papers, dateBranch) {
  var byDomain = groupByDomain(papers);

  Object.keys(byDomain).forEach(function(domainKey) {
    var fresh = byDomain[domainKey];
    var path  = dateBranch + '/' + domainKey.toLowerCase() + '/papers.json';

    var existing = getFile(
      config.githubOwner,
      config.githubRepo,
      path,
      dateBranch,
      config.githubToken
    );

    var prior = existing ? JSON.parse(existing.content).papers : [];
    var merged = prior.concat(fresh);

    var payload = JSON.stringify({
      domain:       domainKey,
      date:         dateBranch,
      count:        merged.length,
      papers:       merged
    }, null, 2);

    putFile(
      config.githubOwner,
      config.githubRepo,
      path,
      payload,
      'feat(' + domainKey + '): add ' + fresh.length + ' papers [' + dateBranch + ']',
      dateBranch,
      config.githubToken,
      existing ? existing.sha : null
    );

    console.log('[Push] ' + domainKey + ' → ' + path + ' (' + fresh.length + ' papers)');
    Utilities.sleep(500);
  });
}

/**
 * Writes a human-readable summary to {date}/summary.json.
 * Contains lightweight card-like records (no abstract) for quick browsing.
 */
function pushSummary(config, papers, dateBranch, domainStats) {
  var path = dateBranch + '/summary.json';

  // Lightweight card — strip abstract to keep summary small
  var cards = papers.map(function(p) {
    return {
      id:               p.id,
      title:            p.title,
      authors:          p.authors.slice(0, 3),
      url:              p.url,
      pdf_url:          p.pdf_url,
      published:        p.published,
      primary_category: p.primary_category,
      tags:             p.tags,
      domain:           p.domain
    };
  });

  var byDomain = groupByDomain(cards);

  var payload = JSON.stringify({
    date:         dateBranch,
    total_papers: papers.length,
    domain_stats: domainStats,
    papers:       byDomain,
    generated_at: new Date().toISOString()
  }, null, 2);

  var existing = getFile(
    config.githubOwner,
    config.githubRepo,
    path,
    dateBranch,
    config.githubToken
  );

  putFile(
    config.githubOwner,
    config.githubRepo,
    path,
    payload,
    'chore: daily summary for ' + dateBranch + ' (' + papers.length + ' papers)',
    dateBranch,
    config.githubToken,
    existing ? existing.sha : null
  );

  console.log('[Push] summary → ' + path);
}

// ---------- Utilities ----------

function groupByDomain(papers) {
  return papers.reduce(function(acc, p) {
    if (!acc[p.domain]) acc[p.domain] = [];
    acc[p.domain].push(p);
    return acc;
  }, {});
}

function todayString() {
  var now    = new Date();
  var year   = now.getUTCFullYear();
  var month  = String(now.getUTCMonth() + 1).padStart(2, '0');
  var day    = String(now.getUTCDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

// ---------- Manual run for testing ----------

function runManual() {
  runDailyDownload();
}

// ---------- Trigger management ----------

/**
 * Call this ONCE from the Apps Script editor to register the daily trigger.
 * Removes any existing triggers first to avoid duplicates.
 */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('runDailyDownload')
    .timeBased()
    .everyDays(1)
    .atHour(TRIGGER_HOUR_UTC)
    .inTimezone('Etc/UTC')
    .create();

  console.log('Daily trigger set: runDailyDownload at ' + TRIGGER_HOUR_UTC + ':00 UTC');
}

/**
 * Lists active triggers — useful to verify setup.
 */
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    console.log(t.getHandlerFunction() + ' | ' + t.getTriggerSource() + ' | ' + t.getEventType());
  });
  if (triggers.length === 0) console.log('No triggers registered.');
}
