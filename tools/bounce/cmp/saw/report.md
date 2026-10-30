# Bounce comparison

ref: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/_reference/saw.wav
dut: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/tools/bounce/out/saw.wav

lag: 54.1ms · level match: 1.68dB applied to dut

| metric | value |
| --- | --- |
| residual (level-matched null) | -45.7 dBFS |
| envelope correlation | 0.9766 |
| onset agreement | n/a (legato) |
| centroid Δ | 12 Hz |
| band-balance distance | 0.006 |
| verdict | TIGHT |

diff.wav: level-matched residual, peak-normalized (gain 8.9x).
TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains — use per-cycle listening to localize).