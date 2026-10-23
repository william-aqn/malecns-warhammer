# MaleCNS data in Malecns Warhammer
The bundled data in dist/data/malecns-escape.mjs is licensed CC BY 4.0,
independently of the application's MIT code license.

## Additional modifications in this project
Selected the 319 input/output neurons of slvDev's pinned escape circuit:
LC4/LPLC2 and DNp01/DNp02/DNp04/DNp11, both sides. Retained the induced
subgraph: 21,288 directed edges and 102,445 original integer synaptic contacts,
without thresholding. All other neurons and their incident connections were removed.
Indices were compacted; original body IDs, types, sides and source execution indices
are retained. Each node also records its incoming contact total in the source graph.

The JavaScript rate dynamics use float32 state, original unsigned contact counts,
source-graph incoming normalization, gain 0.7, leak 0.5 and input amplitude 0.8.
This is a new reduced simulation. It is not the full upstream model or a validated
reproduction of its behavioral/numerical results. Transmitter signs, morphology,
spikes, detailed biophysics and the rest of the nervous system are not simulated.

Threat encoding, temperament thresholds, action interruption and Warhammer-inspired
game mechanics were added by this project. They are engineering choices.
No claim of endorsement, biological equivalence or tactical superiority is made.

The extraction is reproducible with scripts/import-malecns.mjs.
Source assets are pinned by revision, byte count and SHA-256 in that script and
data/malecns-manifest.json. data/SOURCE_DATA.json preserves the distributor's
upstream-file provenance; we verified the distributed FCL/CSV/circuit package,
not a new extraction from the original 1.1 GB Feather graph.

## Preserved upstream notice

# Attribution and redistribution

## Upstream data

MaleCNS v1.0, the male Drosophila melanogaster central nervous system connectome.
Credit: the FlyEM Project at HHMI Janelia Research Campus, University of Cambridge
Department of Zoology, MRC Laboratory of Molecular Biology and Google Research.

- Project and licensing statement: https://male-cns.janelia.org/
- Official bulk downloads: https://male-cns.janelia.org/download/
- Dataset version history: https://male-cns.janelia.org/release/
- License: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/
- Legal code: https://creativecommons.org/licenses/by/4.0/legalcode.en

Citation: Stuart Berg, Isabella R. Beckett, Marta Costa, Philipp Schlegel,
Michał Januszewski, et al. *Sexual dimorphism in the complete Drosophila male
central nervous system connectome*. Cell 189(18), 5504–5526.e15 (2026).
https://doi.org/10.1016/j.cell.2026.08.015

The versioned annotation and connection-strength files are identified by URL,
byte length, SHA-256, GCS generation and recorded GCS MD5 in `SOURCE_DATA.json`.
Annotations determine membership and body IDs; the connection-strength table
supplies positive integer contact counts. The other two files listed there were
downloaded during research but are not used as signed weights or geometry here.
No upstream raw Feather files, EM images, skeletons or article PDF are bundled.

## Changes in this distribution

Viacheslav Sierbov / slvDev selected cells by annotation superclass, kept the
induced graph between those cells, reordered its local indices and compressed
it into independent LZ4 blocks. Retained topology and integer contact counts
are unchanged. `neurons.csv` maps execution indices back to upstream body IDs.

The simulation adds row normalization, Q29 state arithmetic and a tanh rate
update. The demonstration adds an escape circuit: a list of looming input
neurons, a list of escape output neurons, one input amplitude and one threshold,
chosen by stimulating groups of neurons and measuring which descending neurons
answer. Those choices and the escape results belong to this project, not to the
upstream connectome authors. Nothing in the package is trained: no trained
parameters and no firmware binaries are included, and the gold files are
numerical references for the graph and the circuit. This package release is
`1.1.0`; release `1.0.0` shipped the same graph with a trained Pong readout.

## Distribution terms

The official project and download pages link the dataset license directly to
CC BY 4.0. CC BY 4.0
allows redistribution and adaptation, including commercial use, subject to its
terms. This package retains credit, source links, the license and an account of
modifications. Redistribution must preserve the applicable notices and must
not imply endorsement or add restrictions inconsistent with the license.
The full legal text is in `LICENSE`; it governs over this brief explanation.

The model/data package and this model card are available under CC BY 4.0.
The independently authored firmware and analysis source snapshot retains the
MIT license from esp32-ai, included in `LICENSE-CODE` and inside the archive.
No upstream dataset rights are relicensed as MIT. No access gate, additional
use restriction or payment requirement is added by this release.

## Game controller update in 0.3
The anatomical subgraph and its dynamics are unchanged. A per-agent sensitivity
gain (0–2, default 1) scales the readout used by the game. The separate action gate
allows up to two neural-priority activations, then five recovery activations,
then requires a fall to 65% of the onset threshold before rearming.
These constants describe engineered gameplay, not measured fly refractory times.
