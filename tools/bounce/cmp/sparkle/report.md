# Bounce comparison

ref: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/_reference/sparkle.wav
dut: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/tools/bounce/out/sparkle.wav

lag: 981.5ms · level match: -15.82dB applied to dut

| metric | value |
| --- | --- |
| residual (level-matched null) | -32.4 dBFS |
| envelope correlation | -0.5454 |
| onset agreement | n/a (legato) |
| centroid Δ | 162 Hz |
| band-balance distance | 0.085 |
| verdict | TIGHT |

diff.wav: level-matched residual, peak-normalized (gain 8.8x).
TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains — use per-cycle listening to localize).