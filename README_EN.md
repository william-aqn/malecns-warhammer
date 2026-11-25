# MaleCNS Warhammer — Behavioral Sandbox

MaleCNS v1.0 maps connections between neurons in the central nervous system of a male fruit fly (*Drosophila melanogaster*). This project uses that wiring in two browser simulations. The **sensory lab** in version **0.10** connects the full annotated graph to a simulated body and environment, with learning disabled. The **tactical sandbox** uses smaller circuits to control pieces on a game board and includes an optional readout that learns from play. It uses original game rules inspired by Warhammer 40,000 and Kill Team.

## Version 0.10 — Full annotated graph and sensory environment

On a fresh clone, install Node.js, Python 3.12 or later, and `uv`. From the repository root, run the following to download about 1.9 GB of source tables and build the lab data. Once the data is in `.cache/full-cns/`, you can start the lab directly.

```sh
npm run data:full -- --download
```

On Windows, double-click [start-lab.cmd](start-lab.cmd). It starts the server and opens the lab in your browser. On any platform, you can start the server yourself and open the lab URL it prints.

```sh
npm start
```

Keep the server window open. The usual address is [http://127.0.0.1:4177/lab.html](http://127.0.0.1:4177/lab.html). If that port is busy, the server selects a free one and prints the address after it starts listening.

- The graph contains **166,700 neurons**, **25,582,938 directed connections**, and **124,177,617 synaptic contacts**. Each connection can represent multiple contacts between the same two neurons. The graph includes visual circuits, the ventral nerve cord (VNC), and ascending pathways without a path-length cutoff.
- The two eyes have 1,771 columns in total. Anatomical connections assign 5,895 photoreceptors to columns.
- Nine sensory modalities feed 13,679 external inputs covering vision, smell, taste, touch, sound, antennal mechanics, proprioception, temperature, and humidity. Six simplified leg actuators move the body.
- An odor source can stimulate smell receptors while remaining invisible to the simulated eyes. The concentration overlay and source markers are for the person watching. An object's visibility to the eyes is set separately.
- You can edit the environment, switch sensory inputs and connections on or off, change the neurochemistry settings, inspect activity, and save a run. A background Web Worker runs the simulation. The lab loads data separately and verifies its SHA-256 hashes.

“Full” refers to the annotated neuron population in the source release. **4,258 sensory cells still have no assigned external input.** Optics, receptor tuning, neural dynamics, and body mechanics still need validation. Branch morphology, individual synapses, and spike physiology are outside the current simulation. Visual signals reach the body circuits, but their measured effect on movement is weak.

The version 0.10 suite contains 124 tests (`npm test`). With the full data built, `npm run benchmark:full` runs causal comparisons on the full graph, checks exact continuation from a save, and simulates 180 ticks of free body movement. See the [full lab guide](docs/full-cns.md), [model coverage](docs/malecns-scope.md), [data manifest](data/full-cns-manifest.json), and [full-graph benchmark](data/full-cns-benchmark.json).

## Running the tactical sandbox

Double-click [standalone/malecns-warhammer.html](standalone/malecns-warhammer.html) to open the tactical game. This self-contained file runs offline and includes the model. It requires no server or paid API.

To work from source, use Node.js with ES modules and the built-in test runner. Run each command from the repository root.

```sh
npm start
npm test
npm run benchmark
npm run benchmark:navigation
npm run benchmark:experience
npm run benchmark:neurotransmitters
npm run export
```

The server prints separate addresses for the tactical sandbox (usually [http://127.0.0.1:4177/](http://127.0.0.1:4177/)) and the sensory lab. `npm run export` rebuilds the approximately 11.95 MB standalone tactical HTML. The full sensory lab uses the server to load its larger data files.

## Version 0.9 — Neurotransmitters and inhibition

The expanded tactical graph uses the official MaleCNS v1.0 transmitter table, joined by body ID. It includes 8,418 acetylcholine cells, 1,568 GABA cells, 1,210 glutamate cells, 56 modulatory cells, and 184 cells with undetermined labels. Each edge retains its original contact count. The model multiplies the source neuron's contribution by the assumed transmitter sign and sets any negative activity to zero.

By default, acetylcholine (ACh) is excitatory, and GABA and glutamate are inhibitory. You can also run the original all-positive model or try excitatory glutamate. Undetermined and modulatory labels have no assigned fast effect. The source labels identify transmitters. Their signs are modeling assumptions, and this tactical model omits receptors, concentrations, and biological plasticity.

The inspector shows the source labels, predictions, and assigned signs. **Compare modes** («Сравнить режимы») runs a controlled probe of all three models and displays raw outputs. Keeping the original decoder calibration makes inhibition visible at the same scale. Experience transfers only between identical transmission models. Older scenes retain positive transmission. See the [neurotransmitter implementation](docs/neurotransmitters.md), [MaleCNS coverage](docs/malecns-scope.md), and [full diagnostic games](data/neurotransmitter-benchmark.json).

## Version 0.8 — Memory and learning from outcomes

Each unit remembers the cells it has visited and the objectives it has seen. Revisiting a path weakens the exploration signal and feeds an avoidance signal into the network. A unit can remember the direction to a landmark after it leaves view.

A readout layer with **78 trainable coefficients** reads the MaleCNS outputs. Damage actually dealt in the game, objective control, progress, and repeated visits update these coefficients. The anatomy, transmission coefficients, and dynamics inside MaleCNS stay fixed. A new experiment starts with zero experience. The app does not preload weights from benchmark runs.

The inspector shows memory, rewards, and adjustments from experience. You can freeze learning, reset experience, display the memory overlay, or choose **Repeat with experience** («Повторить с опытом»). A fixed-decoder mode provides a comparison. Even a trained readout leaves the unit stationary when connections are disabled and output activity is zero.

Experience can make performance worse in an individual run. The recorded games demonstrate updates to the readout and show how much results vary. See the [architecture, formulas, rewards, and controls](docs/experience.md) and [complete runs](data/experience-benchmark.json).

## Version 0.7 — Getting unstuck near walls

In version 0.6, all five blue units on seed `40721` stayed near their first obstacles. A wall beside or behind a unit raised the threat signal, and residual neural activity kept the unit turning in place. Increasing the movement signal produced a retreat-and-return loop.

Version 0.7 changed the software adapter and kept the network anatomy and dynamics fixed.

- The signal from an adjacent wall or ally is multiplied by `max(0, cos(angle))²`. A side or rear obstacle no longer registers as an approaching threat.
- Five rays at −90°, −45°, 0°, +45°, and +90° sample up to four grid steps. Walls, map boundaries, and live units stop a ray. Rays cannot see through wall corners. Each ray contributes `0.08 × clear steps / 4 × (1 ∓ sin(angle))` to the left and right channels.
- The summed contributions feed LC10, scaled by `1 − max(original object L, original object R)`. A salient object suppresses the exploration background while preserving its direction. All inputs are clamped to the range 0–1.
- The backward score in `visual-motor-v3` is `max(0, 1.1 × min(threat L, threat R, mean MDN) − 0.5 × forward signal)`. These signals already include normalization and sensitivity gain. The change reduces competition between forward and backward motion while allowing a threat on both sides to trigger retreat.

The fixed 0.7 controller uses local perception and a hand-written mapping from outputs to commands. It has no route planner, assigned paths, memory of visited cells, or learning from wins. Disabling connections or setting sensitivity to zero prevents the new signals from moving a unit. The inspector shows what open space the unit senses.

Both sides used neural control in this 40-tick replay of seed `40721`.

| Team A unit | Distinct cells visited in 0.6 | Distinct cells visited in 0.7 |
|---|---:|---:|
| 01 | 2 | 23 |
| 02 | 2 | 32 |
| 03 | 4 | 13 |
| 04 | 4 | 32 |
| 05 | 4 | 20 |

Blue still scored zero points in those 40 ticks. A unit can leave a wall loop and still walk past an objective, move to the edge, or take a poor engagement. The controller has yet to learn objective holding or team tactics. The additional maps `navigation-17` and `navigation-83` were also used in development, which limits their value as an independent test. See the [navigation report](data/navigation-benchmark.json) and [0.6 baseline](data/navigation-v0.6.json) from commit `0cf9855`.

## Version 0.6 — Separate actions for firing and moving

In the tactical game, **Fire** and **Forward** compete as separate actions. Seeing an enemy in the sector used to turn a move into an automatic shot. Decoder `visual-motor-v2` instead reads the existing **DNa01 L/R** output pair to choose a firing direction on the board. This assigns a game meaning to those outputs. The graph anatomy, weights, dynamics, and model SHA-256 stayed the same.

Let `L` and `R` be the DNa01 outputs normalized against the original symmetric reference and scaled by sensitivity. The in-game fire score is `(L + R) / 2` and the aim offset is `atan2(R − L, R + L)`, between −45° and +45°. When the sum is at most `1e-9`, the game has no aim direction and excludes Fire. Version 0.6 kept the other formulas. Version 0.7 later changed the retreat score.

Among visible opposing pieces within game range and a ±45° sector from the unit's facing, the adapter selects the piece with the smallest angular deviation from the computed direction. An exact tie is resolved by unit ID. Distance, HP, damage, and cover do not rank candidates. A farther piece can therefore be preferred. The network receives no list of IDs. The board adapter matches a direction to a piece.

The game excludes impossible commands before choosing an action. A unit attacks only when Fire wins. Ties are resolved in the order Fire, Forward, Turn left, Turn right, Backward, Wait.

The inspector shows outputs, angle, candidates, angular deviations, and the formula. A dashed yellow line and an outline mark the aim and preferred piece **at the moment the last decision was computed**. The display keeps that snapshot after the piece turns or moves. Opening the inspector does not advance the simulation.

## How the network chooses game commands

In **MaleCNS neural control**, each unit maintains its own activity state for **11,436 neurons** and its own facing direction. All units share the same anatomy of **1,687,031 directed connections** representing **10,931,415 synaptic contacts**. On every activation, output activity determines how Fire, Forward, Backward, Turn left, Turn right, and Wait compete. This controller makes a fresh choice every activation and does not call the tactical utility algorithm, a path planner, or an assigned-sector routine.

A software adapter connects the board, the network, and the pieces.

- Visible enemies, landmarks, and nearby obstacles become four inputs. Left and right threat signals feed LC4/LPLC2. Left and right object signals feed LC10.
- Aggression increases enemy salience, caution increases threat, and mission priority increases landmark salience. The adapter adds a background object signal of 0.035 and local information about open passages. This is a simplified projection of a board scene.
- DNa01, DNa02, DNp09, MDN, and DNp01/02/04/11 outputs feed command scores. Responses to symmetric inputs of 0.5 set their relative scales. The decoder coefficients and the Wait threshold of 0.06 are design choices. The fixed decoder stays constant throughout a game. Learning is available in the adaptive mode described above.
- Walls, board edges, and occupied cells rule out moves. A turn changes facing by 45°. A moving piece takes one of four grid directions, rounding its facing to the nearest axis.
- Fire has its own score. The adapter checks game visibility, sector, and range, then picks the candidate closest to the network's aim direction. The aim offset affects target selection only. Turning the piece is a separate action.
- The game rules resolve hits, damage, control points, and victory.

An untrained unit may retreat, spin, reverse direction, or get stuck. The controller has no game-level planning, knowledge of Warhammer rules, or model of fly consciousness. The short-retreat constraints of the older hybrid mode apply only to that mode.

## What to look at

The interface is in Russian. The labels below match the controls on screen.

1. Open the tactical HTML and click **Step** («Шаг»). The initial five-on-five scene uses the adaptive neural controller for both sides. The line beside each piece shows its facing.
2. Select a unit. Its inspector shows network inputs and outputs, available commands, blocked moves, and decoder scores. The scores measure signal strength and do not represent probabilities.
3. **Aim test** («Тест прицеливания ↗») opens a one-against-two scene with a neural A unit and two stationary B pieces whose connections are disabled. Step through the scene to watch the aim marker and the competition between firing and moving. **Neural control** («Нейронное управление ↗») opens the contact scenario with a neural scout facing an otherwise identical scout under tactical control.
4. **Compare modes** («Сравнить режимы») pauses and preserves the current game. It runs three independent copies of the contact scenario for up to 12 ticks. For neural control, it compares the connected network, the disconnected network, and tactics alone. For the older hybrid mode, it compares the short reflex, its disconnected control, and tactics alone. Neural control also shows four separate aim probes covering two LC10 input patterns, disconnected wiring, and no stimulus.
5. The sensitivity slider sets command gain from 0× to 2×. At 0× the unit waits while the network continues to update. Changes to the three input priorities take effect on the next tick. You can inspect the state while time is paused.

The comparison uses the selected unit's sensitivity. Other conditions are fixed at seed `reflex-01`, aggression 0.4, caution 1, mission priority 0, matching factions and roles, and tactical control for opponent B. **Open test scene** («Открыть тестовую сцену») keeps the selected sensitivity for A.

The inspector samples 319 evenly spaced entries from the 11,436-neuron model. Hover to see each cell's type, side, and body ID. The grid represents entries in the model and has no anatomical layout. In the compact reflex it shows all 319 neurons. The chart below it traces threat-circuit outputs. Motor outputs and command scores appear above it.

## Tactical modes

| Mode | How the unit acts |
|---|---|
| MaleCNS with memory and learning | An adaptive readout scores commands from the expanded network. Each unit retains its own experience. |
| Memory and learning with connections disabled | The same adaptive layer receives no network output from a zero state. The piece stays still. |
| MaleCNS neural control | A fixed motor decoder scores commands from the expanded network's outputs. |
| Neural control with connections disabled | Inputs are still stimulated. With no transmission between neurons, a unit starting at zero activity waits. |
| MaleCNS + tactics | The compact threat circuit can interrupt the normal tactical choice. |
| Control with compact connections disabled | Compact inputs are active. With no circuit output, tactics choose the action. |
| Tactics only | A utility algorithm chooses actions without running neural dynamics. |

Click **Create board** («Создать поле») to apply a mode or faction selection. Factions and roles share the same connectome. They differ in the perception settings and game statistics assigned by this project.

## Data sources and model scope

The full lab imports the official MaleCNS v1.0 tables. The **two tactical networks** are derived from a pinned revision of the [slvDev/esp32-ai-fly package](https://huggingface.co/slvDev/esp32-ai-fly/tree/d36ff5e192da832c4348ab509d150357cb70ddd8). That package already contains a subset of MaleCNS v1.0 with 48,311 neurons, 9,462,135 connections, and 49,481,754 contacts.

| Tactical model | Neurons | Directed connections | Synaptic contacts |
|---|---:|---:|---:|
| Expanded neural controller | 11,436 | 1,687,031 | 10,931,415 |
| Short reflex | 319 | 21,288 | 102,445 |

The expanded model takes LC4/LPLC2 and LC10 inputs, the DNa01/DNa02/DNp09/MDN and DNp01/02/04/11 output populations, and every intermediate neuron on input-to-output paths up to three connections long. After selecting the neurons, the importer keeps every connection between them, including those with only one contact. Each neuron retains its source body ID and annotations. The game reads DNa01 for aim and DNa02 for turns.

The tactical network uses a discrete leaky-rate model with `tanh`, gain 0.7, leak 0.5, input amplitude 0.8, and float32 state. Edge magnitudes are original positive contact counts divided by the destination neuron's total incoming contacts in the 48,311-cell source graph. Omitted neurons contribute zero. Each unit activation advances the expanded network by eight neural steps or the compact one by four.

The wiring comes from anatomical data. Activity, sensory projection, calibration, and game commands come from the simulation. Since 0.9, the signs of fast effects follow transmitter labels and explicit assumptions. The tactical models omit receptors, concentrations, spikes, morphology, full sensory physiology, and biological plasticity. A moving game piece is therefore a model output with no validated correspondence to the behavior of a living fly.

The choice of populations draws on studies of [descending motor networks](https://www.nature.com/articles/s41586-024-07523-9) and [steering control](https://pmc.ncbi.nlm.nih.gov/articles/PMC12279373/). In the animal, those populations act in a wider circuit and their effects depend on context.

### Reproducing the tactical data

```sh
npm run data:fetch
npm run data:motor
npm run data:build
```

`data:fetch` downloads the pinned FCL, CSV, and circuit files, verifies their sizes and SHA-256 checksums, and extracts the compact network. `data:motor` builds the expanded model from that cache. `data:build` repeats just the compact extraction. These commands run without a neuPrint token. A checksum mismatch stops the import.

The expanded graph uses compressed sparse row (CSR) storage with uint32 row offsets and pairs of uint16 values for source index and contact count. It occupies 6,793,872 bytes before Base64 encoding. The manifests record SHA-256 values, counts, and selection criteria. Repeating the extraction produced model ID `2e00fbe4528b5ba23cbbcdb40aa94ee26772d1bf7c6b8ce7cfe14888029f3d89`.

The MaleCNS data are credited to FlyEM at HHMI Janelia, the University of Cambridge, the MRC Laboratory of Molecular Biology, and Google Research. The data use CC BY 4.0 and the code uses MIT. Verification of the tactical extraction used the published FCL/CSV/circuit package. It did not involve downloading the original 1.1 GB Feather graph again. The full lab has a separate import from the official tables. See the [MaleCNS project](https://male-cns.janelia.org/), [attribution and modifications](data/MALECNS-ATTRIBUTION.md), [data license](data/LICENSE-CC-BY-4.0.txt), and [code license](LICENSE).

## Fix for oscillation between cover cells

In 0.4 the **ordinary tactical controller** rewarded adjacent cover when considering retreat but excluded the cell the piece already occupied. A piece could alternate indefinitely between equally safe cells after its neural reflex had ended.

The search now considers staying put. If an adjacent cell is equally safe, the movement cost makes staying preferable. A better cell can still win. Regression tests exercise both cases and replay the contact scene through tick 30. Other oscillations remain possible under the untrained neural controller.

## Version 0.9 checks

The 103-test suite included 15 new checks for transmitter labels, excitation, inhibition, the alternative glutamate sign, numerical stepping, saves, and experience. Complete games under all three transmission models tested numerical stability and the effects of the sign assumptions. The benchmark measures behavior within the game. [Neurotransmitter benchmark](data/neurotransmitter-benchmark.json)

## Version 0.8 checks

The 88-test suite included 14 checks for spatial memory, the trainable readout, rewards, freezing learning, saves, and late-game movement around the perimeter. The [experience benchmark](data/experience-benchmark.json) includes all five runs, including a no-learning control and a replay with experience. The standalone HTML was checked for syntax and tested in a DOM/Canvas harness. A visual check in a real browser was unavailable for this release.

## Version 0.7 checks

The 74-test suite covered walls, corners, board edges, local sensing, preserved object responses, control through connections, retreat under a threat on both sides, and snapshot migration. A separate regression checked that all five blue units advanced on seed `40721`. The standalone HTML and its controls were checked in a DOM/Canvas harness. Real-browser visuals were unverified for this release.

## Version 0.6 checks and results

All 67 tests passed for this version. They checked independent attack and movement decisions, target switching from network inputs, visibility and range masks, selection independent of distance and HP ranking, DNa01 disconnection, zero output, inspection without changes to state, the new one-against-two scene, and exact continuation from its snapshots. Earlier neural and tactical reflex regressions also passed.

On a fixed board, B-01 was three cells to the left and B-02 six cells to the right, at symmetric angles from the unit's facing. Each probe started with zero activity, advanced the network 32 steps, and played no game turns.

| Condition | Aim offset | Command | Selected piece |
|---|---:|---|---|
| L 0.6 / R 0.4 | −0.780° | Fire | B-01 |
| L 0.4 / R 0.6 | 0.757° | Fire | B-02 |
| L 0.6 / R 0.4, connections disabled | — | Wait | — |
| No stimulus | — | Wait | — |

Changing the input switched the selected piece, and disabling the connections removed the response. Replaying the 72 older hybrid games reproduced their outcomes and short-reflex checks. See the [current benchmark](data/benchmark.json), [0.6 results](data/benchmark-v0.6.json), and [0.5 results](data/benchmark-v0.5.json).

### Version 0.5 results

The 57 tests covered the engine, both networks, disconnection controls, signal direction, calibration, memory independence, turning, exclusion of impossible actions, save/load, migration, and the cover loop. An additional run checked board coordinates and saves with ten neural agents playing for 20 ticks.

After 12 ticks in the fixed contact scene, team A had the following results.

| A's controller | Motor commands reported | Damage dealt | HP remaining |
|---|---:|---:|---:|
| Expanded network | 12 | 0 | 15 |
| Connections disabled | 0 | 0 | 0 |
| Tactics | — | 5 | 0 |

The expanded network first retreated, then moved forward and turned. This comparison measures the effect of connectivity in one scene.

The separate **legacy hybrid benchmark** ran 72 games with matching factions across 12 seeds, both side assignments, and three controller conditions. The reflex won 5 of its 24 games, and each control won 12 of 24. The benchmark recorded 165 neural retreats, 156 changed first actions, 101 blocked reflex decisions, and zero violations of the short-route constraints. These figures apply to the compact reflex.

The report includes separate lateral probes and their timings. Once actions diverged, runs consumed random numbers at different rates. The benchmark used fixed seeds without training or optimizing for wins. Module syntax and the standalone bundle were checked. Automated visual verification in a real browser was unavailable for this release. See the [0.5 report](data/benchmark-v0.5.json) and archived runs for [0.4](data/benchmark-v0.4.json), [0.3](data/benchmark-v0.3.json), and [0.2](data/benchmark-v0.2.json).

## Short reflex and tactical control

In the legacy hybrid mode, the LC4/LPLC2 → DNp01/02/04/11 circuit receives a nearby visible threat signal relative to the unit's deployment direction. Crossing a software threshold can trigger up to two retreat actions. The circuit then waits five unit activations for recovery and waits for the signal to fall to 65% of the threshold before rearming.

A reflex route must fit the remaining allowance of one or two grid steps. The board's threat score may not increase at any step and must be lower at the end. If no route meets those conditions, the tactical controller takes over. The score adds the base damage of visible enemy pieces in game range, with a factor of 0.6 for ranged attacks against cover. It measures the current board and does not predict an opponent's turn, a hit, or survival. The tactical controller uses separate rules for a low-HP retreat.

The **Reflex influence** («Влияние рефлекса») panel compares the first actual board step or selected target with the tactical choice on the same board. It compares one decision. The expanded neural controller makes its own decisions, so this panel appears only for the hybrid controller.

## Board and game rules

- A seed reproduces a 32 × 22 board. Maps include ruins, an industrial zone, and a rocky plateau.
- Factions are Space Marines, Orks, Necrons, and Tyranids. Roles are scout, assault, and gunner.
- A standard game has five pieces per side. The contact test uses one per side, and the aim test uses one A piece and two B pieces.
- Each activation allows one step, turn, attack, or wait. Walls block line of fire on the board. Cover reduces ranged damage by 40% and provides no protection at point-blank range.
- There are three control points. An uncontested unit within one cell can capture one. A side wins by reaching 65 points, eliminating the opposition, or leading on score after 180 ticks.
- Controls include pause, single step, 1×/2×/4× speed, reset, and map editing before the first tick. Simulation speed depends on computation time. Display refreshes and neural updates run at different rates.

The editor protects unit and objective cells and keeps the map connected. Each piece represents its unit as a whole. Faction abilities and statistics use the project's own rules.

## Tactical saves

Format **v9** stores up to 8 MB. A snapshot records the map, random number generator (RNG) state, profiles, facing, neural activity, signal history, and the legacy reflex state. It also stores visited-cell memory, trainable coefficients, action traces, pending reward, the transmission model, and the hash of the neurotransmitter labels. Loading a v9 snapshot resumes the simulation exactly. The visible event log starts fresh.

Opening a v1–v8 scene displays a migration notice. Those scenes keep positive transmission. Version 8 retains learned experience, and versions 1–7 start with empty experience.

| Source format | What carries over |
|---|---|
| v5–v6 | Activity and facing. Subsequent actions use the updated passage sensing and v3 decoder. The asymmetric aim scene is supported from v6. |
| v3–v4 | Neural memory, contact scene, and reflex phase. |
| v2 | Neural memory. The reflex starts ready. |
| v1 | Ordinary tactical control. |

Older scenes that need a default facing use east for A and west for B. Continuing a migrated scene uses the current rules and can produce a different trajectory.

**Reset** returns to the initial or imported scene. **Create board** («Создать поле») starts a new game. Profile changes made before the first tick become part of the initial snapshot. Later changes affect the running game only.

## Architecture and hardware plans

| File | Responsibility |
|---|---|
| [scripts/build-full-cns.py](scripts/build-full-cns.py) | Builds the full annotated graph and associated lab data from the source tables |
| [dist/full-network.mjs](dist/full-network.mjs), [dist/full-worker.mjs](dist/full-worker.mjs) | Full-graph simulation and its background worker |
| [dist/sensory-world.mjs](dist/sensory-world.mjs), [dist/sensory-ports.mjs](dist/sensory-ports.mjs) | Sensory environment and mapping of external signals to neurons |
| [dist/data/malecns-motor.mjs](dist/data/malecns-motor.mjs) | Expanded tactical anatomy, packed CSR, calibration, and SHA-256 |
| [dist/motor.mjs](dist/motor.mjs) | Game-independent dynamics, motor decoder, and memory validation |
| [dist/data/malecns-escape.mjs](dist/data/malecns-escape.mjs) | Compact anatomy for the legacy reflex |
| [dist/neural.mjs](dist/neural.mjs), [dist/reflex.mjs](dist/reflex.mjs) | Model dispatch and the game's separate reflex constraints |
| [dist/neurochemistry.mjs](dist/neurochemistry.mjs) | Transmitter labels, explicit signs, and transmission-model identity |
| [dist/data/malecns-neurotransmitters.mjs](dist/data/malecns-neurotransmitters.mjs) | Source records for selected body IDs |
| [dist/experience.mjs](dist/experience.mjs) | Per-unit memory, trainable readout, rewards, and experience persistence |
| [dist/engine.mjs](dist/engine.mjs) | RNG, board, observations, actions, game rules, and saves independent of the DOM |
| [dist/experiments.mjs](dist/experiments.mjs) | Isolated comparisons and in-game aim probes |
| [tests/aim.test.mjs](tests/aim.test.mjs) | Target selection from network inputs, independent firing, one-against-two scenes, and v5 migration |
| [dist/app.mjs](dist/app.mjs) | Tactical canvas, inspector, and controls |
| [scripts/import-motor.mjs](scripts/import-motor.mjs), [scripts/import-malecns.mjs](scripts/import-malecns.mjs) | Reproducible extraction of the tactical subgraphs |
| [tests/](tests/) | Engine, network, sensory, and adapter tests |

For example, run one tick of the fixed neural controller and restore the result from a snapshot. The import path below is relative to the repository root.

```js
import { createSimulation, stepSimulation, exportScene, importScene } from './dist/engine.mjs';

const state = createSimulation({
  seed: '40721',
  controllerA: 'neural',
  controllerB: 'neural'
});
stepSimulation(state);
const restored = importScene(exportScene(state));
```

For compatibility, `createSimulation` defaults to the older hybrid mode when called without controller options. The current tactical UI starts with `adaptive` for both sides. The example above explicitly selects the fixed `neural` controller.

`decideUnit` returns an intended action without advancing time. For the fixed neural controller, `source` is `motor`. The `command` field holds the selected action, `motor` contains the outputs and scores, and `alternatives` lists the allowed and excluded actions. The `aim` snapshot records the angle, original facing, preferred piece, and candidates before the action. `counterfactual` is `null`.

`stepSimulation` advances observations, network state, and the game. An optional observer passed as `stepSimulation(state, (decision, unit, board) => { ... })` receives each decision before execution, including a decision by a unit that dies later in the same tick. Treat the observer's objects as read-only.

The motor model can run separately from the game. `stepMotorBrain` accepts four sensory values, and `motorReadout` exposes the model outputs. The documented hardware concept starts with camera observations of markers and a person manually moving the pieces. A physical movement would need confirmation from observation. Cameras, motors, and a network protocol have yet to be integrated.

The hardware plan also calls for coordinate calibration, latency and confidence measurements, board boundaries, and a stop on loss of communication. The expanded JavaScript model runs on a computer. An ESP32 implementation would require separate memory and latency measurements. The proposed alternative keeps neural computation on the computer and uses a microcontroller for movement.
