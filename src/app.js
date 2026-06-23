import {
  SENSOR_TRANSPORTS,
  SENSOR_TYPES,
  createSensor,
  createSimulatedSensorValue,
  getSensorSummary,
  parseBluetoothCyclingPowerMeasurement,
  parseBluetoothHeartRateMeasurement,
} from "./sensors.js";
import {
  connectSerialPower,
  createSerialPowerController,
  disconnectSerialPower,
  getGrantedSerialPorts,
  getSerialPortLabel,
} from "./serial-power.js";
import {
  clampPower,
  connectResistanceUnit,
  createResistanceController,
  disconnectResistanceUnit,
  releaseResistanceControl,
  setFixedResistancePower,
} from "./resistance.js";

const DATA_PATHS = {
  dashboard: "./data/dashboard_data.csv",
  leftPolar: "./data/left_plot_smoothed.csv",
  rightPolar: "./data/right_plot_smoothed.csv",
};

const RESISTANCE_POWER_MIN = 0;
const RESISTANCE_POWER_MAX = 1200;
const RESISTANCE_POWER_STEP = 5;
const SERIAL_PORT_STORAGE_KEY = "purelyfit.serialPort";

const BLUETOOTH_SENSOR_PROFILES = {
  [SENSOR_TYPES.power]: {
    service: 0x1818,
    characteristic: 0x2a63,
    fallbackName: "BLE Power Meter",
    searchLabel: "power meters",
  },
  [SENSOR_TYPES.heartRate]: {
    service: 0x180d,
    characteristic: 0x2a37,
    fallbackName: "BLE Heart Strap",
    searchLabel: "heart-rate sensors",
  },
};

const state = {
  running: false,
  tick: 0,
  speed: 4,
  samples: [],
  history: [],
  powerDisplayHistory: [],
  activePowerSourceId: null,
  leftPolar: [],
  rightPolar: [],
  activeSensors: {
    [SENSOR_TYPES.power]: null,
    [SENSOR_TYPES.heartRate]: null,
  },
  bluetoothConnections: {
    [SENSOR_TYPES.power]: null,
    [SENSOR_TYPES.heartRate]: null,
  },
  serialPower: createSerialPowerController(),
  grantedSerialPorts: [],
  serialPortName: localStorage.getItem(SERIAL_PORT_STORAGE_KEY) || "COM7",
  sensorConnect: {
    message: "Ready to connect sensors",
    busyType: null,
    error: false,
  },
  resistance: createResistanceController(),
  sessions: [],
  customers: [
    { firstName: "Sample", lastName: "Rider", email: "sample@local.test", phone: "555-0100" },
  ],
  lastFrame: 0,
  timer: null,
};

const elements = {};

function bindElements() {
  [
    "statusDot",
    "connectionStatus",
    "sampleCounter",
    "screenTitle",
    "playPauseButton",
    "stepButton",
    "speedSlider",
    "powerValue",
    "powerAverage",
    "cadenceValue",
    "cadenceAverage",
    "speedValue",
    "distanceValue",
    "heartValue",
    "calorieValue",
    "balanceValue",
    "trendStatus",
    "leftPeak",
    "rightPeak",
    "balanceCanvas",
    "trendCanvas",
    "leftPolarCanvas",
    "rightPolarCanvas",
    "sessionRows",
    "customerRows",
    "recordSessionButton",
    "customerForm",
    "sensorCards",
    "useSerialPowerButton",
    "useBluetoothPowerButton",
    "useAntPowerButton",
    "useSerialHeartButton",
    "useBluetoothHeartButton",
    "useAntHeartButton",
    "serialPortInput",
    "serialPortSelect",
    "refreshSerialPortsButton",
    "sensorConnectStatus",
    "serialDebugPanel",
    "serialDebugText",
    "resistanceStatus",
    "resistanceTargetInput",
    "resistanceTargetSlider",
    "resistancePowerSlider",
    "connectResistanceButton",
    "applyResistanceButton",
    "releaseResistanceButton",
    "disconnectResistanceButton",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

async function boot() {
  bindElements();
  wireEvents();
  initializeSerialPortControls();
  await loadReplayData();
  await refreshGrantedSerialPorts();
  renderCustomers();
  recordSession("Baseline Replay");
  renderAll(true);
}

function wireEvents() {
  elements.playPauseButton.addEventListener("click", toggleReplay);
  elements.stepButton.addEventListener("click", () => advanceReplay(1));
  elements.speedSlider.addEventListener("input", (event) => {
    state.speed = Number(event.target.value);
    if (state.running) restartTimer();
  });
  elements.recordSessionButton.addEventListener("click", () => recordSession("Replay Capture"));
  elements.customerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.customers.push({
      firstName: form.get("firstName"),
      lastName: form.get("lastName"),
      email: form.get("email"),
      phone: form.get("phone"),
    });
    renderCustomers();
  });
  elements.useSerialPowerButton.addEventListener("click", connectPowerbahnSerialSensor);
  elements.serialPortInput.addEventListener("input", (event) => {
    state.serialPortName = event.target.value.trim();
    localStorage.setItem(SERIAL_PORT_STORAGE_KEY, state.serialPortName);
    renderSensorConnectStatus();
  });
  elements.serialPortSelect.addEventListener("change", renderSensorConnectStatus);
  elements.refreshSerialPortsButton.addEventListener("click", refreshGrantedSerialPorts);
  elements.useBluetoothPowerButton.addEventListener("click", () => connectBluetoothSensor(SENSOR_TYPES.power));
  elements.useAntPowerButton.addEventListener("click", () => selectSensorSource({
    type: SENSOR_TYPES.power,
    transport: SENSOR_TRANSPORTS.ant,
    name: "ANT+ Power Meter",
  }));
  elements.useSerialHeartButton.addEventListener("click", () => selectSensorSource({
    id: "legacy-heart-serial",
    type: SENSOR_TYPES.heartRate,
    transport: SENSOR_TRANSPORTS.serial,
    name: "Serial Heart Receiver",
  }));
  elements.useBluetoothHeartButton.addEventListener("click", () => connectBluetoothSensor(SENSOR_TYPES.heartRate));
  elements.useAntHeartButton.addEventListener("click", () => selectSensorSource({
    type: SENSOR_TYPES.heartRate,
    transport: SENSOR_TRANSPORTS.ant,
    name: "ANT+ Heart Strap",
  }));
  state.resistance.onStatus = () => renderResistanceControl();
  elements.resistanceTargetInput.addEventListener("input", syncResistanceTarget);
  elements.resistancePowerSlider.addEventListener("pointerdown", handleResistanceSliderPointer);
  elements.resistancePowerSlider.addEventListener("keydown", handleResistanceSliderKeydown);
  document.querySelectorAll("[data-power-step]").forEach((button) => {
    button.addEventListener("click", () => adjustResistanceTarget(Number(button.dataset.powerStep)));
  });
  elements.connectResistanceButton.addEventListener("click", () => runResistanceAction(
    () => connectResistanceUnit(state.resistance),
  ));
  elements.applyResistanceButton.addEventListener("click", () => runResistanceAction(
    () => setFixedResistancePower(state.resistance, state.resistance.targetPower),
  ));
  elements.releaseResistanceButton.addEventListener("click", () => runResistanceAction(
    () => releaseResistanceControl(state.resistance),
  ));
  elements.disconnectResistanceButton.addEventListener("click", () => {
    disconnectResistanceUnit(state.resistance);
    renderResistanceControl();
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setPanel(button.dataset.panel));
  });
  state.serialPower.onStatus = () => {
    renderSensorConnectStatus();
    renderSensors();
    renderSerialDebug();
  };
  state.serialPower.onDebug = renderSerialDebug;
  state.serialPower.onFrame = updateSerialDebug;
  state.serialPower.onMeasurement = updateSerialPowerSensorValue;
}

function initializeSerialPortControls() {
  elements.serialPortInput.value = state.serialPortName;
  elements.refreshSerialPortsButton.disabled = !state.serialPower.supported;
}

async function loadReplayData() {
  const [dashboardCsv, leftCsv, rightCsv] = await Promise.all([
    fetchText(DATA_PATHS.dashboard),
    fetchText(DATA_PATHS.leftPolar),
    fetchText(DATA_PATHS.rightPolar),
  ]);
  state.samples = parseDashboardCsv(dashboardCsv);
  state.leftPolar = parsePolarCsv(leftCsv);
  state.rightPolar = parsePolarCsv(rightCsv);
  state.activeSensors[SENSOR_TYPES.power] = createSensor({
    id: "legacy-bike-serial",
    name: "Legacy Bike Replay",
    type: SENSOR_TYPES.power,
    transport: SENSOR_TRANSPORTS.serial,
  });
  state.activeSensors[SENSOR_TYPES.heartRate] = createSensor({
    id: "legacy-heart-serial",
    name: "Legacy HR Replay",
    type: SENSOR_TYPES.heartRate,
    transport: SENSOR_TRANSPORTS.serial,
  });
  updateSensors();
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.text();
}

function parseDashboardCsv(csv) {
  return csv
    .trim()
    .split(/\r?\n/)
    .map((line, index) => {
      const cols = line.split(",").map((value) => Number(value.trim()) || 0);
      const rawSpeed = cols[1] ?? 0;
      const rawCadence = cols[4] ?? 0;
      const rawPower = cols[6] ?? 0;
      const rawHeart = cols[8] ?? 0;
      const grade = cols[2] ?? 0;
      const gear = cols[3] ?? 0;
      const seconds = index * 3;
      return {
        index,
        seconds,
        speed: rawSpeed / 3.1,
        cadence: rawCadence,
        power: rawPower,
        heart: rawHeart || null,
        grade,
        gear,
        distance: (rawSpeed / 3.1) * (seconds / 3600),
        calories: Math.round((rawPower * seconds) / 4184),
      };
    });
}

function parsePolarCsv(csv) {
  return csv
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const cols = line.split(",").map((value) => Number(value.trim()) || 0);
      return { angle: cols[0], value: cols[1] };
    })
    .filter((point) => Number.isFinite(point.angle) && Number.isFinite(point.value));
}

function toggleReplay() {
  state.running = !state.running;
  elements.playPauseButton.textContent = state.running ? "Pause Replay" : "Start Replay";
  elements.connectionStatus.textContent = state.running ? "Replay running" : "Replay paused";
  elements.statusDot.classList.toggle("live", state.running);
  restartTimer();
}

function restartTimer() {
  clearInterval(state.timer);
  if (!state.running) return;
  state.timer = setInterval(() => advanceReplay(1), Math.max(20, 180 / state.speed));
}

function advanceReplay(count) {
  for (let i = 0; i < count; i += 1) {
    const sample = state.samples[state.tick % state.samples.length];
    state.history.push(sample);
    if (state.history.length > 240) state.history.shift();
    state.tick += 1;
    updateSensors();
    updatePowerDisplayHistory();
  }
  renderAll(false);
}

function getCurrentSample() {
  return state.history.at(-1) ?? state.samples[0] ?? {
    power: 0,
    cadence: 0,
    speed: 0,
    distance: 0,
    calories: 0,
    heart: null,
  };
}

function renderAll(force) {
  const now = performance.now();
  if (!force && now - state.lastFrame < 33) return;
  state.lastFrame = now;

  const sample = getCurrentSample();
  const powerSensor = getBestSensor(SENSOR_TYPES.power);
  const heartSensor = getBestSensor(SENSOR_TYPES.heartRate);
  const rawPower = powerSensor?.value ?? sample.power;
  const displayPower = getRollingPowerAverage();
  const displayCadence = powerSensor?.cadence ?? sample.cadence;
  const displayHeart = heartSensor?.value ?? sample.heart;
  const averagePower = average(state.history, "power");
  const averageCadence = average(state.history, "cadence");
  const leftAvg = averagePoints(state.leftPolar);
  const rightAvg = averagePoints(state.rightPolar);
  const total = Math.max(1, leftAvg + rightAvg);
  const leftPercent = Math.round((leftAvg / total) * 100);
  const rightPercent = 100 - leftPercent;

  elements.sampleCounter.textContent = `${state.tick} samples`;
  elements.powerValue.textContent = `${Math.round(displayPower)} W`;
  elements.powerAverage.textContent = powerSensor
    ? `${powerSensor.name} · raw ${Math.round(rawPower)} W`
    : `raw ${Math.round(rawPower)} W · ride avg ${Math.round(averagePower)} W`;
  elements.cadenceValue.textContent = `${Math.round(displayCadence)} RPM`;
  elements.cadenceAverage.textContent = `avg ${Math.round(averageCadence)} RPM`;
  elements.speedValue.textContent = `${sample.speed.toFixed(1)} mph`;
  elements.distanceValue.textContent = `${sample.distance.toFixed(2)} mi`;
  elements.heartValue.textContent = displayHeart ? `${Math.round(displayHeart)} bpm` : "-- bpm";
  elements.calorieValue.textContent = `${sample.calories} kcal`;
  elements.balanceValue.textContent = leftAvg === 0 && rightAvg > 0
    ? `sample data: ${leftPercent} / ${rightPercent}`
    : `${leftPercent} / ${rightPercent}`;
  elements.trendStatus.textContent = state.running ? "streaming" : "idle";
  elements.leftPeak.textContent = `peak ${Math.round(maxPoint(state.leftPolar))}`;
  elements.rightPeak.textContent = `peak ${Math.round(maxPoint(state.rightPolar))}`;

  drawBalance(elements.balanceCanvas, leftPercent, rightPercent);
  drawTrend(elements.trendCanvas, state.history);
  drawPolar(elements.leftPolarCanvas, state.leftPolar, "#0f766e");
  drawPolar(elements.rightPolarCanvas, state.rightPolar, "#d64045");
  renderSensors();
  renderSensorConnectStatus();
  renderResistanceControl();
}

function average(items, key) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item[key], 0) / items.length;
}

function averagePoints(points) {
  if (!points.length) return 0;
  return points.reduce((sum, item) => sum + Math.max(0, item.value), 0) / points.length;
}

function maxPoint(points) {
  return points.reduce((max, point) => Math.max(max, point.value), 0);
}

function drawBalance(canvas, left, right) {
  const ctx = prepareCanvas(canvas);
  const { width, height } = getCanvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  drawRoundedBar(ctx, 30, 78, width - 60, 54, "#edf2f4");
  drawRoundedBar(ctx, 30, 78, (width - 60) * (left / 100), 54, "#0f766e");
  drawRoundedBar(ctx, 30 + (width - 60) * (left / 100), 78, (width - 60) * (right / 100), 54, "#d64045");
  ctx.fillStyle = "#172026";
  ctx.font = "700 30px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(`${left}% left`, width * 0.25, 55);
  ctx.fillText(`${right}% right`, width * 0.75, 55);
  ctx.font = "600 13px system-ui";
  ctx.fillStyle = "#62717a";
  ctx.fillText("smoothed torque distribution", width / 2, 162);
}

function drawRoundedBar(ctx, x, y, width, height, color) {
  const radius = Math.min(10, height / 2, Math.abs(width) / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, width), height, radius);
  ctx.fill();
}

function drawTrend(canvas, history) {
  const ctx = prepareCanvas(canvas);
  const { width, height } = getCanvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  if (history.length < 2) return;
  const maxPower = Math.max(120, ...history.map((sample) => sample.power));
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#2d6cdf";
  ctx.beginPath();
  history.forEach((sample, index) => {
    const x = (index / (history.length - 1)) * (width - 40) + 20;
    const y = height - 24 - (sample.power / maxPower) * (height - 48);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = "#d9e1e5";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(width - 16, y);
    ctx.stroke();
  }
}

function drawPolar(canvas, points, color) {
  const ctx = prepareCanvas(canvas);
  const { width, height } = getCanvasSize(canvas);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.42;
  const peak = Math.max(1, maxPoint(points));
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#d9e1e5";
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= 4; ring += 1) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, (radius / 4) * ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let deg = 0; deg < 360; deg += 45) {
    const rad = toRadians(deg - 90);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + Math.cos(rad) * radius, centerY + Math.sin(rad) * radius);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((point, index) => {
    const rad = toRadians(point.angle - 90);
    const valueRadius = (Math.max(0, point.value) / peak) * radius;
    const x = centerX + Math.cos(rad) * valueRadius;
    const y = centerY + Math.sin(rad) * valueRadius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
}

function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const { width: cssWidth, height: cssHeight } = getCanvasSize(canvas);
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function getCanvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function recordSession(name) {
  const history = state.history.length ? state.history : state.samples.slice(0, 30);
  const leftAvg = averagePoints(state.leftPolar);
  const rightAvg = averagePoints(state.rightPolar);
  const total = Math.max(1, leftAvg + rightAvg);
  state.sessions.unshift({
    name,
    date: new Date().toLocaleString(),
    power: Math.round(average(history, "power")),
    cadence: Math.round(average(history, "cadence")),
    balance: `${Math.round((leftAvg / total) * 100)} / ${Math.round((rightAvg / total) * 100)}`,
  });
  renderSessions();
}

function updatePowerDisplayHistory() {
  const sample = getCurrentSample();
  const powerSensor = getBestSensor(SENSOR_TYPES.power);
  const power = powerSensor?.value ?? sample.power;
  const sourceId = powerSensor?.id ?? "replay";
  const now = performance.now();
  if (state.activePowerSourceId !== sourceId) {
    state.activePowerSourceId = sourceId;
    state.powerDisplayHistory = [];
  }
  state.powerDisplayHistory.push({ at: now, power });
  trimPowerDisplayHistory(now);
}

function trimPowerDisplayHistory(now = performance.now()) {
  const windowMs = 3000;
  while (
    state.powerDisplayHistory.length > 1 &&
    now - state.powerDisplayHistory[0].at > windowMs
  ) {
    state.powerDisplayHistory.shift();
  }
}

function getRollingPowerAverage() {
  trimPowerDisplayHistory();
  if (!state.powerDisplayHistory.length) return getCurrentSample().power;
  return state.powerDisplayHistory.reduce((sum, item) => sum + item.power, 0) / state.powerDisplayHistory.length;
}

async function selectSensorSource({ id, type, transport, name }) {
  if (transport !== SENSOR_TRANSPORTS.bluetooth) disconnectBluetoothSensor(type);
  if (type === SENSOR_TYPES.power && transport !== SENSOR_TRANSPORTS.serial) {
    await disconnectSerialPower(state.serialPower);
  }
  const sensorId = id ?? `${type}-${transport.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  const sensor = createSensor({ id: sensorId, type, transport, name });
  state.activeSensors[type] = sensor;
  updateSensor(sensor);
  if (type === SENSOR_TYPES.power) {
    state.activePowerSourceId = null;
    updatePowerDisplayHistory();
  }
  renderAll(true);
}

async function connectPowerbahnSerialSensor() {
  if (!state.serialPower.supported) {
    setSensorConnectStatus(state.serialPower.status, { error: true });
    return;
  }

  disconnectBluetoothSensor(SENSOR_TYPES.power);
  const sensor = createSensor({
    id: "powerbahn-usb-serial",
    type: SENSOR_TYPES.power,
    transport: SENSOR_TRANSPORTS.serial,
    name: "Powerbahn USB Serial",
  });
  sensor.live = true;
  sensor.connected = false;
  sensor.value = null;
  state.activeSensors[SENSOR_TYPES.power] = sensor;
  state.activePowerSourceId = null;
  renderAll(true);

  const requestedPortName = elements.serialPortInput.value.trim();
  const grantedPort = getSelectedGrantedSerialPort();
  const portHint = requestedPortName ? ` ${requestedPortName}` : "";
  setSensorConnectStatus(`Connecting to Powerbahn USB serial${portHint}...`, { busyType: SENSOR_TYPES.power });

  try {
    await connectSerialPower(state.serialPower, {
      port: grantedPort,
      portName: requestedPortName,
    });
    sensor.connected = true;
    sensor.lastSeen = new Date();
    setSensorConnectStatus(state.serialPower.status);
  } catch (error) {
    sensor.connected = false;
    state.serialPower.lastError = error.message;
    setSensorConnectStatus(getSerialConnectError(error), { error: true });
  } finally {
    renderAll(true);
  }
}

async function refreshGrantedSerialPorts() {
  if (!state.serialPower.supported) {
    renderGrantedSerialPorts();
    return;
  }

  try {
    state.grantedSerialPorts = await getGrantedSerialPorts();
  } catch (error) {
    state.serialPower.lastError = error.message;
  }
  renderGrantedSerialPorts();
  renderSensorConnectStatus();
}

function renderGrantedSerialPorts() {
  const selectedValue = elements.serialPortSelect.value;
  const options = [
    '<option value="">Use browser picker</option>',
    ...state.grantedSerialPorts.map((port, index) => (
      `<option value="${index}">${escapeHtml(getSerialPortLabel(port, index))}</option>`
    )),
  ];

  elements.serialPortSelect.innerHTML = options.join("");
  if (selectedValue && Number(selectedValue) < state.grantedSerialPorts.length) {
    elements.serialPortSelect.value = selectedValue;
  }
  elements.serialPortSelect.disabled = !state.serialPower.supported;
}

function getSelectedGrantedSerialPort() {
  const selectedValue = elements.serialPortSelect.value;
  if (selectedValue === "") return null;
  const index = Number(selectedValue);
  if (!Number.isInteger(index)) return null;
  return state.grantedSerialPorts[index] ?? null;
}

function updateSerialPowerSensorValue(measurement) {
  const sensor = state.activeSensors[SENSOR_TYPES.power];
  if (!sensor || sensor.id !== "powerbahn-usb-serial") return;

  sensor.connected = true;
  sensor.live = true;
  sensor.value = measurement.power;
  sensor.cadence = measurement.cadence;
  sensor.heartRate = measurement.heartRate;
  sensor.lastSeen = new Date();
  sensor.rawPacket = measurement.rawHex;

  updatePowerDisplayHistory();
  renderAll(true);
}

function updateSerialDebug({ rawHex, measurement }) {
  const sensor = state.activeSensors[SENSOR_TYPES.power];
  if (sensor?.id === "powerbahn-usb-serial") {
    sensor.connected = true;
    sensor.live = true;
    sensor.rawPacket = rawHex;
    sensor.rawFrameCount = state.serialPower.frameCount;
    sensor.parsedFrameCount = state.serialPower.parsedFrameCount;
    sensor.lastSeen = new Date();
    if (!measurement && sensor.value == null) sensor.value = null;
  }
  renderSerialDebug();
  renderSensors();
}

async function connectBluetoothSensor(type) {
  const profile = BLUETOOTH_SENSOR_PROFILES[type];
  if (!profile) return;

  if (!navigator.bluetooth) {
    setSensorConnectStatus("Web Bluetooth is not available in this browser.", { error: true });
    return;
  }

  setSensorConnectStatus(`Searching for ${profile.searchLabel}...`, { busyType: type });

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [profile.service] }],
      optionalServices: [profile.service],
    });

    setSensorConnectStatus(`Connecting to ${device.name || profile.fallbackName}...`, { busyType: type });
    disconnectBluetoothSensor(type);

    const sensor = createSensor({
      id: device.id || `${type}-bluetooth-live`,
      type,
      transport: SENSOR_TRANSPORTS.bluetooth,
      name: device.name || profile.fallbackName,
    });
    sensor.live = true;
    sensor.value = null;
    state.activeSensors[type] = sensor;
    if (type === SENSOR_TYPES.power) {
      state.activePowerSourceId = null;
      updatePowerDisplayHistory();
    }
    renderAll(true);

    device.addEventListener("gattserverdisconnected", () => {
      sensor.connected = false;
      if (state.activeSensors[type]?.id === sensor.id) {
        setSensorConnectStatus(`${sensor.name} disconnected`, { error: true });
        renderAll(true);
      }
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(profile.service);
    const characteristic = await service.getCharacteristic(profile.characteristic);
    await characteristic.startNotifications();

    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      updateBluetoothSensorValue(sensor, event.target.value);
      if (type === SENSOR_TYPES.power) updatePowerDisplayHistory();
      renderAll(true);
    });

    state.bluetoothConnections[type] = { device, characteristic, sensor };
    setSensorConnectStatus(`Connected to ${sensor.name}`);
    renderAll(true);
  } catch (error) {
    setSensorConnectStatus(getBluetoothConnectError(error, profile), { error: true });
    renderAll(true);
  }
}

function disconnectBluetoothSensor(type) {
  const connection = state.bluetoothConnections[type];
  if (!connection) return;

  try {
    connection.characteristic?.stopNotifications?.();
  } catch {
    // Best-effort cleanup; disconnecting the GATT server is enough for browser BLE.
  }

  if (connection.device?.gatt?.connected) {
    connection.device.gatt.disconnect();
  }
  state.bluetoothConnections[type] = null;
}

function getSerialConnectError(error) {
  if (error.name === "NotFoundError") return "No Powerbahn serial port selected.";
  if (error.name === "SecurityError") return "Serial port access was blocked by browser permissions.";
  if (/open/i.test(error.message || "")) {
    return "Unable to open the Powerbahn serial port. Close other apps or browser tabs using it, unplug/replug the USB cable, then select the USB serial device again.";
  }
  return error.message || "Unable to connect to the Powerbahn serial port.";
}

function updateBluetoothSensorValue(sensor, dataView) {
  if (sensor.type === SENSOR_TYPES.heartRate) {
    const measurement = parseBluetoothHeartRateMeasurement(dataView);
    sensor.value = measurement.heartRate;
    sensor.lastSeen = new Date();
    return;
  }

  const measurement = parseBluetoothCyclingPowerMeasurement(dataView);
  sensor.value = measurement.power;
  sensor.balance = measurement.balance;
  sensor.lastSeen = new Date();
}

function setSensorConnectStatus(message, { busyType = null, error = false } = {}) {
  state.sensorConnect = { message, busyType, error };
  renderSensorConnectStatus();
}

function renderSensorConnectStatus() {
  if (!elements.sensorConnectStatus) return;
  const requestedPort = state.serialPortName ? `SerialPort=${state.serialPortName}` : "SerialPort not set";
  const selectedPort = getSelectedGrantedSerialPort()
    ? ` · selected ${getSerialPortLabel(getSelectedGrantedSerialPort(), Number(elements.serialPortSelect.value))}`
    : "";
  const serialSuffix = state.serialPower.lastError
    ? ` · ${state.serialPower.status}`
    : state.serialPower.connected
      ? ` · ${state.serialPower.status}`
      : "";
  elements.sensorConnectStatus.textContent = `${state.sensorConnect.message} · ${requestedPort}${selectedPort}${serialSuffix}`;
  elements.sensorConnectStatus.classList.toggle("warning", state.sensorConnect.error);
  elements.sensorConnectStatus.classList.toggle("busy", Boolean(state.sensorConnect.busyType));
}

function renderSerialDebug() {
  if (!elements.serialDebugText) return;
  const { serialPower } = state;
  const measurement = serialPower.lastMeasurement;
  const lastFrameAt = serialPower.lastFrameAt
    ? serialPower.lastFrameAt.toLocaleTimeString()
    : "never";
  const parsedText = measurement
    ? `parsed power=${measurement.power ?? "--"} cadence=${measurement.cadence ?? "--"}`
    : "no parsed telemetry yet";
  const rawText = serialPower.lastPacketHex
    ? `last raw ${serialPower.lastPacketHex}`
    : "no raw packet";

  elements.serialDebugText.textContent = [
    `frames ${serialPower.frameCount}`,
    `parsed ${serialPower.parsedFrameCount}`,
    `writes ${serialPower.writeCount}`,
    `bytes ${serialPower.byteCount}`,
    serialPower.signals ?? "signals not set",
    `last ${lastFrameAt}`,
    parsedText,
    rawText,
  ].join(" · ");
  elements.serialDebugPanel.classList.toggle("live", serialPower.frameCount > 0);
}

function getBluetoothConnectError(error, profile) {
  if (error.name === "NotFoundError") return `No ${profile.searchLabel} selected.`;
  if (error.name === "SecurityError") return "Bluetooth search was blocked by browser permissions.";
  if (error.name === "NotSupportedError") return `${profile.fallbackName} does not expose the expected service.`;
  return error.message || `Unable to connect to ${profile.searchLabel}.`;
}

function updateSensors() {
  Object.values(state.activeSensors).forEach((sensor) => {
    if (sensor) updateSensor(sensor);
  });
}

function updateSensor(sensor) {
  if (sensor.live) return;

  const sample = getCurrentSample();
  if (sensor.transport === SENSOR_TRANSPORTS.serial) {
    sensor.value = sensor.type === SENSOR_TYPES.power ? sample.power : sample.heart;
    sensor.cadence = sensor.type === SENSOR_TYPES.power ? sample.cadence : null;
    sensor.balance = null;
    sensor.battery = null;
  } else {
    Object.assign(sensor, createSimulatedSensorValue(sensor, state.tick));
  }
  sensor.lastSeen = new Date();
}

function getBestSensor(type) {
  const sensor = state.activeSensors[type];
  return sensor?.connected && sensor.value != null ? sensor : null;
}

function renderSensors() {
  elements.sensorCards.innerHTML = Object.values(state.activeSensors)
    .filter(Boolean)
    .map((sensor) => `
      <article class="sensor-card">
        <header>
          <div>
            <h4>${escapeHtml(sensor.name)}</h4>
            <p>${sensor.type === SENSOR_TYPES.power ? "Power source" : "Heart-rate source"}</p>
          </div>
          <span class="sensor-pill">${escapeHtml(sensor.transport)}</span>
        </header>
        <div class="sensor-value">${escapeHtml(getSensorSummary(sensor))}</div>
        <div class="sensor-meta">
          ${sensor.cadence == null ? "" : `<span>${sensor.cadence} RPM</span>`}
          ${sensor.balance == null ? "" : `<span>${sensor.balance}% L</span>`}
          ${sensor.battery == null ? "" : `<span>${sensor.battery}% battery</span>`}
          ${sensor.rawFrameCount == null ? "" : `<span>${sensor.parsedFrameCount ?? 0}/${sensor.rawFrameCount} parsed frames</span>`}
          ${sensor.rawPacket == null ? "" : `<span title="${escapeHtml(sensor.rawPacket)}">serial packet</span>`}
        </div>
      </article>
    `)
    .join("");
  updateSourceButtons();
}

function updateSourceButtons() {
  const powerTransport = state.activeSensors[SENSOR_TYPES.power]?.transport;
  const heartTransport = state.activeSensors[SENSOR_TYPES.heartRate]?.transport;
  const { busyType } = state.sensorConnect;
  [
    ["useSerialPowerButton", powerTransport === SENSOR_TRANSPORTS.serial],
    ["useBluetoothPowerButton", powerTransport === SENSOR_TRANSPORTS.bluetooth],
    ["useAntPowerButton", powerTransport === SENSOR_TRANSPORTS.ant],
    ["useSerialHeartButton", heartTransport === SENSOR_TRANSPORTS.serial],
    ["useBluetoothHeartButton", heartTransport === SENSOR_TRANSPORTS.bluetooth],
    ["useAntHeartButton", heartTransport === SENSOR_TRANSPORTS.ant],
  ].forEach(([id, active]) => {
    elements[id].classList.toggle("selected", active);
  });
  elements.useBluetoothPowerButton.disabled = Boolean(busyType);
  elements.useBluetoothHeartButton.disabled = Boolean(busyType);
  elements.useSerialPowerButton.disabled = busyType === SENSOR_TYPES.power;
  elements.useSerialPowerButton.textContent = busyType === SENSOR_TYPES.power
    ? "Connecting..."
    : state.serialPower.connected
      ? "Serial Connected"
      : "Serial Power";
  elements.useBluetoothPowerButton.textContent = busyType === SENSOR_TYPES.power
    ? "Searching..."
    : "Search BLE Power";
  elements.useBluetoothHeartButton.textContent = busyType === SENSOR_TYPES.heartRate
    ? "Searching..."
    : "Search BLE HR";
}

function syncResistanceTarget(event) {
  setResistanceTarget(event.target.value);
}

function adjustResistanceTarget(delta) {
  setResistanceTarget(state.resistance.targetPower + delta);
}

function setResistanceTarget(value) {
  const targetPower = normalizeResistancePower(value);
  state.resistance.targetPower = targetPower;
  updateResistanceTargetControls(targetPower);
  renderResistanceControl();
}

function updateResistanceTargetControls(targetPower) {
  const percent = ((targetPower - RESISTANCE_POWER_MIN) / (
    RESISTANCE_POWER_MAX - RESISTANCE_POWER_MIN
  )) * 100;

  elements.resistanceTargetInput.value = targetPower;
  elements.resistanceTargetSlider.value = targetPower;
  elements.resistancePowerSlider.style.setProperty("--power-percent", `${percent}%`);
  elements.resistancePowerSlider.setAttribute("aria-valuenow", targetPower);
  elements.resistancePowerSlider.setAttribute("aria-valuetext", `${targetPower} W`);
}

function handleResistanceSliderPointer(event) {
  event.preventDefault();
  elements.resistancePowerSlider.setPointerCapture?.(event.pointerId);
  setResistanceTargetFromPointer(event);

  const handleMove = (moveEvent) => setResistanceTargetFromPointer(moveEvent);
  const stopTracking = () => {
    elements.resistancePowerSlider.removeEventListener("pointermove", handleMove);
    elements.resistancePowerSlider.removeEventListener("pointerup", stopTracking);
    elements.resistancePowerSlider.removeEventListener("pointercancel", stopTracking);
  };

  elements.resistancePowerSlider.addEventListener("pointermove", handleMove);
  elements.resistancePowerSlider.addEventListener("pointerup", stopTracking);
  elements.resistancePowerSlider.addEventListener("pointercancel", stopTracking);
}

function setResistanceTargetFromPointer(event) {
  const track = elements.resistancePowerSlider.querySelector(".power-slider-track");
  const rect = track.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  setResistanceTarget(RESISTANCE_POWER_MIN + ratio * (
    RESISTANCE_POWER_MAX - RESISTANCE_POWER_MIN
  ));
}

function handleResistanceSliderKeydown(event) {
  const keyStep = {
    ArrowLeft: -RESISTANCE_POWER_STEP,
    ArrowDown: -RESISTANCE_POWER_STEP,
    ArrowRight: RESISTANCE_POWER_STEP,
    ArrowUp: RESISTANCE_POWER_STEP,
    PageDown: -25,
    PageUp: 25,
  }[event.key];

  if (keyStep != null) {
    event.preventDefault();
    setResistanceTarget(state.resistance.targetPower + (
      event.shiftKey ? Math.sign(keyStep) * 25 : keyStep
    ));
  } else if (event.key === "Home") {
    event.preventDefault();
    setResistanceTarget(RESISTANCE_POWER_MIN);
  } else if (event.key === "End") {
    event.preventDefault();
    setResistanceTarget(RESISTANCE_POWER_MAX);
  }
}

function normalizeResistancePower(value) {
  const clamped = clampPower(value);
  const snapped = Math.round(clamped / RESISTANCE_POWER_STEP) * RESISTANCE_POWER_STEP;
  return Math.min(RESISTANCE_POWER_MAX, Math.max(RESISTANCE_POWER_MIN, snapped));
}

async function runResistanceAction(action) {
  renderResistanceControl();
  try {
    await action();
  } catch (error) {
    state.resistance.lastError = error.message;
  } finally {
    renderResistanceControl();
  }
}

function renderResistanceControl() {
  const { resistance } = state;
  if (!elements.resistanceStatus) return;

  updateResistanceTargetControls(resistance.targetPower);
  elements.resistanceStatus.textContent = resistance.lastError
    ? `${resistance.status} · ${resistance.lastError}`
    : resistance.status;

  const canUseBluetooth = resistance.supported;
  elements.connectResistanceButton.disabled = resistance.busy || !canUseBluetooth || resistance.connected;
  elements.applyResistanceButton.disabled = resistance.busy;
  elements.releaseResistanceButton.disabled = resistance.busy || !resistance.connected;
  elements.disconnectResistanceButton.disabled = resistance.busy || !resistance.connected;

  elements.applyResistanceButton.textContent = resistance.connected
    ? `Apply ${resistance.targetPower} W`
    : `Stage ${resistance.targetPower} W`;
}

function renderSessions() {
  elements.sessionRows.innerHTML = state.sessions
    .map((session) => `
      <tr>
        <td>${escapeHtml(session.name)}</td>
        <td>${escapeHtml(session.date)}</td>
        <td>${session.power} W</td>
        <td>${session.cadence} RPM</td>
        <td>${session.balance}</td>
      </tr>
    `)
    .join("");
}

function renderCustomers() {
  elements.customerRows.innerHTML = state.customers
    .map((customer) => `
      <tr>
        <td>${escapeHtml(customer.firstName)} ${escapeHtml(customer.lastName)}</td>
        <td>${escapeHtml(customer.email)}</td>
        <td>${escapeHtml(customer.phone)}</td>
      </tr>
    `)
    .join("");
}

function setPanel(panelName) {
  const titleByPanel = {
    dashboard: "Live Dashboard",
    sensors: "Sensors",
    sessions: "Sessions",
    customers: "Customers",
    settings: "Settings",
  };
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.panel === panelName);
  });
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(`${panelName}Panel`).classList.add("active");
  elements.screenTitle.textContent = titleByPanel[panelName];
  renderAll(true);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

window.addEventListener("resize", () => renderAll(true));
boot().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
