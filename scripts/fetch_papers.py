#!/usr/bin/env python3
"""Daily arXiv paper fetcher — runs via GitHub Actions."""

import base64
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import quote

import requests

# ── Domains ────────────────────────────────────────────────────────────────────

DOMAINS: dict[str, list[str]] = {
    'AI':      ['cs.AI', 'cs.LG', 'stat.ML'],
    'Vision':  ['cs.CV'],
    'Agent':   ['cs.MA', 'cs.RO'],
    'Quant':   ['q-fin.CP', 'q-fin.MF', 'q-fin.PM', 'q-fin.ST', 'q-fin.RM'],
    'Trading': ['q-fin.TR', 'q-fin.EC', 'q-fin.GN'],
}

# ── Constants ──────────────────────────────────────────────────────────────────

ARXIV_API  = 'https://export.arxiv.org/api/query'
GITHUB_API = 'https://api.github.com'
DEDUP_PATH = 'paper_index.json'
BASE_BRANCH = 'main'
MAX_RESULTS = 30
ATOM_NS    = '{http://www.w3.org/2005/Atom}'
ARXIV_NS   = '{http://arxiv.org/schemas/atom}'

# ── GitHub client ──────────────────────────────────────────────────────────────

class GitHub:
    def __init__(self, token: str, owner: str, repo: str) -> None:
        self.owner = owner
        self.repo  = repo
        self._s    = requests.Session()
        self._s.headers.update({
            'Authorization': f'token {token}',
            'Accept':        'application/vnd.github.v3+json',
            'User-Agent':    'arxiv-loader',
        })

    def _url(self, path: str) -> str:
        return f'{GITHUB_API}/repos/{self.owner}/{self.repo}{path}'

    def branch_sha(self, branch: str) -> str | None:
        r = self._s.get(self._url(f'/git/ref/heads/{branch}'))
        return r.json()['object']['sha'] if r.ok else None

    def ensure_branch(self, branch: str) -> None:
        if self.branch_sha(branch):
            return
        base = self.branch_sha(BASE_BRANCH)
        if not base:
            raise RuntimeError(f'Base branch "{BASE_BRANCH}" not found')
        r = self._s.post(self._url('/git/refs'),
                         json={'ref': f'refs/heads/{branch}', 'sha': base})
        r.raise_for_status()
        print(f'[GitHub] Created branch: {branch}')

    def get_file(self, path: str, branch: str) -> dict | None:
        r = self._s.get(self._url(f'/contents/{path}'), params={'ref': branch})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        data = r.json()
        return {
            'content': base64.b64decode(data['content']).decode(),
            'sha':     data['sha'],
        }

    def put_file(self, path: str, content: str, message: str,
                 branch: str, sha: str | None = None) -> None:
        body: dict = {
            'message': message,
            'content': base64.b64encode(content.encode()).decode(),
            'branch':  branch,
        }
        if sha:
            body['sha'] = sha
        r = self._s.put(self._url(f'/contents/{path}'), json=body)
        r.raise_for_status()

# ── arXiv fetcher ──────────────────────────────────────────────────────────────

def fetch_papers(domain: str, categories: list[str]) -> list[dict]:
    query = ' OR '.join(f'cat:{c}' for c in categories)
    url   = (f'{ARXIV_API}?search_query={quote(query)}'
             f'&sortBy=submittedDate&sortOrder=descending&max_results={MAX_RESULTS}')
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f'[arXiv] {domain} error: {e}', file=sys.stderr)
        return []
    return _parse_feed(r.text, domain)


def _parse_feed(xml_text: str, domain: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f'[arXiv] XML error: {e}', file=sys.stderr)
        return []
    return [p for e in root.findall(f'{ATOM_NS}entry')
            if (p := _parse_entry(e, domain)) is not None]


def _parse_entry(entry, domain: str) -> dict | None:
    id_el = entry.find(f'{ATOM_NS}id')
    if id_el is None:
        return None
    m = re.search(r'abs/([^v\s]+)', id_el.text or '')
    if not m:
        return None
    arxiv_id = m.group(1).strip()

    title    = re.sub(r'\s+', ' ', (entry.findtext(f'{ATOM_NS}title')   or '').strip())
    abstract = re.sub(r'\s+', ' ', (entry.findtext(f'{ATOM_NS}summary') or '').strip())
    published = entry.findtext(f'{ATOM_NS}published') or ''
    updated   = entry.findtext(f'{ATOM_NS}updated')   or ''

    authors = [
        a.findtext(f'{ATOM_NS}name', '').strip()
        for a in entry.findall(f'{ATOM_NS}author')
        if a.findtext(f'{ATOM_NS}name', '').strip()
    ]
    categories = [
        c.get('term', '') for c in entry.findall(f'{ATOM_NS}category')
        if c.get('term')
    ]
    primary = categories[0] if categories else ''
    pc = entry.find(f'{ARXIV_NS}primary_category')
    if pc is not None:
        primary = pc.get('term', primary)

    return {
        'id':               arxiv_id,
        'title':            title,
        'abstract':         abstract,
        'authors':          authors,
        'published':        published,
        'updated':          updated,
        'url':              f'https://arxiv.org/abs/{arxiv_id}',
        'pdf_url':          f'https://arxiv.org/pdf/{arxiv_id}.pdf',
        'primary_category': primary,
        'categories':       categories,
        'tags':             sorted(set(categories)),
        'domain':           domain,
    }

# ── Dedup ──────────────────────────────────────────────────────────────────────

def load_index(gh: GitHub) -> tuple[set[str], str | None, dict]:
    f = gh.get_file(DEDUP_PATH, BASE_BRANCH)
    if not f:
        print('[Dedup] No index found, starting fresh')
        return set(), None, {'paper_ids': [], 'total_count': 0}
    raw = json.loads(f['content'])
    ids = set(raw.get('paper_ids', []))
    print(f'[Dedup] Loaded {len(ids)} existing IDs')
    return ids, f['sha'], raw


def save_index(gh: GitHub, new_papers: list[dict], raw: dict, sha: str | None) -> None:
    raw['paper_ids'].extend(p['id'] for p in new_papers)
    raw['total_count']  = len(raw['paper_ids'])
    raw['last_updated'] = datetime.now(timezone.utc).isoformat()
    gh.put_file(
        DEDUP_PATH,
        json.dumps(raw, indent=2),
        f'chore: update index (+{len(new_papers)}, total={raw["total_count"]})',
        BASE_BRANCH,
        sha,
    )
    print(f'[Dedup] Saved. Total: {raw["total_count"]}')

# ── Push helpers ───────────────────────────────────────────────────────────────

def _group(papers: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list] = {}
    for p in papers:
        out.setdefault(p['domain'], []).append(p)
    return out


def push_domain_files(gh: GitHub, papers: list[dict], branch: str) -> None:
    for domain, fresh in _group(papers).items():
        path     = f'{branch}/{domain.lower()}/papers.json'
        existing = gh.get_file(path, branch)
        prior    = json.loads(existing['content'])['papers'] if existing else []
        merged   = prior + fresh
        gh.put_file(
            path,
            json.dumps({'domain': domain, 'date': branch,
                        'count': len(merged), 'papers': merged}, indent=2),
            f'feat({domain}): add {len(fresh)} papers [{branch}]',
            branch,
            existing['sha'] if existing else None,
        )
        print(f'[Push] {domain} → {path} ({len(fresh)} papers)')
        time.sleep(0.5)


def push_summary(gh: GitHub, papers: list[dict], branch: str, stats: dict) -> None:
    card_keys = ('id', 'title', 'authors', 'url', 'pdf_url',
                 'published', 'primary_category', 'tags', 'domain')
    cards     = [{k: p[k] for k in card_keys} for p in papers]
    path      = f'{branch}/summary.json'
    existing  = gh.get_file(path, branch)
    gh.put_file(
        path,
        json.dumps({
            'date':         branch,
            'total_papers': len(papers),
            'domain_stats': stats,
            'papers':       _group(cards),
            'generated_at': datetime.now(timezone.utc).isoformat(),
        }, indent=2),
        f'chore: daily summary for {branch} ({len(papers)} papers)',
        branch,
        existing['sha'] if existing else None,
    )
    print(f'[Push] summary → {path}')

# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    token    = os.environ.get('GITHUB_TOKEN', '')
    repo_env = os.environ.get('GITHUB_REPOSITORY', '')

    if not token:
        sys.exit('ERROR: GITHUB_TOKEN not set')
    if '/' not in repo_env:
        sys.exit('ERROR: GITHUB_REPOSITORY must be "owner/repo"')

    owner, repo = repo_env.split('/', 1)
    gh    = GitHub(token, owner, repo)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    print(f'=== ArxivLoader start: {today} ===')

    gh.ensure_branch(today)
    existing_ids, index_sha, index_raw = load_index(gh)

    all_new: list[dict] = []
    stats: dict[str, dict] = {}

    for domain, categories in DOMAINS.items():
        print(f'[{domain}] Fetching...')
        fetched = fetch_papers(domain, categories)
        fresh   = [p for p in fetched if p['id'] not in existing_ids]
        existing_ids.update(p['id'] for p in fresh)
        all_new.extend(fresh)
        stats[domain] = {'fetched': len(fetched), 'new': len(fresh)}
        print(f'[{domain}] fetched={len(fetched)} new={len(fresh)}')
        time.sleep(3)   # polite arXiv rate limit

    if not all_new:
        print('No new papers today — nothing pushed.')
        return

    push_domain_files(gh, all_new, today)
    push_summary(gh, all_new, today, stats)
    save_index(gh, all_new, index_raw, index_sha)

    print(f'=== Done: {len(all_new)} new papers pushed to branch {today} ===')


if __name__ == '__main__':
    main()
