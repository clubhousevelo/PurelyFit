# PurelyFit Modern

Hardware-first prototype for a clean-room replacement of the legacy PurelyCustom / PrecisionFit software.

## Current scope

- Runs locally in a browser with no build step.
- Reads live Powerbahn telemetry over Web Serial.
- Renders live power, cadence, speed, grade, gear, brake RPM, and a power trend.
- Controls Powerbahn grade, gear, and fixed-power resistance through the recovered legacy serial commands.
- Keeps session/customer scaffolding available for later ride recording work.
- Uses canvas charts and throttled rendering so telemetry updates do not force a full UI redraw for every packet.
- Displays power as a rolling 3-second average while preserving the current raw power in the sublabel.
- Keeps optional Bluetooth LE and ANT+ power/heart-rate sensor hooks outside the main Powerbahn dashboard.

## Run

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173
```

## Architecture direction

The replacement should keep data acquisition separate from rendering:

- `WindowsSerialSource`: talks to the bike over COM ports.
- `MacSerialSource`: talks to the same USB serial device through `/dev/tty.*` or `/dev/cu.*`.
- `BluetoothSensorSource`: subscribes to BLE Heart Rate and Cycling Power notifications.
- `BluetoothResistanceController`: requests FTMS control and writes fixed target power commands with command timeouts.
- `AntSensorSource`: reads ANT+ HR and bicycle power profiles through a USB ANT stick.
- `TelemetryStore`: persists customers, sessions, and per-sample telemetry to SQLite.
- `DashboardRenderer`: updates canvas charts on animation frames, not on every serial packet.
- `PowerAverager`: maintains a time-based rolling 3-second display window and resets when the active power source changes.

This allows Windows hardware support to arrive first while keeping Mac compatibility practical.

## Next implementation step

Build a desktop wrapper around this core UI. Electron is the quickest cross-platform route because serial, Bluetooth LE, and native USB bridge support can be handled on Windows and Mac. A later native rewrite can keep the same data model and protocol parser.

## Sensor protocol notes

- Legacy Powerbahn dashboard polling uses the command sequence `A5 A8 A9 B4 D0 D2`. The original PrecisionFit app reads the 3-byte responses as little-endian `UInt16` values plus a trailing status byte, not as one 24-bit number.
- Legacy dashboard values map as `A5=speed`, `A8=grade`, `A9=gear`, `B4=power`, `D0=brake RPM`, and `D2=temperature/status`. Speed is displayed as raw speed times `0.621371 / 100`; cadence is brake RPM divided by `15.394`; grade is raw grade divided by `10`.
- Legacy Grade Up/Down queues a whole-number grade, sends grade times `10`, and writes command `0x28` with payload `[gradeLow, gradeHigh, 0x4C]` inside the standard XOR-framed serial packet.
- Legacy Gear Up/Down writes command `0x29` with one gear byte inside the same XOR-framed serial packet.
- Legacy fixed wattage is the `parameterAutoPower` extra-configuration path. The app sends command `0x1A` with encrypted payload `[0x67, 0x00, wattLow, wattHigh]`; unchecking fixed power sends wattage `0`. The original clamps fixed wattage to `0..1000 W`.
- Legacy encrypted configuration frames use the seed returned by the `0x9F` startup request. The payload is encrypted, then XOR-checksummed and byte-stuffed before `F1/F2` framing.
- BLE Heart Rate Service: service `0x180D`, measurement characteristic `0x2A37`.
- BLE Cycling Power Service: service `0x1818`, measurement characteristic `0x2A63`.
- The BLE Power and BLE HR buttons request devices that advertise those services and subscribe to notifications.
- BLE Fitness Machine Service: service `0x1826`, control point characteristic `0x2AD9`. Fixed power uses the FTMS Set Target Power procedure and waits for the control-point response before sending another command.
- ANT+ heart-rate and power meters need an ANT USB stick. The browser cannot talk ANT+ directly, so the desktop wrapper should expose ANT+ readings to the UI through a small local bridge.
- The legacy `HeartRate SerialPort=COM8` path was likely for a separate receiver/dongle that translated HR data into serial bytes. Modern HR straps usually advertise BLE and/or ANT+, so serial HR can become an optional compatibility source instead of the main path.
- Power source selection is exclusive: serial bike power, BLE power meter, or ANT+ power meter. Heart-rate source selection is also exclusive: serial HR receiver, BLE HR strap, or ANT+ HR strap.
