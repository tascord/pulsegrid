# Bounce comparison

ref: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/_reference/chords.wav
dut: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/tools/bounce/out/chords.wav

lag: -748.7ms · level match: 0.89dB applied to dut

| metric | value |
| --- | --- |
| residual (level-matched null) | -33.4 dBFS |
| envelope correlation | 0.9034 |
| onset agreement | n/a (legato) |
| centroid Δ | 13 Hz |
| band-balance distance | 0.011 |
| verdict | TIGHT |

diff.wav: level-matched residual, peak-normalized (gain 4.9x).
TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains — use per-cycle listening to localize).