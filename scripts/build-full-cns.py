"""Reproducible full annotated MaleCNS graph. Data CC BY 4.0, code MIT.
No path-length, cell-class, or edge-weight pruning. See docs/full-cns.md.
"""
import sys, json, hashlib, struct, gzip, shutil, collections
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.cache/python-deps'))
import numpy as np
import pyarrow as pa
import pyarrow.feather as feather
CACHE = ROOT / '.cache/malecns-upstream'
OUT = ROOT / '.cache/full-cns'
OUT.mkdir(parents=True, exist_ok=True)

def digest(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def save_json(name, value):
    p = OUT / name
    p.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    return {'sha256': digest(p), 'bytes': p.stat().st_size}

source = json.loads((ROOT / 'data/SOURCE_DATA.json').read_text(encoding='utf-8'))
assets = source['source_files']
for s in assets:
    p = CACHE / s['name']
    if not p.exists() and '--download' in sys.argv:
        import urllib.request
        if Path(s['name']).name != s['name'] or not s['url'].startswith('https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/'):
            raise ValueError('Unexpected source location')
        CACHE.mkdir(parents=True, exist_ok=True)
        temp = p.with_suffix(p.suffix + '.partial')
        print('Downloading', s['name'], flush=True)
        with urllib.request.urlopen(s['url']+'?generation='+s['gcs_generation'], timeout=90) as response, temp.open('wb') as output:
            shutil.copyfileobj(response, output, length=1024*1024)
        if temp.stat().st_size != s['bytes'] or digest(temp) != s['sha256']:
            raise ValueError('Downloaded source identity mismatch')
        temp.rename(p)
    if not p.exists():
        raise FileNotFoundError('Run npm run data:full -- --download to fetch '+s['name'])
    if p.stat().st_size != s['bytes'] or digest(p) != s['sha256']:
        raise ValueError('Source identity mismatch: ' + s['name'])
    print('Verified', s['name'], flush=True)
ann = feather.read_table(CACHE / assets[0]['name'])
all_rows = ann.to_pylist()
rows = sorted([r for r in all_rows if r['superclass'] and r['status'] != 'Glia'], key=lambda r: r['bodyId'])
ids = np.array([r['bodyId'] for r in rows], dtype=np.int64)
n = len(rows)
assert n == 166700 and len(np.unique(ids)) == n
index = {int(body): i for i, body in enumerate(ids)}
# Exact NT source rows, including confidence and ground-truth provenance.
nt_table = feather.read_table(CACHE / assets[1]['name'])
nt_columns = nt_table.column_names
nts = {r['body']: r for r in nt_table.to_pylist() if r['body'] in index}
stats_reader = pa.ipc.open_file(pa.memory_map(str(CACHE / assets[3]['name']), 'r'))
stats_columns = stats_reader.schema.names
stats = {}
stats_source_rows = 0
for k in range(stats_reader.num_record_batches):
    batch = stats_reader.get_batch(k)
    bodies = batch.column(0).to_numpy()
    positions = np.searchsorted(ids, bodies)
    selected = (positions < n) & (ids[np.minimum(positions, n-1)] == bodies)
    stats_source_rows += len(bodies)
    for r in batch.filter(pa.array(selected)).to_pylist():
        stats[r['body']] = r
del stats_reader
columns = ann.column_names + ['nt_' + c for c in nt_columns if c != 'body'] + ['stats_' + c for c in stats_columns if c != 'body']
records = [[r.get(c) for c in ann.column_names] + [nts.get(r['bodyId'], {}).get(c) for c in nt_columns if c != 'body'] + [stats.get(r['bodyId'], {}).get(c) for c in stats_columns if c != 'body'] for r in rows]
meta_hash = save_json('neurons.json', {'schema': 1, 'columns': columns, 'records': records})
del all_rows, ann, records, nt_table
incoming = np.zeros(n, dtype=np.float64)
parts_from, parts_to, parts_w = [], [], []
raw_edges = raw_contacts = kept_contacts = 0
reader = pa.ipc.open_file(pa.memory_map(str(CACHE / assets[2]['name']), 'r'))
# Map record batches: avoids materializing 151M original edges at once.
for k in range(reader.num_record_batches):
    batch = reader.get_batch(k)
    pre = batch.column(0).to_numpy()
    post = batch.column(1).to_numpy()
    weight = batch.column(2).to_numpy()
    assert np.all(weight > 0)
    a, b = np.searchsorted(ids, pre), np.searchsorted(ids, post)
    good_b = (b < n) & (ids[np.minimum(b, n-1)] == post)
    incoming += np.bincount(b[good_b], weights=weight[good_b], minlength=n)
    good = good_b & (a < n) & (ids[np.minimum(a, n-1)] == pre)
    parts_from.append(a[good].astype('<u4'))
    parts_to.append(b[good].astype('<u4'))
    parts_w.append(weight[good].astype('<u4'))
    raw_edges += len(weight)
    raw_contacts += int(weight.sum())
    kept_contacts += int(weight[good].sum())
    if k % 300 == 0:
        print('Read edges', raw_edges, flush=True)
a, b, w = np.concatenate(parts_from), np.concatenate(parts_to), np.concatenate(parts_w)
del parts_from, parts_to, parts_w, reader
assert incoming.max() < 2**32
incoming = incoming.astype('<u4')
order = np.lexsort((a, b))
a, b, w = a[order], b[order], w[order]
del order
e = len(a)
assert e < 2**32
# Reject duplicates rather than silently losing or reweighting contacts.
assert not np.any((a[1:] == a[:-1]) & (b[1:] == b[:-1]))
offsets = np.concatenate(([0], np.cumsum(np.bincount(b, minlength=n)))).astype('<u4')
assert int(offsets[-1]) == e
with (OUT / 'graph.bin').open('wb') as f:
    f.write(struct.pack('<8sIIIIII', b'MCNSF001', n, e, 1, 0, 0, 0))
    for array in (offsets, a, w, incoming):
        array.tofile(f)
graph_hash = {'sha256': digest(OUT / 'graph.bin'), 'bytes': (OUT / 'graph.bin').stat().st_size}
# Infer receptor columns ONLY through annotated ipsilateral postsynaptic columns.
# Keep a weighted receptive field (no invented ID-order mapping, no winner threshold).
photo = np.array([r['superclass'] == 'ol_sensory' and r['class'] == 'visual' for r in rows])
side = [r['rootSide'] or r['somaSide'] for r in rows]
hexed = np.array([r['assignedOlHex1'] is not None and r['assignedOlHex2'] is not None for r in rows])
select = np.flatnonzero(photo[a] & hexed[b])
receptive = collections.defaultdict(collections.Counter)
for k in select:
    src, dst = int(a[k]), int(b[k])
    if side[src] in ('L', 'R') and side[src] == side[dst]:
        receptive[src][(int(rows[dst]['assignedOlHex1']), int(rows[dst]['assignedOlHex2']))] += int(w[k])
placements = []
for i in np.flatnonzero(photo):
    hits = receptive.get(int(i))
    if not hits:
        continue
    total = sum(hits.values())
    placements.append({'index': int(i), 'bodyId': int(ids[i]), 'side': side[i], 'type': rows[i]['type'],
                       'contacts': total, 'dominantShare': max(hits.values()) / total,
                       'columns': [[q, r, count] for (q, r), count in sorted(hits.items())]})
columns_by_side = {s: sorted({(int(r['assignedOlHex1']), int(r['assignedOlHex2'])) for r in rows if r['assignedOlHex1'] is not None and (r['somaSide'] or r['rootSide']) == s}) for s in ('L','R')}
retina_hash = save_json('retina.json', {'schema': 1, 'method': 'Weighted ipsilateral postsynaptic assignedOlHex1/2; inferred receptive fields, not measured retinal optics.', 'columns': columns_by_side, 'photoreceptors': placements})
classes = collections.Counter(r['superclass'] for r in rows)
sensory = [r for r in rows if 'sensory' in r['superclass']]
manifest = {'schema': 1, 'dataset': 'male-cns:v1.0', 'license': 'CC-BY-4.0',
    'source': assets, 'selection': 'All annotations with nonempty superclass and status != Glia, sorted by bodyId; all induced connections, including weight=1 and self edges. Unclassified segments/fragments remain outside the neuronal model.',
    'normalization': 'Original contact count divided by each destination total from ALL source segments, including omitted unclassified segments; those omitted sources contribute zero.',
    'counts': {'neurons': n, 'edges': e, 'contacts': kept_contacts, 'sourceAnnotationRows': 211577, 'sourceStatisticsRows': stats_source_rows, 'neuronsWithStatistics': len(stats),
               'sourceSegmentEdges': raw_edges, 'sourceSegmentContacts': raw_contacts,
               'excludedAnnotationRows': 211577-n, 'excludedSegmentEdges': raw_edges-e,
               'excludedSegmentContacts': raw_contacts-kept_contacts, 'selfEdges': int(np.count_nonzero(a == b)),
               'zeroIncoming': int(np.count_nonzero(np.diff(offsets) == 0)), 'maxContactsPerEdge': int(w.max())},
    'superclasses': dict(sorted(classes.items())),
    'sensoryClasses': dict(sorted(collections.Counter(r['class'] or 'unassigned' for r in sensory).items())),
    'transmitters': dict(sorted(collections.Counter(nts.get(r['bodyId'], {}).get('consensus_nt') or 'unknown' for r in rows).items())),
    'retina': {'photoreceptors': int(photo.sum()), 'mapped': len(placements), 'unmapped': int(photo.sum())-len(placements), 'columns': {s: len(v) for s,v in columns_by_side.items()},
               'method': 'Weighted anatomical outgoing contacts to ipsilateral annotated columns; weights retained for all candidates, ambiguity reported. Optical projection and spectral gains are engineering assumptions.'},
    'files': {'graph.bin': graph_hash, 'neurons.json': meta_hash, 'retina.json': retina_hash},
    'build': {'numpy': np.__version__, 'pyarrow': pa.__version__},
    'learning': False}
save_json('manifest.json', manifest)
(ROOT / 'data/full-cns-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
# Deterministic gzip, served transparently by local server. Plain binaries remain for Node.
for name in ['graph.bin', 'neurons.json', 'retina.json']:
    with (OUT / name).open('rb') as src, (OUT / (name+'.gz')).open('wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
print(json.dumps({'counts': manifest['counts'], 'retina': manifest['retina'], 'transmitters': manifest['transmitters'], 'files': manifest['files']}), flush=True)
