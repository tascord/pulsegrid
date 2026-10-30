# Bounce comparison

ref: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/_reference/wt.wav
dut: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/tools/bounce/out/wt.wav

lag: -12.3ms · level match: -6.94dB applied to dut

| metric | value |
| --- | --- |
| residual (level-matched null) | -20.5 dBFS |
| envelope correlation | 0.5918 |
| onset agreement | 0.67 |
| centroid Δ | 532 Hz |
| band-balance distance | 0.014 |
| verdict | CLOSE |

diff.wav: level-matched residual, peak-normalized (gain 2.9x).
TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains — use per-cycle listening to localize).