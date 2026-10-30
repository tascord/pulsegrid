# Bounce comparison

ref: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/_reference/bd.wav
dut: /home/519374d0-07bf-447b-8c84-f74f817bdc12/Documents/Projects/pulsegrid/tools/bounce/out/bd.wav

lag: -763.5ms · level match: -9.56dB applied to dut

| metric | value |
| --- | --- |
| residual (level-matched null) | -11.4 dBFS |
| envelope correlation | 0.7457 |
| onset agreement | 0.33 |
| centroid Δ | 1764 Hz |
| band-balance distance | 0.011 |
| verdict | DIFFERENT |

diff.wav: level-matched residual, peak-normalized (gain 0.9x).
TIGHT <-30dBFS · CLOSE <-20dBFS · else DIFFERENT (expected for different FX chains — use per-cycle listening to localize).