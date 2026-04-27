/**
 * Config.gs — Central configuration and domain definitions.
 *
 * Set these values in Apps Script > Project Settings > Script Properties:
 *   GITHUB_TOKEN  — Personal Access Token with repo scope
 *   GITHUB_OWNER  — Your GitHub username or org
 *   GITHUB_REPO   — Target repository name
 */

var TRIGGER_HOUR_UTC = 6; // 6 AM UTC daily

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var owner = props.getProperty('GITHUB_OWNER');
  var repo  = props.getProperty('GITHUB_REPO');

  if (!token) throw new Error('Missing Script Property: GITHUB_TOKEN');
  if (!owner) throw new Error('Missing Script Property: GITHUB_OWNER');
  if (!repo)  throw new Error('Missing Script Property: GITHUB_REPO');

  return {
    githubToken: token,
    githubOwner: owner,
    githubRepo:  repo,
    baseBranch:  'main',
    maxResults:  30,
    dedupPath:   'paper_index.json',
    domains: {
      AI:      { categories: ['cs.AI', 'cs.LG', 'stat.ML'] },
      Vision:  { categories: ['cs.CV'] },
      Agent:   { categories: ['cs.MA', 'cs.RO'] },
      Quant:   { categories: ['q-fin.CP', 'q-fin.MF', 'q-fin.PM', 'q-fin.ST', 'q-fin.RM'] },
      Trading: { categories: ['q-fin.TR', 'q-fin.EC', 'q-fin.GN'] }
    }
  };
}
