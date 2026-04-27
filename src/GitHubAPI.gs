/**
 * GitHubAPI.gs — Thin wrapper around the GitHub REST API v3.
 */

var GITHUB_API_BASE = 'https://api.github.com';

// ---------- Core request ----------

function githubRequest(method, path, body, token) {
  var options = {
    method:           method,
    headers: {
      'Authorization': 'token ' + token,
      'Accept':        'application/vnd.github.v3+json',
      'Content-Type':  'application/json',
      'User-Agent':    'ArxivLoader-AppsScript'
    },
    muteHttpExceptions: true
  };

  if (body !== null && body !== undefined) {
    options.payload = JSON.stringify(body);
  }

  var response = UrlFetchApp.fetch(GITHUB_API_BASE + path, options);
  var code     = response.getResponseCode();
  var text     = response.getContentText();

  if (code >= 400) {
    throw new Error('GitHub API ' + method + ' ' + path +
      ' → ' + code + ': ' + text.slice(0, 300));
  }

  return text ? JSON.parse(text) : null;
}

// ---------- Branch operations ----------

/**
 * Returns the commit SHA at the tip of a branch, or null if branch is absent.
 */
function getBranchSha(owner, repo, branch, token) {
  try {
    var result = githubRequest(
      'GET',
      '/repos/' + owner + '/' + repo + '/git/ref/heads/' + branch,
      null,
      token
    );
    return result.object.sha;
  } catch (e) {
    if (e.message.indexOf('404') !== -1) return null;
    throw e;
  }
}

/**
 * Creates a new branch pointing at fromSha.
 */
function createBranch(owner, repo, branchName, fromSha, token) {
  githubRequest(
    'POST',
    '/repos/' + owner + '/' + repo + '/git/refs',
    { ref: 'refs/heads/' + branchName, sha: fromSha },
    token
  );
}

/**
 * Ensures branch exists; creates it from baseBranch HEAD if not.
 * Returns the tip SHA of the (possibly new) branch.
 */
function ensureBranch(owner, repo, branchName, baseBranch, token) {
  var sha = getBranchSha(owner, repo, branchName, token);
  if (sha) return sha;

  var baseSha = getBranchSha(owner, repo, baseBranch, token);
  if (!baseSha) throw new Error('Base branch "' + baseBranch + '" not found');

  createBranch(owner, repo, branchName, baseSha, token);
  console.log('[GitHub] Created branch: ' + branchName);
  return baseSha;
}

// ---------- File operations ----------

/**
 * Returns { content: string, sha: string } or null if file is absent.
 */
function getFile(owner, repo, path, branch, token) {
  try {
    var result = githubRequest(
      'GET',
      '/repos/' + owner + '/' + repo + '/contents/' + path + '?ref=' + branch,
      null,
      token
    );
    var decoded = Utilities.newBlob(
      Utilities.base64Decode(result.content.replace(/\n/g, ''))
    ).getDataAsString('UTF-8');
    return { content: decoded, sha: result.sha };
  } catch (e) {
    if (e.message.indexOf('404') !== -1) return null;
    throw e;
  }
}

/**
 * Creates or updates a file in the given branch.
 * Pass existingSha when updating an existing file.
 */
function putFile(owner, repo, path, content, commitMessage, branch, token, existingSha) {
  var body = {
    message: commitMessage,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch:  branch
  };
  if (existingSha) body.sha = existingSha;

  githubRequest(
    'PUT',
    '/repos/' + owner + '/' + repo + '/contents/' + path,
    body,
    token
  );
}
