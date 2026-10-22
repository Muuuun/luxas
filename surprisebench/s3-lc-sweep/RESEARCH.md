# Resonance frequency and loaded Q of the LC tank (board rev B)

For the design review of the rev B tank we need the resonance frequency and the loaded Q for each of the three tuning capacitors. The network-analyzer sweeps are in `input/`, one file per capacitor; the setup is in `input/README.txt`.

When you are done, also write `answer.json` in the project directory:
`{"f0_MHz": {"100pF": <value>, "150pF": <value>, "220pF": <value>}, "Q_loaded": {"100pF": <value>, "150pF": <value>, "220pF": <value>}}`
