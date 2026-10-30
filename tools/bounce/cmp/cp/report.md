# Bounce comparison

ref: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/_reference/cp.wav
dut: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/tools/bounce/out/cp.wav

lag: 762.6ms · level match: -24.20dB applied to dut

| metric | value |
| --- | --- |
| residual (level-matched null) | -26.7 dBFS |
| envelope correlation | 0.9329 |
| onset agreement | 0.50 |
| centroid Δ | 2298 Hz |
| band-balance distance | 0.121 |
| verdict | CLOSE |

diff.wav: level-matched residual, peak-normalized (gain 2.0x).
TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains — use per-cycle listening to localize).