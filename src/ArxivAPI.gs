/**
 * ArxivAPI.gs — Fetch and parse papers from the arXiv Atom feed API.
 */

var ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
var ATOM_NS  = 'http://www.w3.org/2005/Atom';
var OPENSEARCH_NS = 'http://a9.com/-/spec/opensearch/1.1/';

/**
 * Fetch papers for a domain's categories.
 * Returns an array of paper objects.
 */
function fetchArxivPapers(domainKey, domainConfig, maxResults) {
  if (!domainConfig || !domainConfig.categories || domainConfig.categories.length === 0) {
    console.error('[ArxivAPI] Invalid domainConfig for: ' + domainKey);
    return [];
  }

  var query = domainConfig.categories
    .map(function(c) { return 'cat:' + c; })
    .join(' OR ');

  var url = ARXIV_API_BASE +
    '?search_query=' + encodeURIComponent(query) +
    '&sortBy=submittedDate' +
    '&sortOrder=descending' +
    '&max_results=' + maxResults;

  var response;
  try {
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    console.error('[ArxivAPI] Network error for ' + domainKey + ': ' + e.message);
    return [];
  }

  if (response.getResponseCode() !== 200) {
    console.error('[ArxivAPI] HTTP ' + response.getResponseCode() + ' for ' + domainKey);
    return [];
  }

  return parseAtomFeed(response.getContentText(), domainKey);
}

function parseAtomFeed(xmlContent, domainKey) {
  var doc;
  try {
    doc = XmlService.parse(xmlContent);
  } catch (e) {
    console.error('[ArxivAPI] XML parse error: ' + e.message);
    return [];
  }

  var root = doc.getRootElement();
  var ns   = XmlService.getNamespace(ATOM_NS);
  var entries = root.getChildren('entry', ns);
  var papers  = [];

  entries.forEach(function(entry) {
    var paper = parseEntry(entry, ns, domainKey);
    if (paper) papers.push(paper);
  });

  return papers;
}

function parseEntry(entry, ns, domainKey) {
  var idText = entry.getChildText('id', ns);
  if (!idText) return null;

  // arXiv ID is the last path segment before version suffix
  // e.g. http://arxiv.org/abs/2401.12345v2 → 2401.12345
  var idMatch = idText.match(/abs\/([^v\s]+)/);
  if (!idMatch) return null;
  var arxivId = idMatch[1].trim();

  var title = (entry.getChildText('title', ns) || '')
    .trim().replace(/\s+/g, ' ');

  var abstract = (entry.getChildText('summary', ns) || '')
    .trim().replace(/\s+/g, ' ');

  var published = entry.getChildText('published', ns) || '';
  var updated   = entry.getChildText('updated', ns) || '';

  var authors = entry.getChildren('author', ns).map(function(a) {
    return (a.getChildText('name', ns) || '').trim();
  }).filter(Boolean);

  var categories = entry.getChildren('category', ns).map(function(c) {
    var term = c.getAttribute('term');
    return term ? term.getValue() : '';
  }).filter(Boolean);

  // Primary category from <arxiv:primary_category> or first listed
  var primaryCategory = categories[0] || '';
  var primaryEl = entry.getChild('primary_category');
  if (primaryEl) {
    var termAttr = primaryEl.getAttribute('term');
    if (termAttr) primaryCategory = termAttr.getValue();
  }

  // Derive tags: unique, sorted category list
  var tags = categories.slice().sort().filter(function(v, i, a) {
    return a.indexOf(v) === i;
  });

  return {
    id:               arxivId,
    title:            title,
    abstract:         abstract,
    authors:          authors,
    published:        published,
    updated:          updated,
    url:              'https://arxiv.org/abs/' + arxivId,
    pdf_url:          'https://arxiv.org/pdf/' + arxivId + '.pdf',
    primary_category: primaryCategory,
    categories:       categories,
    tags:             tags,
    domain:           domainKey
  };
}
