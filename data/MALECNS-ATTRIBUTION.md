# MaleCNS data in Malecns Warhammer

Current version 0.9 adds exact official neurotransmitter annotations and an optional
signed, rectified rate model. Earlier sections below document historical versions;
the 0.9 section specifies the current changes and remaining limitations.
The bundled data in dist/data/malecns-escape.mjs and dist/data/malecns-motor.mjs is licensed CC BY 4.0,
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

## Visual-motor extension in 0.5

A second reduced model is bundled as dist/data/malecns-motor.mjs under the same
CC BY 4.0 data license. The source FCL and neuron annotations are identical to
the pinned distributor revision d36ff5e192da832c4348ab509d150357cb70ddd8.

Selected LC4/LPLC2 and LC10 inputs, DNa01/DNa02/DNp09/MDN and
DNp01/DNp02/DNp04/DNp11 populations, plus all intermediary neurons on directed
input-to-output paths of at most three edges. Retained the entire induced graph:
11,436 neurons, 1,687,031 directed edges, 10,931,415 original integer contacts.
No contact threshold or synthetic edges were introduced. Other neurons and
their incident connections were omitted. Original body IDs, types, sides,
execution indices and full-source incoming totals are retained.

The graph is packed as incoming CSR with uint32 row offsets and uint16
source/contact pairs. Its binary payload has 6,793,872 bytes. Data and calibration
are pinned by SHA-256 in data/motor-manifest.json. Reproduce using
scripts/import-motor.mjs after fetching the pinned source files.

Float32 leaky-rate dynamics use the same engineering constants as the compact
model: gain 0.7, leak 0.5, amplitude 0.8, full-source incoming normalization.
There are eight neural steps per unit activation. Symmetric target-only and
threat-only inputs at 0.5 for 32 steps provide reference output scales;
no behavioral reward, training or combat tuning is used for this calibration.

The added game controller reads DNa02, DNp09, MDN and escape outputs to score
forward, reverse, left, right and wait commands. DNa01 is retained in the graph
but is not directly read by the current steering decoder. Selection was informed
by primary studies of descending motor networks and steering:
https://www.nature.com/articles/s41586-024-07523-9
https://pmc.ncbi.nlm.nih.gov/articles/PMC12279373/

These populations have context-dependent biological functions. The command
mapping is an engineered adapter, not a reproduction of those experiments.
Scene projection, background visual stimulus, command coefficients, waiting
threshold, collision checks, the conversion of forward into fire and nearest
visible in-sector target binding are all software rules added by this project.
Tactical utility and pathfinding do not choose actions in the new mode.
The old hybrid/reflex mode remains available separately.

No transmitter signs, inhibition, spikes, full retinal model, morphology,
learning, validated fly behavior or full CNS are simulated. The larger number
of anatomical connections does not establish biological fidelity or strategic
competence. Each game unit has independent computed activity over the same graph.

## Aim and fire decoder in 0.6

Anatomical data, selected cells, positive contact counts, normalization, dynamics
and calibration remain byte-identical to 0.5. DNa01, already retained in the
graph, is now read by the engineered visual-motor-v2 adapter.

Normalized DNa01 L/R produce an independent fire score (L + R) / 2 and an aim
offset atan2(R - L, R + L), bounded to +/-45 degrees. A total at most 1e-9 means
no aim. Legal visible targets in weapon range and the body's +/-45-degree sector
are ranked by angular deviation from that direction; exact ties use ID.
Distance, health, damage and cover do not score targets. Exact action-score ties
use fire, advance, left, right, reverse, wait order. Advance stays a movement
command even when a target is present.

These are new game-interface rules, not a claim that DNa01 biologically encodes
weapons, target identity or attack decisions. A causal probe holds the board and
initial activity fixed and changes only LC10 input balance, showing a different
attacked target; edge removal and zero stimulus are controls. No brain training,
new anatomy or inferred transmitter signs were introduced.

## Navigation adapter in 0.7

The anatomy, unsigned contacts, rate dynamics, calibration and model SHA-256
remain unchanged. binocular-passages-v2 adds five local clearance rays (four
grid steps) to engineered LC10 inputs; visible object salience attenuates this
exploration stimulus. Static obstacle/adjacent ally threat is multiplied by
max(0, cos(relative bearing)) squared. Rear/peripheral walls no longer generate
the same approaching-threat signal as a frontal collision.

visual-motor-v3 retains all prior scores except reverse:
max(0, 1.1 * min(normalized escape L, escape R, mean MDN) - 0.5 * advance).
This opponent readout reduces repeated backing up and returning. It is an
engineering choice, not a biological claim about locomotor inhibition.
No path planner, learned weights, visit memory or trained tactical policy was
added. All enabled commands still compete through neural output scores;
disconnecting edges at zero initial activity produces no movement.

## Engineered experience modules in 0.8

The fixed anatomical CSR, contact counts, normalization, neural dynamics and
model SHA-256 remain unchanged. Per-unit visitation counts and remembered mission
landmarks modify the four engineered sensory channels. Familiar forward cells
can provide an aversive memory stimulus; this is not measured biological looming.

An additional 6-by-13 linear action-value readout learns from normalized MaleCNS
output features using a bounded semi-gradient Sarsa(lambda) update with accumulating
traces. Its weights, reward function, exploration, spatial memory and landmark
recall are application code. Neither anatomical synaptic plasticity nor biological
memory is reconstructed. No hidden tactical planner provides its action scores.
See docs/experience.md for coefficients, causal controls and limitations.

## Neurotransmitter annotations and signed transmission in 0.9

dist/data/malecns-neurotransmitters.mjs contains exact selected rows from the
official body-neurotransmitters-male-cns-v1.0.feather, licensed CC BY 4.0.
The dataset attribution above applies. Source URL, generation, byte length,
SHA-256, selected IDs and build version are recorded in
data/neurotransmitter-manifest.json; this project now directly verifies that
official Feather source, in addition to the pinned distributor graph assets.

The body-ID join covers all 11,436 selected neurons, including the compact 319.
consensus_nt is used without substituting labels from another specimen.
Individual and cell-type predictions, confidence fields, counts and ground_truth
are preserved separately. Confidence of a constituent prediction is not claimed
as the confidence of the consensus annotation. The data hash is separate from
the unchanged anatomical graph hash.

The optional model assigns +1 to acetylcholine and -1 to GABA. Glutamate is -1
by default, with a +1 sensitivity-control mode. Unclear, dopamine, serotonin and
octopamine labels receive zero assumed fast effect; this is an engineering
omission, not a claim of absent biological influence. Receptor specificity,
modulator dynamics, cotransmission, concentration, spikes and biological
plasticity are not reconstructed. The rectified tanh prevents negative rates.
Normalization and game-decoder reference scales are unchanged.

The original unsigned mode remains available. The data, inferred transmitter
identity, assumed effect and game interpretation are distinct. See
docs/neurotransmitters.md and docs/malecns-scope.md. No biological equivalence
or tactical-performance claim is made.
