# Engine recovery v2

Recovery work dated 2026-09-22. The original proposal remains in
`new-architecture-v2.md`; this document records implementation and evidence.
Final packaged failure-path validation completed on 2026-09-23.

## Implemented boundaries

- Legacy presets and final policy are separate from the analysis orchestration.
- Pure UltraFace preprocessing, normalized-box conversion, pixel conversion, NMS,
  and eye-crop geometry have fixed regression fixtures.
- Model initialization is shared across concurrent calls. Initialization failures
  retain their cause; an inference failure does not permanently disable the model.
- Both model files are checked against SHA-256 before inference.
- `ai-engine-v2` contains typed metrics, provider contracts, a legacy adapter,
  an offline MediaPipe provider, a candidate policy, burst survivor protection,
  and per-photo traces. Existing technical analyzers are reused.
- `legacy`, `v2-shadow`, and `v2-active` are supported. Production defaults to
  `legacy`. `OHMYFLOW_ENGINE=v2-shadow` enables the experiment. `v2-active`
  is downgraded to shadow while `V2_RELEASE_APPROVED` is false; the evaluation
  runner alone can explicitly exercise experimental active decisions.
- Every completed application run writes local diagnostics to
  `%APPDATA%/ohmyflow/diagnostics/latest.jsonl` (actual directory uses Electron's
  `userData`). Trace write failures are reported to the console.

## Confirmed defects and shipped fixes

1. A failed preview/analysis received a synthetic low focus score and could be
   rejected by High. Missing analysis now stays Maybe in all modes.
2. Reanalysis copied stale ONNX/burst flags from the previous result. Each run
   now starts from photo input fields only.
3. ONNX errors were returned as `null`, obscuring whether inference ran.
   Traces now distinguish skipped, successful, unavailable, and failed inference.
4. The actual Electron eye path rejected a human-labeled keeper. Uncalibrated
   closed-eye results now go to Maybe. No threshold was tuned.
5. Packaging did not explicitly exclude the private `sample` and evaluation
   directories. They are now excluded and ignored by Git.

## Evaluation protocol

`eval/manifest.jsonl` is a private immutable snapshot of 407 photo hashes and
folder labels. Every Electron evaluation checks the original photo hashes.
The data is a **legacy regression set**: it was already used for tuning, so
splitting it now would not create an independent holdout. Per-eye states,
face-presence labels, and human burst IDs remain null where unlabeled.

The old Node harness is retained as a technical regression check. It cannot
validate browser decoding or ONNX. Its High hash stayed `a492b57d` through the
refactor and fixes. Do not interpret that as full production parity.

The Electron runner uses `app://`, the production prefetch functions, the same
JPEG decoders, culler, ONNX WASM, and policy. It also runs inside the packaged EXE.
The first exploratory runner accidentally exceeded the IPC batch limit; its
`electron-baseline.json` output is invalid and excluded from all comparisons.
`electron-baseline-valid.json` is the valid pre-policy-change reference.

Valid initial Electron baseline: 207 Picks / 115 Maybe / 85 Rejects; 9 labeled
keepers rejected, 25 labeled Rejects picked. ONNX ran successfully 180 times,
ROI analysis ran 117 times, and 12 eye states changed. There were no input
failures. This disproves the hypothesis that ONNX never runs.

Initial MediaPipe experiment: all 407 calls succeeded, 156 faces were returned,
and 19/65 eye-tagged photos had a detected face. Mean provider duration was
18.1 ms/photo in this run (including initialization). This is coverage on a
tagged subset, not measured face recall. Eye precision/recall cannot be computed
from incomplete eye labels. Raw blink/squint coefficients stay uncalibrated.

The initial broad shadow policy reduced keeper rejects 9→8 but increased
Reject→Pick 25→29. Visual review confirmed bad promotions, including a blurred
subject. That experiment was not activated. A later correction preserves the
technical subject-focus cap when clearing the old unknown-face cap; final
candidate metrics are recorded separately in the generated report.

Final packaged production run: **207 Picks / 117 Maybe / 83 Rejects**.
Keeper false Rejects fell **9→8**, Reject→Pick stayed **25**, and one true Reject
moved to Maybe. Exactly two photos changed: DSCF0249 and DSCF0449, both
Reject→Maybe under `EYE_REVIEW_ONLY`. The latter is a labeled keeper. All changed
photos were visually inspected. No thresholds changed.

Final packaged shadow run: **407/407 MediaPipe calls succeeded**, 19/65 eye-tagged
photos had a detected face, mean provider time **20.6 ms/photo** in this run.
Production categories and scores matched the packaged production run exactly.
The corrected candidate would produce **217/120/70**, with 8 keeper false
Rejects and 26 Reject→Pick (one worse than production), so it remains inactive.
Its complete similarity groups retain a survivor; these are not human burst labels.

Validation: 17 regression tests, TypeScript, Vite build, portable packaging,
407-photo packaged production safety checks, and 407-photo packaged shadow
model/parity checks passed. The baseline's incomplete group trace cannot support
a reliable before/after survivor count; the report marks that value null.

Packaged failure injection also passed on 24 photos per model: missing UltraFace
produced 10 explicit `unavailable` results on requested calls; missing MediaPipe
produced 24 explicit `unavailable` results. Both runs completed all 24 photos
with fallback decisions and recorded HTTP-404 causes. The injection exists only
in the evaluation entry, not in the production UI.

## Reproducing checks

```powershell
npm run test:engine
npm run build
node scripts/run-engine-eval.cjs --name=local-run
node scripts/run-engine-eval.cjs --name=shadow-run --engine=v2-shadow
npm run pack
node scripts/run-engine-eval.cjs --name=packaged-run --exe=C:\path\to\OhMyFlow.exe
node scripts/report-engine-eval.cjs electron-baseline-valid packaged-run
node scripts/check-engine-eval.cjs electron-baseline-valid packaged-run
node scripts/contact-sheet.cjs
```

Run names are immutable; an existing result is never overwritten. Reports,
traces, snapshots, and visual review artifacts remain under private
`.engine-eval/`. Use `freeze-dataset.cjs` only to create the initial manifest,
and `freeze-engine.cjs` only for the initial baseline snapshot.

## Release gate and remaining work

Full v2 activation remains blocked by evidence, not by packaging. The MediaPipe
provider remains diagnostic-only. Needed before promotion: independently held
out labels, left/right open/closed/squint/unknown labels, face-presence labels,
human burst IDs, a calibrated eye policy, and a passing safety/quality report.
The current v2 candidate still adapts legacy technical policy and mixed legacy
scores; it is not a completed replacement of every legacy heuristic.

No new screen detector, segmentation, custom training, GPU backend, or aggressive
duplicate policy was added. Performance on 3000 photos and low-end hardware is
unmeasured. The seven product keeper errors in the Node baseline are still open.

## Model sources

MediaPipe runtime: `@mediapipe/tasks-vision@0.10.32` (Apache-2.0).
The [official Web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
describes landmarks and blendshape coefficients; coefficients are not treated
as calibrated eye-state probabilities here.

Model: [Face Landmarker float16 v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task),
SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
UltraFace model and preprocessing are retained for baseline compatibility.
Both inference runtimes read bundled local assets; user photos are never uploaded.
