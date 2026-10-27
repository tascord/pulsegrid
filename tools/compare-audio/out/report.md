# Demo audio comparison — arrangement (neutral render)

cycles: 18 · 0.3797s/cycle · chain: shared neutral (osc+sample, ADSR, LPF, pan — no FX)

systematic scales (278 onset-matched pairs): duration ×1.000 · velocity ×1.000 (0.00dB).
Per-stem residuals below are computed AFTER least-squares level match, so these scales never mask shape differences.

| stem | ref ev | dut ev | lag ms | lvl dB | resid dBFS | envCorr | onset | centroid ΔHz | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| drums | 135 | 135 | 0.00 | 0.00 | -Infinity | 1.0000 | 1.00 | 0 | MATCH |
| bass | 12 | 12 | 0.00 | 0.00 | -Infinity | 1.0000 | n/a | 0 | MATCH |
| chords | 16 | 16 | 0.00 | 0.00 | -Infinity | 1.0000 | n/a | 0 | MATCH |
| arp | 67 | 68 | 0.00 | -2.97 | -29.2 | 0.9239 | 0.60 | 166 | VARIANT (phrase branch differs — expected `|` randomness) |
| sparkle | 72 | 72 | 0.00 | 0.00 | -Infinity | 1.0000 | 1.00 | 0 | MATCH |
| mix | 302 | 303 | 0.00 | -0.19 | -31.8 | 0.9987 | n/a | 33 | CLOSE |

arp branches (9 phrases): strudel ABBAAABAB · pulsegrid ABBABAABB

Verdicts: MATCH = sample-identical · CLOSE = same shape, tiny level/timbre drift ·
VARIANT = onset grid agrees but phrase content is the other `|` branch (expected Strudel randomness) · DIFFER = investigate.
Listen: strudel-neutral.wav vs pulsegrid-neutral.wav, diff.wav (residual, peak-normalized).

## Per-track waveforms (tracks/: 10 tracks × strudel/pulsegrid, + diff where not MATCH)

| track | side | peak dBFS | rms dBFS | crest dB | dc | zcr/s | clipped | L/R corr | side/mid | atk ms | centroid Hz |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kick | S | -4.4 | -19.2 | 14.8 | 1.3e-4 | 46 | 0 | 1.000 | 0.000 | 6.89 | 324 |
| kick | P | -4.4 | -19.2 | 14.8 | 1.3e-4 | 46 | 0 | 1.000 | 0.000 | 6.89 | 324 |
| hats | S | -8.0 | -25.1 | 17.1 | -8.7e-6 | 16016 | 0 | 1.000 | 0.000 | 1.61 | 9397 |
| hats | P | -8.0 | -25.1 | 17.1 | -8.7e-6 | 16016 | 0 | 1.000 | 0.000 | 1.61 | 9397 |
| openhat | S | -15.1 | -32.5 | 17.5 | 7.8e-6 | 11988 | 0 | 1.000 | 0.000 | 16.69 | 9125 |
| openhat | P | -15.1 | -32.5 | 17.5 | 7.8e-6 | 11988 | 0 | 1.000 | 0.000 | 16.69 | 9125 |
| clap | S | -5.5 | -28.3 | 22.8 | 4.9e-6 | 1932 | 0 | 1.000 | 0.000 | 2.40 | 5657 |
| clap | P | -5.5 | -28.3 | 22.8 | 4.9e-6 | 1932 | 0 | 1.000 | 0.000 | 2.40 | 5657 |
| bass_oct3 | S | -11.6 | -19.9 | 8.3 | 2.0e-4 | 158 | 0 | 1.000 | 0.000 | 0.93 | 797 |
| bass_oct3 | P | -11.6 | -19.9 | 8.3 | 2.0e-4 | 158 | 0 | 1.000 | 0.000 | 0.93 | 797 |
| bass_oct2 | S | -12.5 | -24.7 | 12.2 | -3.0e-4 | 79 | 0 | 1.000 | 0.000 | 0.82 | 723 |
| bass_oct2 | P | -12.5 | -24.7 | 12.2 | -3.0e-4 | 79 | 0 | 1.000 | 0.000 | 0.82 | 723 |
| bass_oct1 | S | -12.5 | -24.6 | 12.1 | -1.5e-4 | 39 | 0 | 1.000 | 0.000 | 0.79 | 56 |
| bass_oct1 | P | -12.5 | -24.6 | 12.1 | -1.5e-4 | 39 | 0 | 1.000 | 0.000 | 0.79 | 56 |
| chords | S | -12.7 | -26.2 | 13.4 | -4.7e-5 | 1054 | 0 | 1.000 | 0.000 | 3.42 | 964 |
| chords | P | -12.7 | -26.2 | 13.4 | -4.7e-5 | 1054 | 0 | 1.000 | 0.000 | 3.42 | 964 |
| arp | S | -14.1 | -26.0 | 11.9 | -3.7e-4 | 534 | 0 | 1.000 | 0.000 | 6.73 | 5742 |
| arp | P | -14.1 | -26.0 | 11.9 | -3.7e-4 | 557 | 0 | 1.000 | 0.000 | 6.73 | 5759 |
| sparkle | S | -27.2 | -38.6 | 11.4 | -4.6e-6 | 677 | 0 | 1.000 | 0.000 | 3.56 | 2585 |
| sparkle | P | -27.2 | -38.6 | 11.4 | -4.6e-6 | 677 | 0 | 1.000 | 0.000 | 3.56 | 2585 |

## Per-track comparison

| track | ref ev | dut ev | lag ms | lvl dB | resid dBFS | envCorr | onset | centroid ΔHz | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kick | 18 | 18 | 0.00 | 0.00 | -Infinity | 1.0000 | 1.00 | 0 | MATCH |
| hats | 72 | 72 | 0.00 | 0.00 | -Infinity | 1.0000 | 1.00 | 0 | MATCH |
| openhat | 36 | 36 | 0.00 | 0.00 | -Infinity | 1.0000 | 1.00 | 0 | MATCH |
| clap | 9 | 9 | 0.00 | 0.00 | -Infinity | 1.0000 | 1.00 | 0 | MATCH |
| bass_oct3 | 4 | 4 | 0.00 | 0.00 | -Infinity | 1.0000 | n/a | 0 | MATCH |
| bass_oct2 | 4 | 4 | 0.00 | 0.00 | -Infinity | 1.0000 | n/a | 0 | MATCH |
| bass_oct1 | 4 | 4 | 0.00 | 0.00 | -Infinity | 1.0000 | n/a | 0 | MATCH |
| chords | 16 | 16 | 0.00 | 0.00 | -Infinity | 1.0000 | n/a | 0 | MATCH |
| arp | 67 | 68 | 0.00 | -2.97 | -29.2 | 0.9239 | 0.60 | 166 | VARIANT (phrase branch differs — expected `|` randomness) (arp-diff.wav) |
| sparkle | 72 | 72 | 0.00 | 0.00 | -Infinity | 1.0000 | 1.00 | 0 | MATCH |