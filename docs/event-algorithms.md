# Jump Event Detection in Tempo Log Analysis

*2026-07-12 — describes the algorithms implemented in `src/analysis/event-detector.ts`
(with signal preparation in `dropkick-reader.ts` / `log-parser.ts`). Intended reader:
an experienced skydiver; no software background assumed beyond an interest in how
the numbers on the analysis pages are produced.*

## 1. Preamble

Every Tempo-BT log gives us three independent views of a jump:

- **Barometric altitude** — pressure altitude, converted to AGL by subtracting the
  surface reference the device writes into each log's header (`$PSFC`; captured on
  the ground pre-boarding — §2, §6). Smooth and dense, but it drifts with the
  weather like any altimeter you didn't re-zero.
- **GNSS** (GPS) — position, altitude, groundspeed, and a derived **rate of descent
  (RoD)**. Accurate on average but *laggy*: RoD is computed across position fixes,
  so it confirms freefall a couple of seconds after freefall actually begins.
- **The IMU** — accelerometer and gyro, written to the log as `$PIMU` sentences at
  a steady 20 Hz on every firmware version in the corpus (verified against the
  v1.6.0 source and raw v110/v114 logs). A caveat that matters throughout: the
  current *analysis* pipeline resamples the IMU onto the log-entry cadence, which
  follows the GNSS fix rate — effectively ~10 Hz in freefall and as low as 1 Hz on
  the ground on some device configurations (§6). We use the *magnitude* of the
  acceleration vector, which has a useful physical meaning: about **1 g (9.8 m/s²)** whenever something is holding
  you up (the airplane seat, a flying canopy, the ground), near **0 g** in the first
  seconds off the hill before airspeed builds, back to ~1 g at terminal (drag holds
  you up), and **sharp spikes** when something sudden happens — opening shock,
  touchdown.

The three views have complementary failure modes, which leads to the design rule
used throughout: **detect coarsely with the robust signal, then refine with the
precise one — and never let refinement make things worse.** Each refiner searches
only a small window around the coarse estimate; if it finds no convincing
signature, the coarse answer stands unchanged.

One more rule worth stating: every algorithm operates on **one device's log in
isolation**. Nothing assumes jumpers exit together or land together — a 20-way
whose exit strings out over six or seven seconds refines as twenty independent
exits, and the per-row separation becomes measurable rather than being averaged
away.

## 2. The instrument: Tempo-BT hardware and firmware

*(Verified against the firmware source, `tempo-bt-v1` at v1.6.0.)*

Tempo-BT is a body-worn logger built around a Nordic **nRF5340** — a dual-core
Bluetooth SoC. One core runs the application (sensors, logging, filesystem); the
other is dedicated to the Bluetooth radio. An 8 MB external flash holds firmware
images for over-the-air updates; the flight data itself lives on a **microSD
card** (FAT/exFAT, attached over SPI), which is the primary and authoritative log
store: one file per jump at `/SD:/logs/<YYYYMMDD>/<session-id>/flight.txt`, where
the session id is random hex and the date comes from the GNSS-set clock. Log
writes go through a small write-behind buffer that is flushed and synced to the
card every 250 ms — a power loss costs at most a fraction of a second of data.

Over **BLE**, the device advertises as `Tempo-BT-XXXX` (the four-character suffix
is assigned at provisioning; a factory-fresh device says just `Tempo-BT`) and
exposes the standard mcumgr/SMP management service — file download plus a custom
Tempo command group (session listing, settings, LED identify, and so on). This is
the path the dropzone auto-ingest system uses to harvest logs without pulling the
card.

Each sensor is sampled faster than it is logged; the logging rates are firmware
choices, not hardware limits:

| Sensor | Part | Native sampling | Logged as | Log rate |
|---|---|---|---|---|
| Barometer | Bosch BMP390 (I2C) | 8 Hz (4× pressure oversampling, IIR filtering) | `$PENV` — pressure (hPa) + standard-atmosphere altitude (ft) | 4 Hz |
| IMU (accel + gyro) | TDK ICM-42688 (SPI) | **200 Hz** into an on-chip FIFO; ±8 g, ±500 °/s | `$PIMU` — accel (m/s²) + rotation rate (rad/s) | 20 Hz |
| Orientation | — (computed) | Fusion AHRS (Madgwick-style, NED) fed at 200 Hz | `$PIM2` — attitude quaternion | 20 Hz, paired with `$PIMU` |
| Magnetometer | MEMSIC MMC5983MA (I2C) | on-demand, single-shot | `$PMAG` — calibrated field (µT) | 20 Hz **when enabled — off by default** |
| GNSS (GPS) | u-blox SAM-M10Q (UART) | 1 Hz fix rate on the ground, **10 Hz once freefall is detected** | standard NMEA verbatim — `GGA`/`VTG` at fix rate; `RMC`/`GLL` held at 1 Hz | fix rate |

A few consequences that matter to the algorithms in this paper:

- The ±8 g accelerometer range comfortably covers what a jump produces — the
  hardest openings run 3–4 g and the touchdown spikes we measure peak near
  4.2 g — so the impulse signatures in §5 are genuine measurements, not clipping.
- The `$PTH` sentence, written immediately after each `GGA`, records the
  device-clock arrival time of that fix — the anchor that lets a log offset be
  converted to a precise UTC time (used for the exit timestamp).
- Two header sentences open every log: `$PVER` (firmware identity and log-format
  number) and `$PSFC` (the surface altitude reference discussed in §6).
- There is no battery gauge on this hardware revision — `$PENV`'s trailing field
  is a placeholder (−1.00) — and no temperature is logged.

## 3. Exit

**Coarse detection.** The firmware itself marks an exit candidate: the `$PST
JUMPED` state transition, which the device declares on either of two triggers —
accelerometer magnitude below 0.6 g for half a second, or barometric descent
faster than 1,000 fpm sustained for two seconds (whichever fires first; the
device also raises its GNSS fix rate to 10 Hz at this moment). We treat that (minus the half-second trigger delay) as a
*lower bound* — it can fire during climb-out, and on the other side it can only
lag the door. From there we scan forward for the onset of sustained freefall in
the GNSS: RoD above 5,000 fpm held for two consecutive seconds, sanity-checked to
be above 3,000 ft AGL (rejecting false positives from sparse GNSS under canopy).
If the log has no `$PST` at all (older firmware), a fallback scans for the first
sample that is simultaneously above 5,000 fpm RoD and below 0.8 g.

Because the GNSS confirmation is inherently lagged, the coarse exit lands **1.5 to
3.5 seconds late** — measurably so (see the validation table below).

**IMU refinement — the departure edge.** In the accelerometer, the moment you
leave the airplane is a falling edge you cannot miss once you know to look for it:
~1 g of seat-and-jostle inside the aircraft, then a cliff down toward 0.3–0.5 g as
you come off the hill with no airspeed yet, slowly rebuilding toward 1 g as you
approach terminal. The refiner searches a window biased *earlier* than the coarse
estimate (−12 s / +4 s) for the first drop of the smoothed (~1 s averaged)
acceleration magnitude below **8.5 m/s² (~0.87 g) that does not recover**: the
following four seconds must stay below the aircraft regime and average below
7.5 m/s². The "does not recover" test is what separates an exit from turbulence
on jump run — a bump in the climb unloads you for a moment, but the airplane
always catches you again within a second or two. The door doesn't.

Two regimes required care here. A solo exit goes deep and quiet (0.4–0.5 g on the
hill). A formation exit does not: grips, the burble, and bodies flying on each
other keep the hill at 0.6–0.75 g with bounces — which is why the criterion is
"never recovers to aircraft levels" rather than "gets very quiet." Both regimes
validate cleanly. Once refined, the exit altitude, position, and UTC timestamp are
re-anchored to the refined moment.

**Validation** (five solo jumps, hand-labeled from the IMU charts):

| Jump | Coarse (s) | Refined (s) | Hand label (s) | Error |
|---|---|---|---|---|
| 06-solo-riley-20260703 | 927.2 | 925.6 | 925.8 | −0.2 |
| 07-solo-riley-20260703 | 814.5 | 812.1 | 812 | +0.1 |
| 08-solo-bb-20260703 | 814.3 | 812.0 | 813 | −1.0 * |
| 10-solo-riley-20260703 | 791.7 | 789.0 | 789 | 0.0 |
| 11-solo-riley-20260705 | 832.7 | 829.6 | 830 | −0.4 |

\* On this device the GNSS ran at 1 Hz until the freefall trigger raised it to
10 Hz — and because the analysis resamples the IMU onto GNSS-entry cadence,
the detector effectively saw 1 Hz data before the exit, a ±1 s resolution
floor that applies to the hand label as much as to the algorithm. The raw log
contains full 20 Hz `$PIMU` throughout; consuming it directly is the top item
in §6.

On formation logs, each device's refined time was verified to sit on that
device's *own* falling edge; where teammates' refined times agree closely (e.g., a
2-way at 0.3 s separation) that is a measurement of the exit, not an assumption
of the algorithm.

## 4. Deployment

Deployment is currently the simplest detector, and the one that has had no
refinement pass yet.

**Detection.** Scan freefall (samples with RoD above 5,000 fpm — the freefall
gate keeps exit funnels and climb bumps out of consideration) for the first
acceleration-magnitude sample exceeding **~2.5 g** (1 g + a 1.5 g threshold).
That spike is the snatch/opening shock, and its time and barometric altitude are
reported as deployment. Peak acceleration during the opening is recorded
alongside.

**Activation.** A second mark, "activation," is the first sample after deployment
where RoD falls below 2,000 fpm — effectively "the canopy is now flying you," the
end of the snivel. The deployment→activation interval is therefore a crude snivel
duration.

Known limitations, in candor: the trigger is a single-sample threshold on the
analysis pipeline's ~10 Hz resampled signal, so it timestamps the *shock*, not
the *pitch* — the
pilot chute launch and snatch sequence precede it by a second or more. And the
freefall gate inherits the GNSS RoD lag. Both are tractable with the same
coarse-plus-refine treatment the other two events received (§6).

## 5. Landing

**Coarse detection.** After deployment, find the first sample within ±100 ft baro
AGL whose barometric altitude then stays inside a ±20 ft band for at least 20
seconds. That is a solid "you are on the ground and staying there" test, but it
is blunt about *when* you arrived: in practice it fires **during the flare**, one
to three seconds before touchdown, and it depends entirely on the `$PSFC` surface
reference — no `$PSFC`, no landing; surface pressure drifted more than 100 ft
since the pre-boarding reference was captured, no landing.

**IMU refinement — the touchdown impulse.** The insight is that the flare and the
touchdown, which look similar in altitude, look completely different in the
accelerometer: a flare is **high load but smooth** (up to 2 g, with sample-to-
sample variability under 2 m/s²), while touchdown is **impulsive** — a 2–4 g
spike and a burst of variability (4–13 m/s²) from the impact, the run-out steps,
and the canopy coming down. The refiner computes a rolling ~0.5 s standard
deviation of acceleration magnitude, establishes a baseline from the canopy ride
just before the coarse estimate (median plus a robust spread measure, floored at
2.5 m/s² so a hard two-stage flare can never trigger it), and takes the **first
sustained crossing** within ±8 s of the coarse time. First crossing, not biggest:
the largest burst is often gathering the canopy, seconds after you landed.

**Validation.** Across all 21 logs in the test corpus the refinement moved
landings by −0.3 to +2.8 s (systematically later — confirming the coarse
detector's flare bias). On the jump that motivated the work, the refined time
landed within 0.1 s of a hand-labeled touchdown; the largest shift (+2.8 s) was
spot-checked and sits on an unambiguous 4.2 g impact spike.

## 6. Potential Future Investigation

*(The firmware statements below were verified against the v1.6.0 source tree
(`tempo-bt-v1`, commit 65808c3) and against raw v110/v114 logs — including two
earlier assumptions that the review overturned; those are called out inline.)*

**Analysis-side:**

- **Consume `$PIMU` at its native rate — the highest-leverage item here.** The
  firmware writes IMU sentences at a steady 20 Hz on every version in the corpus,
  but the reader resamples them onto log-*entry* cadence, which follows the GNSS
  fix rate: one representative log carries 19,889 `$PIMU` sentences of which the
  analysis keeps 2,874. Reading the IMU series directly would roughly double the
  effective rate of the landing and exit refiners, remove the ±1 s exit floor on
  devices whose GNSS idles at 1 Hz before the freefall trigger (the asterisk in
  §3's table), and provide enough bandwidth for genuine spectral analysis of
  openings and touchdowns — all without touching the firmware. (This was
  originally believed to be a firmware limitation; the review showed the data was
  in the logs all along.)
- **Deployment refinement.** Apply the coarse-plus-refine pattern to deployment:
  walk back from the opening-shock spike to the onset of sustained deceleration
  (the RoD knee / the start of line stretch) to timestamp the pitch rather than
  the shock. The deployment→activation interval then becomes an honest snivel
  metric, and peak-g plus impulse duration a meaningful opening-harshness number.
- **Gyro data.** The logs carry rotation rates that the analysis currently
  ignores. Spin/tumble detection off the hill, funnel detection on formation
  exits, and line-twist detection during the snivel are all plausibly one
  rotating-rate threshold away.
- **Landing character.** With touchdown timed to ±0.2 s, classifying the landing
  (stand-up vs. slide vs. bad landing) from the post-touchdown impulse pattern, and
  scoring the flare (load profile over the last 5 s of flight, plus VTG
  groundspeed at touchdown) are natural extensions.
- **Exit separation reporting.** Per-device exit times are now precise enough to
  report door order and per-row separation on formation loads — useful feedback
  for exit engineering on anything bigger than a 4-way.
- **Sub-second edge interpolation.** The exit edge is currently reported at
  sample resolution; interpolating the 8.5 m/s² crossing would give ~0.1 s
  precision — better still on top of native-rate `$PIMU`.
- **Surface-reference fusion.** Baro AGL and GNSS AGL each use their own surface
  reference; cross-checking them (the analysis now computes both per GPS point)
  would flag QNH drift and let landing detection loosen its hard `$PSFC`
  dependency.

**On-device firmware:**

- **IMU logging rate — verified, no change needed.** The emitter is hard-coded to
  20 Hz with no state- or phase-dependent switching, on 1.6.0 and (per the raw
  logs) back through v110. The apparent "1 Hz until freefall" behavior in one
  corpus log was the analysis-side resampling described above, driven by that
  device's GNSS idling at 1 Hz on the ground. An earlier draft of this paper
  asked for a firmware rate change here; the review retracted it.
- **`$PSFC` surface reference altitude** The firmware
  maintains a rolling 4-slot ground-altitude tracker sampled every
  5 minutes — only while on the ground (sampling pauses during flight) — and
  writes a fresh `$PSFC` into every session header using the slot from ~15
  minutes back (deliberately pre-boarding). Since one session is one jump, each
  log already gets a same-hour surface reference, which covers common
  surface weather changes. Residual edge worth closing: an uninitialized
  tracker (power on, gear up immediately) silently defaults to 0 ft — sea level —
  with only a debug warning; refusing to arm, or falling back to the first live
  sample, would be safer.
- **GNSS surface elevation — verified missing.** GGA altitude is parsed, but no
  GNSS-derived ground elevation is ever captured or logged; the reader-side field
  for it (`dzSurfaceGPSAltitude_m`) has no producer, and the analysis estimates
  it statistically instead. Capturing it while `ARMED` (device stationary at the
  DZ), alongside the baro tracker initialization that already happens there,
  would make GNSS AGL exact.
- **Pre-trigger ring buffer — still open, lower priority than first thought.**
  There is no pre-trigger IMU buffering: `$PIMU` exists only once `LOGGING` has
  begun. In practice `LOGGING` starts during the climb, so the door and
  everything after it are covered at 20 Hz; a short high-rate ring buffer flushed
  on `$PST` transitions would mainly protect late-arm/manual-start scenarios and
  enable >20 Hz capture around openings and touchdowns.
- **Housekeeping noted during the review** (for firmware maintainers): the source
  contains a second, unwired `$PSFC` sentence layout
  (`$PSFC,session_id,time,rates,axes` — session config) sharing a name with the
  header's `$PSFC,<altitude_ft>`; and the `imu_output_rate` config constant says
  50 Hz while the emitter is fixed at 20 Hz — harmless today, misleading if the
  session-config sentence is ever wired in. Log-format versioning for reference:
  `$PVER` numeric = 100 + major×10 + minor (corpus logs are 110/114; the next
  release stamps 116); values below 100 belong to the pre-Tempo "Dropkick"
  lineage.
