/**
 * DedupManager.gs — Tracks downloaded paper IDs to avoid re-downloading.
 *
 * The index lives at DEDUP_INDEX_PATH on the base branch (main).
 * Schema:
 *   {
 *     "paper_ids": ["2401.12345", ...],
 *     "total_count": 42,
 *     "last_updated": "2024-01-15T06:00:00.000Z"
 *   }
 */

/**
 * Loads the dedup index from GitHub.
 * Returns { ids: Object<string,boolean>, sha: string|null, raw: Object|null }
 */
function loadDedupIndex(config) {
  var file = getFile(
    config.githubOwner,
    config.githubRepo,
    config.dedupPath,
    config.baseBranch,
    config.githubToken
  );

  if (!file) {
    console.log('[Dedup] Index not found — will create on first write');
    return { ids: {}, sha: null, raw: null };
  }

  var raw;
  try {
    raw = JSON.parse(file.content);
  } catch (e) {
    console.error('[Dedup] Corrupt index — resetting: ' + e.message);
    return { ids: {}, sha: file.sha, raw: null };
  }

  var ids = {};
  (raw.paper_ids || []).forEach(function(id) { ids[id] = true; });

  console.log('[Dedup] Loaded ' + Object.keys(ids).length + ' existing IDs');
  return { ids: ids, sha: file.sha, raw: raw };
}

/**
 * Filters papers to only those not already in the index.
 */
function filterNewPapers(papers, existingIds) {
  return papers.filter(function(p) { return !existingIds[p.id]; });
}

/**
 * Persists the updated index back to the base branch.
 */
function saveDedupIndex(config, newPapers, dedupState) {
  var raw = dedupState.raw || { paper_ids: [], total_count: 0 };

  newPapers.forEach(function(p) {
    raw.paper_ids.push(p.id);
  });
  raw.total_count   = raw.paper_ids.length;
  raw.last_updated  = new Date().toISOString();

  putFile(
    config.githubOwner,
    config.githubRepo,
    config.dedupPath,
    JSON.stringify(raw, null, 2),
    'chore: update dedup index (+' + newPapers.length + ' papers, total=' + raw.total_count + ')',
    config.baseBranch,
    config.githubToken,
    dedupState.sha
  );

  console.log('[Dedup] Index saved. Total: ' + raw.total_count);
}
