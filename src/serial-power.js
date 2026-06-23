const POWERBAHN_BAUD_RATE = 9600;
const FRAME_START = 0xf1;
const FRAME_END = 0xf2;
const DASHBOARD_POLL_INTERVAL_MS = 300;

const COMMANDS = {
  speed: 0xa5,
  cadence: 0xa8,
  power: 0xb4,
  heartRate: 0xd0,
};

const POWERBAHN_WAKE = new Uint8Array([
  FRAME_START,
  0x9f,
  0x9f,
  FRAME_END,
]);

const POWERBAHN_DASHBOARD_POLL = new Uint8Array([
  FRAME_START,
  COMMANDS.speed,
  COMMANDS.cadence,
  0xa9,
  COMMANDS.power,
  COMMANDS.heartRate,
  0xd2,
  0x12,
  FRAME_END,
]);

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
    frameCount: 0,
    parsedFrameCount: 0,
    byteCount: 0,
    writeCount: 0,
    signals: null,
    pollTimer: null,
    readLoop: null,
    debugTimer: null,
    onFrame: null,
    onDebug: null,
    onMeasurement: null,
    onStatus: null,
  };
}

export async function connectSerialPower(controller, { port = null, portName = "" } = {}) {
  if (!controller.supported) {
    throw new Error("Web Serial is not available. Use Chrome or Edge over HTTPS or localhost.");
  }

  await disconnectSerialPower(controller);
  const selectedPort = port ?? await navigator.serial.requestPort();
  const portLabel = portName ? ` (${portName})` : "";

  setSerialStatus(controller, `Opening Powerbahn serial port${portLabel}`);
  try {
    await selectedPort.open({
      baudRate: POWERBAHN_BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      bufferSize: 1024,
    });
  } catch (error) {
    controller.lastError = error.message;
    setSerialStatus(controller, `Unable to open serial port${portLabel}: ${error.message}`);
    throw error;
  }

  try {
    await selectedPort.setSignals({
      dataTerminalReady: true,
      requestToSend: true,
      break: false,
    });
    controller.signals = "DTR/RTS on";
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

  await writeFrame(controller, POWERBAHN_WAKE);
  await writeFrame(controller, POWERBAHN_DASHBOARD_POLL);
  notifyDebug(controller);
  setSerialStatus(controller, `Connected to Powerbahn serial power${portLabel}`);
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
  controller.pollTimer = null;
  controller.debugTimer = null;

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
          handleFrame(controller, frame.slice());
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
  await controller.writer.write(frame);
  controller.writeCount += 1;
  notifyDebug(controller);
}

function handleFrame(controller, payload) {
  controller.lastPacketHex = toHex(payload);
  controller.lastFrameAt = new Date();
  controller.frameCount += 1;
  const measurement = parsePowerbahnDashboardPayload(payload);
  if (!measurement) {
    controller.onFrame?.({ payload, rawHex: controller.lastPacketHex, measurement: null });
    return;
  }
  controller.parsedFrameCount += 1;
  controller.lastMeasurement = measurement;
  controller.onFrame?.({ payload, rawHex: controller.lastPacketHex, measurement });
  controller.onMeasurement?.(measurement);
}

function parsePowerbahnDashboardPayload(payload) {
  const values = new Map();
  let index = payload[0] === 0x01 ? 1 : 0;

  while (index < payload.length) {
    const command = payload[index];
    const byteCount = payload[index + 1];
    if (byteCount == null || byteCount < 1 || index + 2 + byteCount > payload.length) break;

    let value = 0;
    for (let i = 0; i < byteCount; i += 1) {
      value = (value << 8) | payload[index + 2 + i];
    }
    values.set(command, value);
    index += 2 + byteCount;
  }

  if (!values.has(COMMANDS.power) && !values.has(COMMANDS.cadence)) return null;

  return {
    power: values.get(COMMANDS.power) ?? null,
    cadence: values.get(COMMANDS.cadence) ?? null,
    speedRaw: values.get(COMMANDS.speed) ?? null,
    heartRate: values.get(COMMANDS.heartRate) ?? null,
    rawHex: toHex(payload),
  };
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
