/**
 * Setup.gs — First-time initialization helpers.
 *
 * Run these functions ONCE from the Apps Script editor after deploying.
 */

/**
 * Bootstraps a completely empty GitHub repo by creating the first commit.
 * Run this ONCE when the repo has no commits yet.
 * Creates paper_index.json on the main branch (which initializes the repo).
 */
function initRepo() {
  var config = getConfig();

  console.log('Initializing empty repo: ' + config.githubOwner + '/' + config.githubRepo);

  var initial = JSON.stringify({
    paper_ids:    [],
    total_count:  0,
    last_updated: new Date().toISOString()
  }, null, 2);

  // PUT to contents API on an empty repo creates the first commit automatically.
  // Do NOT pass a branch param — let GitHub use the default branch.
  try {
    githubRequest(
      'PUT',
      '/repos/' + config.githubOwner + '/' + config.githubRepo + '/contents/' + config.dedupPath,
      {
        message: 'chore: initialize arxiv-loader repo',
        content: Utilities.base64Encode(initial, Utilities.Charset.UTF_8)
      },
      config.githubToken
    );
    console.log('Repo initialized. paper_index.json created on main branch.');
    console.log('Now run validateConfig() to verify GitHub connectivity.');
  } catch (e) {
    console.error('initRepo failed: ' + e.message);
  }
}

/**
 * Validates that all required Script Properties are set.
 * Run this first to confirm your configuration is complete.
 */
function validateConfig() {
  var config;
  try {
    config = getConfig();
    console.log('Config OK:');
    console.log('  Owner: ' + config.githubOwner);
    console.log('  Repo:  ' + config.githubRepo);
    console.log('  Token: ' + config.githubToken.slice(0, 4) + '****');
  } catch (e) {
    console.error('Config INVALID: ' + e.message);
    return;
  }

  // Verify GitHub connectivity
  try {
    var sha = getBranchSha(
      config.githubOwner,
      config.githubRepo,
      config.baseBranch,
      config.githubToken
    );
    console.log('GitHub connectivity OK. ' + config.baseBranch + ' SHA: ' + sha);
  } catch (e) {
    console.error('GitHub connectivity FAILED: ' + e.message);
  }
}

/**
 * Bootstraps an empty dedup index on the main branch.
 * Only needed if paper_index.json does not yet exist.
 */
function initDedupIndex() {
  var config = getConfig();

  var existing = getFile(
    config.githubOwner,
    config.githubRepo,
    config.dedupPath,
    config.baseBranch,
    config.githubToken
  );

  if (existing) {
    console.log('Index already exists — skipping. (Delete it first if you want to reset.)');
    return;
  }

  var initial = JSON.stringify({
    paper_ids:    [],
    total_count:  0,
    last_updated: new Date().toISOString()
  }, null, 2);

  putFile(
    config.githubOwner,
    config.githubRepo,
    config.dedupPath,
    initial,
    'chore: initialize dedup index',
    config.baseBranch,
    config.githubToken,
    null
  );

  console.log('Dedup index created at ' + config.dedupPath + ' on branch ' + config.baseBranch);
}

/**
 * Runs one domain fetch in dry-run mode (no GitHub writes).
 * Useful for checking arXiv API connectivity and category mapping.
 */
/**
 * Prints the full config.domains structure so you can verify it looks correct.
 * Run this to debug domain/category issues.
 */
function testDomains() {
  var config = getConfig();
  console.log('config.domains type: ' + typeof config.domains);
  console.log('config.domains keys: ' + JSON.stringify(Object.keys(config.domains)));
  console.log('Full domains: ' + JSON.stringify(config.domains, null, 2));
}

/**
 * Runs one domain fetch in dry-run mode (no GitHub writes).
 */
function dryRunFetch() {
  var config = getConfig();
  var domainKey = 'AI';
  var domainConfig = config.domains[domainKey];

  if (!domainConfig) {
    console.error('domainConfig for "' + domainKey + '" is undefined. Run testDomains() to inspect the config.');
    return;
  }

  console.log('Dry-run fetch for domain: ' + domainKey);
  console.log('Categories: ' + domainConfig.categories.join(', '));

  var papers = fetchArxivPapers(domainKey, domainConfig, 5);
  console.log('Fetched ' + papers.length + ' papers:');

  papers.forEach(function(p, i) {
    console.log('\n[' + (i + 1) + '] ' + p.id);
    console.log('  Title:   ' + p.title.slice(0, 80));
    console.log('  Authors: ' + p.authors.slice(0, 2).join(', '));
    console.log('  Tags:    ' + p.tags.join(', '));
    console.log('  URL:     ' + p.url);
  });
}
