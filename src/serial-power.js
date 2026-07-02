const DEFAULT_POWERBAHN_BAUD_RATE = 115200;
const FRAME_START = 0xf1;
const FRAME_END = 0xf2;
const DASHBOARD_POLL_INTERVAL_MS = 300;
const TORQUE_POLL_INTERVAL_MS = 3000;
const OPEN_SETTLE_MS = 600;
const SPEED_MPH_PER_RAW_UNIT = 0.621371 / 100;
const BRAKE_RPM_TO_CADENCE_DIVISOR = 15.394;
const GRADE_UPDATE_STATUS = 0x4c;
const POWER_UPDATE_UNIT = 0x58;
const EXTRA_CONFIGURATION_COMMAND = 0x1a;
const AUTO_POWER_PARAMETER_ID = 0x67;
const AUTO_POWER_RESERVED_BYTE = 0x00;
const POWERBAHN_CAPTURED_ENCRYPTION_SEED = 0xc788;
const FIXED_POWER_MAX = 1000;
const GEAR_MAX = 13;
const TORQUE_PROFILE_SIZE = 360;
const TORQUE_RANGE_SAMPLE_COUNT = 60;
const TORQUE_RANGE_IDS = [0x05b4, 0x05f0, 0x062c, 0x0668, 0x06a4, 0x06e0];
const TORQUE_RANGE_STARTS = new Map(TORQUE_RANGE_IDS.map((id, index) => [id, index * TORQUE_RANGE_SAMPLE_COUNT]));
const TORQUE_RANGE_COMPLETE_MASK = (1 << TORQUE_RANGE_IDS.length) - 1;

const ENCRYPTION_KEY = new Uint8Array([
  0x45, 0xfa, 0xb2, 0x4c, 0x4c, 0x52, 0x91, 0x7a, 0x4c, 0x8d, 0xda, 0xb1, 0x4b, 0x45, 0xf3, 0x8e,
  0xc5, 0xa0, 0x15, 0xd7, 0x5b, 0x2d, 0x09, 0xde, 0xcc, 0xd9, 0xe6, 0x2b, 0x23, 0xbf, 0x2a, 0xfc,
  0xca, 0x12, 0xb3, 0xa1, 0x57, 0x5d, 0x9c, 0x6c, 0x69, 0xc0, 0x7b, 0x2d, 0x09, 0xe5, 0x3e, 0xeb,
  0xf9, 0x27, 0xde, 0xcd, 0xd6, 0xd7, 0x81, 0x04, 0xae, 0x6f, 0x90, 0x0a, 0x44, 0xea, 0x43, 0x98,
  0xda, 0x80, 0x60, 0x23, 0x35, 0x65, 0xee, 0xcb, 0x12, 0xe1, 0xe7, 0x23, 0x59, 0x06, 0x04, 0x27,
  0x61, 0xb6, 0x76, 0x79, 0xfc, 0xd5, 0x22, 0x4e, 0x79, 0xd5, 0x8e, 0xb7, 0x36, 0x96, 0x4d, 0x39,
  0x53, 0x19, 0xd9, 0xf3, 0x19, 0x7a, 0xda, 0x7a, 0x7d, 0xf1, 0x1b, 0xba, 0x9e, 0x8a, 0xa4, 0xee,
  0xd3, 0xf9, 0x8b, 0xd1, 0xec, 0x4c, 0x66, 0x96, 0x1d, 0x48, 0xc3, 0x4c, 0xbd, 0x6a, 0x20, 0x73,
  0xc4, 0xc7, 0x5a, 0x90, 0x23, 0x07, 0x94, 0xad, 0x87, 0xad, 0x1c, 0x12, 0xff, 0xbe, 0x19, 0x60,
  0x56, 0x1b, 0xc0, 0x70, 0xca, 0xb1, 0x52, 0x70, 0x19, 0x9a, 0x63, 0x6d, 0x7c, 0x67, 0x71, 0xe9,
  0xd6, 0xe0, 0xc4, 0x1b, 0xc8, 0x95, 0xdc, 0xfe, 0xcf, 0xa7, 0xb6, 0xc0, 0xf5, 0x15, 0x45, 0xfe,
  0xdb, 0x88, 0xcc, 0x8b, 0x9e, 0xf0, 0x44, 0x61, 0x6c, 0x75, 0xdc, 0xd3, 0xf9, 0x73, 0xa2, 0x0e,
  0x29, 0x9e, 0x31, 0x7b, 0x44, 0xd1, 0x7f, 0x9f, 0x3d, 0x9c, 0x22, 0xcd, 0x02, 0xfb, 0x4a, 0x5c,
  0xf4, 0x76, 0x23, 0xa3, 0xda, 0x8a, 0x19, 0x4d, 0x36, 0x28, 0x59, 0x91, 0x6e, 0x4b, 0x0c, 0xa7,
  0xcd, 0x96, 0x27, 0x91, 0x29, 0x83, 0xdd, 0xdf, 0x31, 0x6a, 0x92, 0x4f, 0xea, 0xef, 0xef, 0x84,
  0x4f, 0xaa, 0x59, 0x28, 0x12, 0x65, 0xd1, 0xbc, 0x2f, 0xa3, 0xb4, 0x64, 0x6c, 0xe4, 0x27, 0x39,
]);

const COMMANDS = {
  speed: 0xa5,
  grade: 0xa8,
  gear: 0xa9,
  setPower: 0x34,
  power: 0xb4,
  brakeRpm: 0xd0,
  crankAngle: 0xd2,
};

const DASHBOARD_RESPONSE_FIELDS = [
  [COMMANDS.speed, 3],
  [COMMANDS.grade, 3],
  [COMMANDS.gear, 1],
  [COMMANDS.power, 3],
  [COMMANDS.brakeRpm, 3],
  [COMMANDS.crankAngle, 2],
];

const POWERBAHN_WAKE = new Uint8Array([
  FRAME_START,
  0x9f,
  0x9f,
  FRAME_END,
]);

const POWERBAHN_DASHBOARD_POLL = new Uint8Array([
  FRAME_START,
  COMMANDS.speed,
  COMMANDS.grade,
  COMMANDS.gear,
  COMMANDS.power,
  COMMANDS.brakeRpm,
  COMMANDS.crankAngle,
  0x12,
  FRAME_END,
]);

const POWERBAHN_CONFIG_PAYLOAD = new Uint8Array([
  0x00, 0x00, 0x12, 0x0a, 0x00, 0xc8, 0x00, 0x11,
  0x00, 0x00, 0x00, 0x28, 0x00, 0x18, 0x1a, 0xe1,
  0x04, 0x02, 0x01, 0x77, 0x01, 0x9b, 0x01, 0x32,
  0x00, 0x03, 0x00, 0x00, 0x00,
]);

const POWERBAHN_TORQUE_SETUP = new Uint8Array([
  FRAME_START,
  0x9e,
  0x03,
  0xe9,
  0x03,
  0x02,
  0x75,
  FRAME_END,
]);

const POWERBAHN_TORQUE_RANGE_REQUESTS = [
  [0xb4, 0x05, 0x78, 0x54],
  [0xf3, 0x00, 0x05, 0x78, 0x10],
  [0x2c, 0x06, 0x78, 0xcf],
  [0x68, 0x06, 0x78, 0x8b],
  [0xa4, 0x06, 0x78, 0x47],
  [0xe0, 0x06, 0x78, 0x03],
].map((payload) => new Uint8Array([
  FRAME_START,
  0x9e,
  0x03,
  ...payload,
  FRAME_END,
]));

const POWERBAHN_STARTUP_SEQUENCE = [
  ["wake", POWERBAHN_WAKE, 120],
  ["config", createPowerbahnConfigurationFrame, 220],
  ["dashboard", POWERBAHN_DASHBOARD_POLL, 80],
  ["torque setup", POWERBAHN_TORQUE_SETUP, 80],
  ...POWERBAHN_TORQUE_RANGE_REQUESTS.map((frame, index) => [
    `torque range ${index + 1}`,
    frame,
    40,
  ]),
];

export function createSerialPowerController() {
  const supported = typeof navigator !== "undefined" && Boolean(navigator.serial);
  return {
    supported,
    port: null,
    reader: null,
    writer: null,
    connected: false,
    status: supported ? "Disconnected" : "Web Serial unavailable",
    lastError: null,
    lastPacketHex: null,
    lastFrameAt: null,
    lastMeasurement: null,
    portInfo: null,
    frameCount: 0,
    parsedFrameCount: 0,
    byteCount: 0,
    writeCount: 0,
    writeQueue: Promise.resolve(),
    signals: null,
    startupStep: null,
    targetGrade: 0,
    targetGear: 0,
    activeGrade: null,
    activeGear: null,
    targetFixedPower: 150,
    fixedPowerEnabled: false,
    activeFixedPower: null,
    targetPureLogicFixedPower: 150,
    pureLogicFixedPowerEnabled: false,
    activePureLogicFixedPower: null,
    torqueProfile: Array(TORQUE_PROFILE_SIZE).fill(0),
    torqueRangeMask: 0,
    torqueFrameCount: 0,
    torquePollTimer: null,
    torquePollInFlight: false,
    torqueRotationCount: 0,
    lastTorqueAnalysis: null,
    encryptionSeed: null,
    encryptionSeedHex: null,
    pollTimer: null,
    readLoop: null,
    debugTimer: null,
    onFrame: null,
    onDebug: null,
    onMeasurement: null,
    onTorque: null,
    onStatus: null,
  };
}

export async function connectSerialPower(controller, {
  port = null,
  portName = "",
  baudRate = DEFAULT_POWERBAHN_BAUD_RATE,
  flowControl = "none",
  dataTerminalReady = true,
  requestToSend = true,
} = {}) {
  if (!controller.supported) {
    throw new Error("Web Serial is not available. Use Chrome or Edge over HTTPS or localhost.");
  }

  await disconnectSerialPower(controller);
  resetSerialStats(controller);
  const selectedPort = port ?? await navigator.serial.requestPort();
  controller.portInfo = getSerialPortLabel(selectedPort, 0);
  const portLabel = portName ? ` (${portName}, ${baudRate} baud)` : ` (${baudRate} baud)`;

  setSerialStatus(controller, `Opening Powerbahn serial port${portLabel}`);
  try {
    await selectedPort.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl,
      bufferSize: 1024,
    });
  } catch (error) {
    controller.lastError = error.message;
    setSerialStatus(controller, `Unable to open serial port${portLabel}: ${error.message}`);
    throw error;
  }

  try {
    await selectedPort.setSignals({
      dataTerminalReady,
      requestToSend,
      break: false,
    });
    controller.signals = `DTR ${dataTerminalReady ? "on" : "off"} / RTS ${requestToSend ? "on" : "off"} / flow ${flowControl}`;
  } catch (error) {
    controller.signals = `signals unavailable: ${error.message}`;
  }

  controller.port = selectedPort;
  controller.writer = selectedPort.writable.getWriter();
  controller.reader = selectedPort.readable.getReader();
  controller.connected = true;
  controller.lastError = null;

  controller.readLoop = readSerialFrames(controller);
  controller.pollTimer = window.setInterval(() => {
    writeFrame(controller, POWERBAHN_DASHBOARD_POLL).catch((error) => {
      controller.lastError = error.message;
      setSerialStatus(controller, `Serial write failed: ${error.message}`);
    });
  }, DASHBOARD_POLL_INTERVAL_MS);
  controller.debugTimer = window.setInterval(() => notifyDebug(controller), 500);
  controller.torquePollTimer = window.setInterval(() => {
    pollTorqueRanges(controller).catch((error) => {
      controller.lastError = error.message;
      setSerialStatus(controller, `Torque poll failed: ${error.message}`);
    });
  }, TORQUE_POLL_INTERVAL_MS);

  await delay(OPEN_SETTLE_MS);
  await sendStartupSequence(controller);
  notifyDebug(controller);
  setSerialStatus(controller, `Connected to Powerbahn serial power${portLabel}`);
}

export async function setSerialGrade(controller, grade) {
  const targetGrade = clampGrade(grade);
  controller.targetGrade = targetGrade;

  if (!controller.connected || !controller.writer) {
    setSerialStatus(controller, `Grade staged at ${targetGrade}%`);
    return;
  }

  const rawGrade = targetGrade * 10;
  await writeFrame(controller, createLongCommandFrame(
    0x28,
    lowHighBytes(rawGrade, GRADE_UPDATE_STATUS),
  ));
  controller.activeGrade = targetGrade;
  setSerialStatus(controller, `Grade set to ${targetGrade}%`);
}

export async function setSerialGear(controller, gear) {
  const targetGear = clampByte(gear);
  controller.targetGear = targetGear;

  if (!controller.connected || !controller.writer) {
    setSerialStatus(controller, `Gear staged at ${targetGear}`);
    return;
  }

  await writeFrame(controller, createLongCommandFrame(0x29, [targetGear]));
  controller.activeGear = targetGear;
  setSerialStatus(controller, `Gear set to ${targetGear}`);
}

export async function setSerialFixedPower(controller, enabled, watts) {
  const targetPower = clampFixedPower(watts);
  const fixedPowerEnabled = Boolean(enabled);
  const autoPower = fixedPowerEnabled ? targetPower : 0;
  controller.targetFixedPower = targetPower;
  controller.fixedPowerEnabled = fixedPowerEnabled;

  if (!controller.connected || !controller.writer) {
    const stagedText = fixedPowerEnabled ? `${targetPower} W` : "off";
    setSerialStatus(controller, `Fixed power staged ${stagedText}`);
    return;
  }

  await sendPowerUpdate(controller, autoPower);
  controller.activeFixedPower = autoPower;
  setSerialStatus(controller, fixedPowerEnabled
    ? `Fixed power set to ${targetPower} W`
    : "Fixed power released");
}

export async function setSerialPureLogicFixedPower(controller, enabled, watts) {
  const targetPower = clampFixedPower(watts);
  const fixedPowerEnabled = Boolean(enabled);
  const autoPower = fixedPowerEnabled ? targetPower : 0;
  controller.targetPureLogicFixedPower = targetPower;
  controller.pureLogicFixedPowerEnabled = fixedPowerEnabled;

  if (!controller.connected || !controller.writer) {
    const stagedText = fixedPowerEnabled ? `${targetPower} W` : "off";
    setSerialStatus(controller, `PureLogic fixed power staged ${stagedText}`);
    return;
  }

  await sendAutoPowerExtraConfiguration(controller, autoPower);
  controller.activePureLogicFixedPower = autoPower;
  setSerialStatus(controller, fixedPowerEnabled
    ? `PureLogic fixed power set to ${targetPower} W`
    : "PureLogic fixed power released");
}

export async function getGrantedSerialPorts() {
  if (typeof navigator === "undefined" || !navigator.serial) return [];
  return navigator.serial.getPorts();
}

export function getSerialPortLabel(port, index) {
  const info = port?.getInfo?.() ?? {};
  const parts = [];
  if (info.usbVendorId != null) parts.push(`VID ${toHexId(info.usbVendorId)}`);
  if (info.usbProductId != null) parts.push(`PID ${toHexId(info.usbProductId)}`);
  return parts.length ? parts.join(" / ") : `Granted port ${index + 1}`;
}

export async function disconnectSerialPower(controller) {
  if (controller.pollTimer) window.clearInterval(controller.pollTimer);
  if (controller.debugTimer) window.clearInterval(controller.debugTimer);
  if (controller.torquePollTimer) window.clearInterval(controller.torquePollTimer);
  controller.pollTimer = null;
  controller.debugTimer = null;
  controller.torquePollTimer = null;

  const reader = controller.reader;
  const writer = controller.writer;
  const port = controller.port;
  const readLoop = controller.readLoop;
  controller.reader = null;
  controller.writer = null;
  controller.port = null;
  controller.readLoop = null;

  try {
    await reader?.cancel?.();
  } catch {
    // The browser may already have closed the stream.
  }

  try {
    await readLoop;
  } catch {
    // Read-loop errors are reflected in status while connected.
  }

  try {
    writer?.releaseLock?.();
  } catch {
    // Best-effort cleanup for partially opened ports.
  }

  if (port?.readable || port?.writable) {
    try {
      await port.close?.();
    } catch {
      // Some browsers throw if the device was physically unplugged first.
    }
  }

  controller.connected = false;
  controller.activeGrade = null;
  controller.activeGear = null;
  controller.activeFixedPower = null;
  controller.activePureLogicFixedPower = null;
  setSerialStatus(controller, controller.supported ? "Disconnected" : "Web Serial unavailable");
}

async function readSerialFrames(controller) {
  const frame = [];
  let inFrame = false;
  const reader = controller.reader;

  try {
    while (controller.reader === reader) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      controller.byteCount += value.byteLength;
      notifyDebug(controller);

      for (const byte of value) {
        if (byte === FRAME_START) {
          frame.length = 0;
          inFrame = true;
          continue;
        }

        if (!inFrame) continue;

        if (byte === FRAME_END) {
          handleFrame(controller, unstuffFrameBytes(frame));
          frame.length = 0;
          inFrame = false;
          continue;
        }

        frame.push(byte);
      }
    }
  } catch (error) {
    if (controller.connected) {
      controller.lastError = error.message;
      setSerialStatus(controller, `Serial read failed: ${error.message}`);
    }
  } finally {
    try {
      reader?.releaseLock?.();
    } catch {
      // The lock may already be released after cancellation.
    }
  }
}

async function writeFrame(controller, frame) {
  if (!controller.writer) throw new Error("Serial port is not writable.");
  controller.writeQueue = controller.writeQueue
    .catch(() => undefined)
    .then(async () => {
      if (!controller.writer) throw new Error("Serial port is not writable.");
      await controller.writer.write(frame);
      controller.writeCount += 1;
      notifyDebug(controller);
    });
  return controller.writeQueue;
}

async function sendStartupSequence(controller) {
  for (const [label, frameSource, waitMs] of POWERBAHN_STARTUP_SEQUENCE) {
    const frame = typeof frameSource === "function" ? frameSource(controller) : frameSource;
    controller.startupStep = label;
    setSerialStatus(controller, `Sending Powerbahn ${label}`);
    await writeFrame(controller, frame);
    await delay(waitMs);
  }
  if (controller.fixedPowerEnabled) {
    const targetPower = clampFixedPower(controller.targetFixedPower);
    controller.startupStep = "fixed power";
    await sendPowerUpdate(controller, targetPower);
    controller.activeFixedPower = targetPower;
  }
  if (controller.pureLogicFixedPowerEnabled) {
    const targetPower = clampFixedPower(controller.targetPureLogicFixedPower);
    controller.startupStep = "PureLogic fixed power";
    await sendAutoPowerExtraConfiguration(controller, targetPower);
    controller.activePureLogicFixedPower = targetPower;
  }
  controller.startupStep = "polling";
}

async function pollTorqueRanges(controller) {
  if (!controller.connected || !controller.writer || controller.torquePollInFlight) return;

  controller.torquePollInFlight = true;
  controller.torqueRangeMask = 0;
  try {
    await writeFrame(controller, POWERBAHN_TORQUE_SETUP);
    await delay(40);
    for (const frame of POWERBAHN_TORQUE_RANGE_REQUESTS) {
      await writeFrame(controller, frame);
      await delay(35);
    }
  } finally {
    controller.torquePollInFlight = false;
  }
}

function handleFrame(controller, payload) {
  controller.lastPacketHex = toHex(payload);
  controller.lastFrameAt = new Date();
  controller.frameCount += 1;
  if (applyPowerbahnEncryptionSeed(controller, payload)) {
    controller.onFrame?.({ payload, rawHex: controller.lastPacketHex, measurement: null });
    notifyDebug(controller);
    return;
  }
  const torqueRange = parsePowerbahnTorquePayload(controller, payload);
  if (torqueRange) {
    const torqueAnalysis = updateTorqueProfile(controller, torqueRange);
    controller.torqueFrameCount += 1;
    controller.lastTorqueAnalysis = torqueAnalysis;
    controller.onFrame?.({ payload, rawHex: controller.lastPacketHex, measurement: null, torqueRange });
    controller.onTorque?.(torqueAnalysis);
    notifyDebug(controller);
    return;
  }
  const measurement = parsePowerbahnDashboardPayload(payload);
  if (!measurement) {
    controller.onFrame?.({ payload, rawHex: controller.lastPacketHex, measurement: null });
    return;
  }
  applyPowerbahnDashboardInterpretation(controller, measurement);
  controller.parsedFrameCount += 1;
  controller.lastMeasurement = measurement;
  controller.onFrame?.({ payload, rawHex: controller.lastPacketHex, measurement });
  controller.onMeasurement?.(measurement);
}

function parsePowerbahnTorquePayload(controller, payload) {
  if (payload[0] !== 0x01 || payload[1] !== 0x9e || payload.length < 6) return null;

  const encryptedLength = payload[3];
  if (
    encryptedLength == null ||
    encryptedLength < 2 ||
    payload.length < 4 + encryptedLength
  ) {
    return null;
  }

  const decrypted = decryptPowerbahnPayload(
    payload.slice(4, 4 + encryptedLength),
    getEncryptionSeed(controller),
  );
  const rangeId = readUInt16LE(decrypted, 0);
  const startAngle = TORQUE_RANGE_STARTS.get(rangeId);
  if (startAngle == null) return null;

  const samples = [];
  for (
    let index = 2;
    index + 1 < decrypted.length && samples.length < TORQUE_RANGE_SAMPLE_COUNT;
    index += 2
  ) {
    samples.push(readUInt16LE(decrypted, index));
  }
  if (samples.length !== TORQUE_RANGE_SAMPLE_COUNT) return null;

  return {
    rangeId,
    rangeIndex: TORQUE_RANGE_IDS.indexOf(rangeId),
    startAngle,
    samples,
    rawHex: toHex(decrypted),
  };
}

function updateTorqueProfile(controller, torqueRange) {
  torqueRange.samples.forEach((value, index) => {
    const angle = (torqueRange.startAngle + index) % TORQUE_PROFILE_SIZE;
    controller.torqueProfile[angle] = Math.max(0, value);
  });
  controller.torqueRangeMask |= 1 << torqueRange.rangeIndex;
  const complete = controller.torqueRangeMask === TORQUE_RANGE_COMPLETE_MASK;
  if (complete) controller.torqueRotationCount += 1;
  return analyzeTorqueProfile(controller.torqueProfile, {
    complete,
    rangeCount: countBits(controller.torqueRangeMask),
    rotationCount: controller.torqueRotationCount,
    crankAngle: controller.lastMeasurement?.crankAngle ?? null,
  });
}

function analyzeTorqueProfile(profile, { complete, rangeCount, rotationCount, crankAngle }) {
  const smoothedProfile = circularMovingAverage(profile, 5);
  const peakTorque = Math.max(...smoothedProfile);
  const peakAngle = smoothedProfile.indexOf(peakTorque);
  const averageTorque = averageNumbers(smoothedProfile);
  let quietestAngle = 0;
  let quietestPair = Number.POSITIVE_INFINITY;

  for (let angle = 0; angle < 180; angle += 1) {
    const pair = smoothedProfile[angle] + smoothedProfile[(angle + 180) % TORQUE_PROFILE_SIZE];
    if (pair < quietestPair) {
      quietestPair = pair;
      quietestAngle = angle;
    }
  }

  const splitAngle = quietestAngle;
  const leftValues = collectTorqueHalf(smoothedProfile, splitAngle);
  const rightValues = collectTorqueHalf(smoothedProfile, splitAngle + 180);
  const leftWork = leftValues.reduce((sum, value) => sum + value, 0);
  const rightWork = rightValues.reduce((sum, value) => sum + value, 0);
  const totalWork = leftWork + rightWork;

  return {
    profile: smoothedProfile,
    rawProfile: [...profile],
    complete,
    rangeCount,
    rotationCount,
    peakTorque,
    peakAngle,
    averageTorque,
    splitAngle,
    quietestAngle,
    crankAngle: Number.isFinite(crankAngle) ? normalizeAngle(crankAngle) : null,
    referenceSource: "torque minimum",
    leftAverage: averageNumbers(leftValues),
    rightAverage: averageNumbers(rightValues),
    leftShare: totalWork ? (leftWork / totalWork) * 100 : null,
    rightShare: totalWork ? (rightWork / totalWork) * 100 : null,
    updatedAt: new Date(),
  };
}

function collectTorqueHalf(profile, startAngle) {
  return Array.from({ length: 180 }, (_, index) => (
    profile[(startAngle + index) % TORQUE_PROFILE_SIZE]
  ));
}

function normalizeAngle(value) {
  const angle = Math.round(Number(value));
  if (!Number.isFinite(angle)) return 0;
  return ((angle % TORQUE_PROFILE_SIZE) + TORQUE_PROFILE_SIZE) % TORQUE_PROFILE_SIZE;
}

function circularMovingAverage(values, radius) {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += values[(index + offset + values.length) % values.length];
      count += 1;
    }
    return sum / count;
  });
}

function averageNumbers(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countBits(value) {
  let count = 0;
  let bits = value;
  while (bits) {
    count += bits & 1;
    bits >>= 1;
  }
  return count;
}

export function parsePowerbahnDashboardPayload(payload) {
  if (!isDashboardPayload(payload)) return null;

  const values = new Map();
  let index = 1;

  while (index < payload.length) {
    const command = payload[index];
    const byteCount = payload[index + 1];
    if (byteCount == null || byteCount < 1 || index + 2 + byteCount > payload.length) break;

    values.set(command, parseDashboardField(payload, index, byteCount));
    index += 2 + byteCount;
  }

  if (!values.has(COMMANDS.power) && !values.has(COMMANDS.brakeRpm)) return null;

  const speed = values.get(COMMANDS.speed);
  const grade = values.get(COMMANDS.grade);
  const power = values.get(COMMANDS.power);
  const brakeRpm = values.get(COMMANDS.brakeRpm);
  const crankAngle = values.get(COMMANDS.crankAngle);

  return {
    rawPower: power?.value ?? null,
    rawPowerStatus: power?.status ?? null,
    speedRaw: speed?.value ?? null,
    speedStatus: speed?.status ?? null,
    gradeRaw: grade?.value ?? null,
    gradeStatus: grade?.status ?? null,
    grade: grade?.value == null ? null : grade.value / 10,
    gear: values.get(COMMANDS.gear)?.value ?? null,
    brakeRpm: brakeRpm?.value ?? null,
    brakeRpmStatus: brakeRpm?.status ?? null,
    cadence: brakeRpm?.value == null ? null : brakeRpm.value / BRAKE_RPM_TO_CADENCE_DIVISOR,
    crankAngleRaw: crankAngle?.value ?? null,
    crankAngle: crankAngle?.value == null ? null : normalizeAngle(crankAngle.value),
    rawHex: toHex(payload),
  };
}

function applyPowerbahnDashboardInterpretation(controller, measurement) {
  measurement.power = measurement.rawPower;
  measurement.filteredPower = null;
  measurement.speedMph = measurement.speedRaw == null
    ? null
    : measurement.speedRaw * SPEED_MPH_PER_RAW_UNIT;
}

function parseDashboardField(payload, index, byteCount) {
  if (byteCount === 1) {
    return { value: payload[index + 2], status: null };
  }

  const value = readUInt16LE(payload, index + 2);
  return {
    value,
    status: byteCount >= 3 ? payload[index + 4] : null,
  };
}

function readUInt16LE(bytes, index) {
  return (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
}

function createLongCommandFrame(command, data) {
  const bytes = [command, data.length, ...data];
  return new Uint8Array([
    FRAME_START,
    ...stuffFrameBytes([...bytes, xorChecksum(bytes)]),
    FRAME_END,
  ]);
}

function createPowerbahnConfigurationFrame(controller) {
  return createEncryptedLongCommandFrame(
    EXTRA_CONFIGURATION_COMMAND,
    POWERBAHN_CONFIG_PAYLOAD,
    getEncryptionSeed(controller),
  );
}

async function sendPowerUpdate(controller, watts) {
  const targetPower = clampFixedPower(watts);
  await writeFrame(controller, createLongCommandFrame(
    COMMANDS.setPower,
    lowHighBytes(targetPower, POWER_UPDATE_UNIT),
  ));
}

async function sendAutoPowerExtraConfiguration(controller, watts) {
  const targetPower = clampFixedPower(watts);
  await writeFrame(controller, createEncryptedLongCommandFrame(
    EXTRA_CONFIGURATION_COMMAND,
    [
      AUTO_POWER_PARAMETER_ID,
      AUTO_POWER_RESERVED_BYTE,
      targetPower & 0xff,
      (targetPower >> 8) & 0xff,
    ],
    getEncryptionSeed(controller),
  ));
}

function createEncryptedLongCommandFrame(command, data, seed) {
  return createLongCommandFrame(command, encryptPowerbahnPayload(data, seed));
}

function decryptPowerbahnPayload(data, rawSeed) {
  return encryptPowerbahnPayload(data, rawSeed);
}

function encryptPowerbahnPayload(data, rawSeed) {
  const seed = normalizeEncryptionSeed(rawSeed);
  const state = Array.from(ENCRYPTION_KEY);
  let x = seed & 0xff;
  let y = (seed >> 8) & 0xff;
  const encrypted = [];

  for (const byte of data) {
    x = (x + 1) & 0xff;
    y = (state[x] + y) & 0xff;
    const swap = state[x];
    state[x] = state[y];
    state[y] = swap;
    const keyByte = state[(state[x] + state[y]) & 0xff];
    encrypted.push(byte ^ keyByte);
  }

  return encrypted;
}

function normalizeEncryptionSeed(rawSeed) {
  let seed = (Number(rawSeed) ^ 0x5555) & 0xffff;
  if (seed === 0xffff) seed = 1;
  return seed;
}

function getEncryptionSeed(controller) {
  return controller.encryptionSeed ?? POWERBAHN_CAPTURED_ENCRYPTION_SEED;
}

function applyPowerbahnEncryptionSeed(controller, payload) {
  if (payload.length !== 6 || payload[0] !== 0x01 || payload[1] !== 0x9f || payload[2] !== 0x02) {
    return false;
  }
  if (xorChecksum(payload.slice(0, -1)) !== payload.at(-1)) return false;

  const seed = readUInt16LE(payload, 3);
  controller.encryptionSeed = seed;
  controller.encryptionSeedHex = toHexId(seed);
  setSerialStatus(controller, `Powerbahn encryption ${controller.encryptionSeedHex} ready`);
  return true;
}

function lowHighBytes(value, status) {
  const integer = Math.max(0, Math.round(value));
  return [
    integer & 0xff,
    (integer >> 8) & 0xff,
    status,
  ];
}

function xorChecksum(bytes) {
  return bytes.reduce((checksum, byte) => checksum ^ byte, 0);
}

function stuffFrameBytes(bytes) {
  const stuffed = [];
  for (const byte of bytes) {
    if (byte >= 0xf0 && byte <= 0xf3) {
      stuffed.push(0xf3, byte ^ 0xf0);
    } else {
      stuffed.push(byte);
    }
  }
  return stuffed;
}

function unstuffFrameBytes(bytes) {
  const unstuffed = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0xf3 && index + 1 < bytes.length) {
      unstuffed.push(bytes[index + 1] ^ 0xf0);
      index += 1;
    } else {
      unstuffed.push(byte);
    }
  }
  return unstuffed;
}

function clampGrade(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(25, Math.max(0, Math.round(number)));
}

function clampByte(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(GEAR_MAX, Math.max(0, Math.round(number)));
}

function clampFixedPower(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(FIXED_POWER_MAX, Math.max(0, Math.round(number)));
}

function isDashboardPayload(payload) {
  if (payload[0] !== 0x01) return false;
  let index = 1;

  for (const [command, byteCount] of DASHBOARD_RESPONSE_FIELDS) {
    if (payload[index] !== command || payload[index + 1] !== byteCount) return false;
    index += 2 + byteCount;
  }

  return index === payload.length - 1;
}

function toHex(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function toHexId(value) {
  return `0x${value.toString(16).padStart(4, "0").toUpperCase()}`;
}

function setSerialStatus(controller, status) {
  controller.status = status;
  controller.onStatus?.(controller);
}

function notifyDebug(controller) {
  controller.onDebug?.(controller);
}

function resetSerialStats(controller) {
  Object.assign(controller, {
    lastError: null,
    lastPacketHex: null,
    lastFrameAt: null,
    lastMeasurement: null,
    portInfo: null,
    frameCount: 0,
    parsedFrameCount: 0,
    byteCount: 0,
    writeCount: 0,
    writeQueue: Promise.resolve(),
    signals: null,
    startupStep: null,
    activeGrade: null,
    activeGear: null,
    activeFixedPower: null,
    torqueProfile: Array(TORQUE_PROFILE_SIZE).fill(0),
    torqueRangeMask: 0,
    torqueFrameCount: 0,
    torquePollInFlight: false,
    torqueRotationCount: 0,
    lastTorqueAnalysis: null,
    encryptionSeed: null,
    encryptionSeedHex: null,
  });
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
