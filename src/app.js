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
  setSerialFixedPower,
  setSerialGear,
  setSerialGrade,
  setSerialPureLogicFixedPower,
} from "./serial-power.js";
import {
  clampPower,
  connectResistanceUnit,
  createResistanceController,
  disconnectResistanceUnit,
  releaseResistanceControl,
  setFixedResistancePower,
} from "./resistance.js";

const RESISTANCE_POWER_MIN = 0;
const RESISTANCE_POWER_MAX = 1200;
const RESISTANCE_POWER_STEP = 5;
const POWER_ROLLING_WINDOW_MS = 3000;
const CADENCE_ROLLING_WINDOW_MS = 1000;
const LIVE_HISTORY_WINDOW_MS = Math.max(POWER_ROLLING_WINDOW_MS, CADENCE_ROLLING_WINDOW_MS);
const LIVE_GRAPH_SAMPLE_INTERVAL_MS = 3000;
const POWER_GAUGE_SCALE_W = 600;
const CADENCE_ACTIVE_POWER_THRESHOLD_W = 5;
const GRAPH_CADENCE_SCALE_RPM = 140;
const GRAPH_SPEED_SCALE_MPH = 40;
const SERIAL_PORT_STORAGE_KEY = "purelyfit.serialPort";
const SERIAL_BAUD_STORAGE_KEY = "purelyfit.serialBaud";
const SERIAL_FLOW_STORAGE_KEY = "purelyfit.serialFlow";
const SERIAL_DTR_STORAGE_KEY = "purelyfit.serialDtr";
const SERIAL_RTS_STORAGE_KEY = "purelyfit.serialRts";
const THEME_STORAGE_KEY = "purelyfit.theme";
const POWERBAHN_RELEASE_BAUD_RATE = 115200;
const POWERBAHN_FIXED_POWER_MAX = 1000;
const POWERBAHN_GEAR_MAX = 13;

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
  tick: 0,
  history: [],
  graphHistory: [],
  liveDisplayHistory: [],
  activePowerSourceId: null,
  lastGraphSampleAt: null,
  lastTelemetry: null,
  pedalAnalysis: null,
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
  serialBaudRate: Number(localStorage.getItem(SERIAL_BAUD_STORAGE_KEY)) || POWERBAHN_RELEASE_BAUD_RATE,
  serialFlowControl: localStorage.getItem(SERIAL_FLOW_STORAGE_KEY) || "none",
  serialDtr: localStorage.getItem(SERIAL_DTR_STORAGE_KEY) !== "false",
  serialRts: localStorage.getItem(SERIAL_RTS_STORAGE_KEY) !== "false",
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
};

const elements = {};

function bindElements() {
  [
    "statusDot",
    "connectionStatus",
    "sampleCounter",
    "screenTitle",
    "darkModeToggle",
    "powerMetric",
    "powerValue",
    "powerAverage",
    "cadenceMetric",
    "cadenceValue",
    "cadenceAverage",
    "speedMetric",
    "speedValue",
    "speedRawValue",
    "gradeValue",
    "gradeTargetValue",
    "gearValue",
    "gearTargetValue",
    "trendStatus",
    "trendCanvas",
    "pedalStatus",
    "pedalCanvas",
    "pedalBalanceValue",
    "pedalPeakValue",
    "pedalDeadSpotValue",
    "pedalAverageValue",
    "powerbahnSerialStatus",
    "powerbahnGradeInput",
    "applyPowerbahnGradeButton",
    "powerbahnGearInput",
    "applyPowerbahnGearButton",
    "powerbahnFixedPowerEnabledInput",
    "powerbahnFixedPowerInput",
    "applyPowerbahnFixedPowerButton",
    "powerbahnFixedPowerState",
    "powerbahnPureLogicFixedPowerEnabledInput",
    "powerbahnPureLogicFixedPowerInput",
    "applyPowerbahnPureLogicFixedPowerButton",
    "powerbahnPureLogicFixedPowerState",
    "resetPowerbahnResistanceButton",
    "sessionRows",
    "customerRows",
    "recordSessionButton",
    "customerForm",
    "sensorCards",
    "useSerialPowerButton",
    "disconnectSerialPowerButton",
    "useBluetoothPowerButton",
    "useAntPowerButton",
    "useSerialHeartButton",
    "useBluetoothHeartButton",
    "useAntHeartButton",
    "serialPortInput",
    "serialBaudSelect",
    "serialFlowSelect",
    "serialDtrInput",
    "serialRtsInput",
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
  initializeTheme();
  wireEvents();
  initializeSerialPortControls();
  await refreshGrantedSerialPorts();
  renderCustomers();
  renderAll(true);
}

function wireEvents() {
  elements.darkModeToggle.addEventListener("change", () => {
    setTheme(elements.darkModeToggle.checked ? "dark" : "light");
  });
  elements.recordSessionButton.addEventListener("click", () => recordSession("Live Snapshot"));
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
  elements.disconnectSerialPowerButton.addEventListener("click", disconnectPowerbahnSerialSensor);
  elements.serialPortInput.addEventListener("input", (event) => {
    state.serialPortName = event.target.value.trim();
    localStorage.setItem(SERIAL_PORT_STORAGE_KEY, state.serialPortName);
    renderSensorConnectStatus();
  });
  elements.serialBaudSelect.addEventListener("change", (event) => {
    state.serialBaudRate = Number(event.target.value);
    localStorage.setItem(SERIAL_BAUD_STORAGE_KEY, String(state.serialBaudRate));
    renderSensorConnectStatus();
    renderSerialDebug();
  });
  elements.serialFlowSelect.addEventListener("change", (event) => {
    state.serialFlowControl = event.target.value;
    localStorage.setItem(SERIAL_FLOW_STORAGE_KEY, state.serialFlowControl);
    renderSensorConnectStatus();
    renderSerialDebug();
  });
  elements.serialDtrInput.addEventListener("change", (event) => {
    state.serialDtr = event.target.checked;
    localStorage.setItem(SERIAL_DTR_STORAGE_KEY, String(state.serialDtr));
    renderSensorConnectStatus();
    renderSerialDebug();
  });
  elements.serialRtsInput.addEventListener("change", (event) => {
    state.serialRts = event.target.checked;
    localStorage.setItem(SERIAL_RTS_STORAGE_KEY, String(state.serialRts));
    renderSensorConnectStatus();
    renderSerialDebug();
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
  elements.powerbahnGradeInput.addEventListener("input", () => {
    syncPowerbahnTargetControls();
  });
  elements.powerbahnGearInput.addEventListener("input", () => {
    syncPowerbahnTargetControls();
  });
  elements.applyPowerbahnGradeButton.addEventListener("click", applyPowerbahnGrade);
  elements.applyPowerbahnGearButton.addEventListener("click", applyPowerbahnGear);
  elements.powerbahnFixedPowerEnabledInput.addEventListener("change", applyPowerbahnFixedPower);
  elements.powerbahnFixedPowerInput.addEventListener("input", syncPowerbahnFixedPowerControls);
  elements.applyPowerbahnFixedPowerButton.addEventListener("click", applyPowerbahnFixedPower);
  elements.powerbahnPureLogicFixedPowerEnabledInput.addEventListener("change", applyPowerbahnPureLogicFixedPower);
  elements.powerbahnPureLogicFixedPowerInput.addEventListener("input", syncPowerbahnPureLogicFixedPowerControls);
  elements.applyPowerbahnPureLogicFixedPowerButton.addEventListener("click", applyPowerbahnPureLogicFixedPower);
  elements.resetPowerbahnResistanceButton.addEventListener("click", resetPowerbahnResistance);
  document.querySelectorAll("[data-grade-step]").forEach((button) => {
    button.addEventListener("click", () => adjustPowerbahnGrade(Number(button.dataset.gradeStep)));
  });
  document.querySelectorAll("[data-gear-step]").forEach((button) => {
    button.addEventListener("click", () => adjustPowerbahnGear(Number(button.dataset.gearStep)));
  });
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
  state.serialPower.onTorque = updatePedalAnalysis;
}

function initializeTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  setTheme(storedTheme ?? (prefersDark ? "dark" : "light"), { persist: false });
}

function setTheme(theme, options = {}) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  elements.darkModeToggle.checked = nextTheme === "dark";
  if (options.persist !== false) {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }
  renderAll(true);
}

function initializeSerialPortControls() {
  elements.serialPortInput.value = state.serialPortName;
  elements.serialBaudSelect.value = String(state.serialBaudRate);
  elements.serialFlowSelect.value = state.serialFlowControl;
  elements.serialDtrInput.checked = state.serialDtr;
  elements.serialRtsInput.checked = state.serialRts;
  elements.refreshSerialPortsButton.disabled = !state.serialPower.supported;
  elements.powerbahnGradeInput.value = state.serialPower.targetGrade;
  elements.powerbahnGearInput.value = state.serialPower.targetGear;
  elements.powerbahnFixedPowerEnabledInput.checked = state.serialPower.fixedPowerEnabled;
  elements.powerbahnFixedPowerInput.value = state.serialPower.targetFixedPower;
  elements.powerbahnPureLogicFixedPowerEnabledInput.checked = state.serialPower.pureLogicFixedPowerEnabled;
  elements.powerbahnPureLogicFixedPowerInput.value = state.serialPower.targetPureLogicFixedPower;
}

function getCurrentSample() {
  return state.history.at(-1) ?? {
    power: 0,
    cadence: 0,
    speed: 0,
    heart: null,
  };
}

function renderAll(force) {
  const now = performance.now();
  if (!force && now - state.lastFrame < 33) return;
  state.lastFrame = now;

  const powerSensor = getBestSensor(SENSOR_TYPES.power);
  const rawPower = powerSensor?.rawPower ?? powerSensor?.value ?? null;
  const displayPower = getRollingAverage("power", POWER_ROLLING_WINDOW_MS);
  const displayCadence = getRollingAverage("cadence", CADENCE_ROLLING_WINDOW_MS);
  const displaySpeed = powerSensor?.speed ?? null;
  const displayGrade = powerSensor?.grade ?? null;
  const displayGear = powerSensor?.gear ?? null;
  const averagePower = average(state.history, "power");
  const averageCadence = average(state.history, "cadence");

  renderPowerbahnConnectionStatus();
  updateMetricGauge(elements.powerMetric, displayPower, POWER_GAUGE_SCALE_W);
  updateMetricGauge(elements.cadenceMetric, displayCadence, GRAPH_CADENCE_SCALE_RPM);
  updateMetricGauge(elements.speedMetric, displaySpeed, GRAPH_SPEED_SCALE_MPH);
  elements.powerValue.textContent = displayPower == null ? "-- W" : `${Math.round(displayPower)} W`;
  elements.powerAverage.textContent = powerSensor
    ? `${powerSensor.name} · 3 sec avg · raw ${formatWholeNumber(rawPower)} W`
    : "Waiting for live Powerbahn power";
  elements.cadenceValue.textContent = formatWholeUnit(displayCadence, "RPM");
  elements.cadenceAverage.textContent = displayCadence == null
    ? "1 sec avg -- RPM"
    : `1 sec avg · ride avg ${formatWholeNumber(averageCadence)} RPM`;
  elements.speedValue.textContent = displaySpeed == null ? "-- mph" : `${displaySpeed.toFixed(1)} mph`;
  elements.speedRawValue.textContent = powerSensor?.speedRaw == null ? "raw --" : `raw ${Math.round(powerSensor.speedRaw)}`;
  elements.gradeValue.textContent = displayGrade == null ? "--%" : `${displayGrade.toFixed(1)}%`;
  elements.gradeTargetValue.textContent = `target ${state.serialPower.targetGrade}%`;
  elements.gearValue.textContent = displayGear == null ? "--" : String(Math.round(displayGear));
  elements.gearTargetValue.textContent = `target ${state.serialPower.targetGear}`;
  elements.trendStatus.textContent = state.serialPower.connected ? "live" : "waiting";

  drawTrend(elements.trendCanvas, state.graphHistory);
  renderPedalAnalysis();
  renderSensors();
  renderSensorConnectStatus();
  renderPowerbahnControl();
  renderResistanceControl();
}

function updateMetricGauge(element, value, max) {
  const normalizedValue = Number.isFinite(value) ? value : 0;
  const ratio = Math.min(1, Math.max(0, normalizedValue / max));
  const angle = 180 + ratio * 180;
  const fillAngle = ratio * 180;
  element.style.setProperty("--gauge-ratio", ratio.toFixed(3));
  element.style.setProperty("--gauge-angle", `${angle.toFixed(1)}deg`);
  element.style.setProperty("--gauge-fill-angle", `${fillAngle.toFixed(1)}deg`);
}

function average(items, key) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item[key], 0) / items.length;
}

function drawTrend(canvas, history) {
  const ctx = prepareCanvas(canvas);
  const { width, height } = getCanvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  const chart = {
    left: 48,
    right: width - 16,
    top: 14,
    bottom: height - 24,
  };
  const maxPower = getGraphPowerScale(history);
  drawGrid(ctx, chart, maxPower);
  drawTrendLegend(ctx, chart, history.at(-1));
  if (history.length < 2) return;
  drawTrendSeries(ctx, chart, history, "power", maxPower, "#2d6cdf");
  drawTrendSeries(ctx, chart, history, "cadence", GRAPH_CADENCE_SCALE_RPM, "#d96c2c");
  drawTrendSeries(ctx, chart, history, "speed", GRAPH_SPEED_SCALE_MPH, "#178f62");
}

function getGraphPowerScale(history) {
  const maxPower = Math.max(120, ...history.map((sample) => sample.power));
  return Math.ceil(maxPower / 50) * 50;
}

function drawGrid(ctx, chart, maxPower) {
  ctx.strokeStyle = getCssColor("--line");
  ctx.lineWidth = 1;
  ctx.fillStyle = getCssColor("--muted");
  ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const y = chart.bottom - ratio * (chart.bottom - chart.top);
    const value = Math.round(maxPower * ratio);
    ctx.beginPath();
    ctx.moveTo(chart.left, y);
    ctx.lineTo(chart.right, y);
    ctx.stroke();
    ctx.fillText(String(value), chart.left - 8, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("W", chart.left, chart.top - 2);
}

function getCssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawTrendSeries(ctx, chart, history, key, scale, color) {
  ctx.lineWidth = key === "power" ? 3 : 2;
  ctx.strokeStyle = color;
  ctx.beginPath();
  history.forEach((sample, index) => {
    const value = Math.max(0, Math.min(scale, sample[key] ?? 0));
    const x = chart.left + (index / (history.length - 1)) * (chart.right - chart.left);
    const y = chart.bottom - (value / scale) * (chart.bottom - chart.top);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawTrendLegend(ctx, chart, latest) {
  if (!latest) return;
  const items = [
    ["#2d6cdf", `${formatWholeNumber(latest.power)} W`],
    ["#d96c2c", `${formatWholeNumber(latest.cadence)} RPM`],
    ["#178f62", `${latest.speed == null ? "--" : latest.speed.toFixed(1)} mph`],
  ];
  ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let x = chart.left + 4;
  const y = chart.top + 4;
  items.forEach(([color, label]) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 4, 10, 3);
    x += 16;
    ctx.fillText(label, x, y);
    x += ctx.measureText(label).width + 16;
  });
}

function updatePedalAnalysis(analysis) {
  if (state.pedalAnalysis && isPedalAnalysisFrozen()) {
    renderPedalAnalysis();
    return;
  }
  state.pedalAnalysis = analysis;
  renderPedalAnalysis();
}

function renderPedalAnalysis() {
  const analysis = state.pedalAnalysis;
  const frozen = Boolean(analysis && isPedalAnalysisFrozen());
  drawPedalDynamics(elements.pedalCanvas, analysis);

  if (!analysis) {
    elements.pedalStatus.textContent = frozen ? "frozen at 0 RPM" : state.serialPower.connected ? "collecting" : "waiting";
    elements.pedalBalanceValue.textContent = "-- / --";
    elements.pedalPeakValue.textContent = "--";
    elements.pedalDeadSpotValue.textContent = "--";
    elements.pedalAverageValue.textContent = "--";
    return;
  }

  elements.pedalStatus.textContent = getPedalAnalysisStatus(analysis, frozen);
  elements.pedalBalanceValue.textContent = `${Math.round(analysis.leftShare)} / ${Math.round(analysis.rightShare)}`;
  elements.pedalPeakValue.textContent = `${Math.round(analysis.peakTorque)} @ ${analysis.peakAngle}°`;
  elements.pedalDeadSpotValue.textContent = `${analysis.quietestAngle ?? analysis.splitAngle}°`;
  elements.pedalAverageValue.textContent = Math.round(analysis.averageTorque).toString();
}

function getPedalAnalysisStatus(analysis, frozen) {
  const status = analysis.complete
    ? `${analysis.referenceSource} ${analysis.splitAngle}° · rev ${analysis.rotationCount}`
    : `collecting ${analysis.rangeCount}/6`;
  return frozen ? `frozen at 0 RPM · ${status}` : status;
}

function isPedalAnalysisFrozen() {
  if (!state.serialPower.connected) return false;
  const cadence = getPedalAnalysisCadence();
  return cadence != null && cadence <= 0;
}

function getPedalAnalysisCadence() {
  const sensor = state.activeSensors[SENSOR_TYPES.power];
  if (sensor?.id === "powerbahn-usb-serial" && Number.isFinite(sensor.rawCadence)) {
    return sensor.rawCadence;
  }

  const measurement = state.lastTelemetry;
  if (Number.isFinite(measurement?.cadence)) return measurement.cadence;
  if (sensor?.id === "powerbahn-usb-serial" && Number.isFinite(sensor.cadence)) {
    return sensor.cadence;
  }
  return null;
}

function drawPedalDynamics(canvas, analysis) {
  const ctx = prepareCanvas(canvas);
  const { width, height } = getCanvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(20, Math.min(width, height) / 2 - 28);

  drawPolarGrid(ctx, centerX, centerY, radius);
  if (!analysis?.profile?.length) {
    ctx.fillStyle = getCssColor("--muted");
    ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Collecting torque profile", centerX, centerY);
    return;
  }

  const scale = Math.max(1, analysis.peakTorque);
  drawTorqueHalf(ctx, analysis.profile, analysis.splitAngle, 180, centerX, centerY, radius, scale, "rgba(45, 108, 223, 0.72)");
  drawTorqueHalf(ctx, analysis.profile, analysis.splitAngle + 180, 180, centerX, centerY, radius, scale, "rgba(217, 108, 44, 0.72)");
  drawReferenceLine(ctx, centerX, centerY, radius, analysis.splitAngle, "#2d6cdf");
  drawReferenceLine(ctx, centerX, centerY, radius, analysis.splitAngle + 180, "#d96c2c");
  drawReferenceLine(ctx, centerX, centerY, radius * 0.92, analysis.peakAngle, "#178f62");
}

function drawPolarGrid(ctx, centerX, centerY, radius) {
  ctx.strokeStyle = getCssColor("--line");
  ctx.lineWidth = 1;
  [0.33, 0.66, 1].forEach((ratio) => {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * ratio, 0, Math.PI * 2);
    ctx.stroke();
  });
  [0, 90, 180, 270].forEach((angle) => {
    const point = polarPoint(centerX, centerY, radius, angle);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  });
  ctx.fillStyle = getCssColor("--muted");
  ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  [0, 90, 180, 270].forEach((angle) => {
    const point = polarPoint(centerX, centerY, radius + 14, angle);
    ctx.fillText(`${angle}°`, point.x, point.y);
  });
}

function drawTorqueHalf(ctx, profile, startAngle, length, centerX, centerY, radius, scale, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  for (let offset = 0; offset <= length; offset += 1) {
    const angle = (startAngle + offset + 360) % 360;
    const value = profile[angle] ?? 0;
    const point = polarPoint(centerX, centerY, (value / scale) * radius, angle);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawReferenceLine(ctx, centerX, centerY, radius, angle, color) {
  const point = polarPoint(centerX, centerY, radius, angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function polarPoint(centerX, centerY, radius, angle) {
  const radians = ((angle - 90) / 180) * Math.PI;
  return {
    x: centerX + Math.cos(radians) * radius,
    y: centerY + Math.sin(radians) * radius,
  };
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

function recordSession(name) {
  const history = state.history;
  state.sessions.unshift({
    name,
    date: new Date().toLocaleString(),
    power: Math.round(average(history, "power")),
    cadence: Math.round(average(history, "cadence")),
    samples: history.length,
  });
  renderSessions();
}

function updatePowerDisplayHistory() {
  const powerSensor = getBestSensor(SENSOR_TYPES.power);
  if (!powerSensor) return;

  const sourceId = powerSensor.id;
  const now = performance.now();
  if (state.activePowerSourceId !== sourceId) {
    state.activePowerSourceId = sourceId;
    state.liveDisplayHistory = [];
    state.graphHistory = [];
    state.lastGraphSampleAt = null;
  }
  state.liveDisplayHistory.push({
    at: now,
    power: powerSensor.rawPower ?? powerSensor.value,
    cadence: getDisplayCadence(powerSensor),
  });
  trimLiveDisplayHistory(now);
}

function trimLiveDisplayHistory(now = performance.now()) {
  while (
    state.liveDisplayHistory.length > 1 &&
    now - state.liveDisplayHistory[0].at > LIVE_HISTORY_WINDOW_MS
  ) {
    state.liveDisplayHistory.shift();
  }
}

function getRollingAverage(key, windowMs) {
  const now = performance.now();
  trimLiveDisplayHistory(now);
  const values = state.liveDisplayHistory
    .filter((item) => now - item.at <= windowMs)
    .map((item) => item[key])
    .filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getDisplayCadence(powerSensor) {
  const rawPower = powerSensor.rawPower ?? powerSensor.value;
  if (rawPower == null || rawPower <= CADENCE_ACTIVE_POWER_THRESHOLD_W) return 0;
  return powerSensor.cadence ?? 0;
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
  state.pedalAnalysis = null;
  renderAll(true);

  const requestedPortName = elements.serialPortInput.value.trim();
  const baudRate = Number(elements.serialBaudSelect.value) || state.serialBaudRate;
  const flowControl = elements.serialFlowSelect.value;
  const dataTerminalReady = elements.serialDtrInput.checked;
  const requestToSend = elements.serialRtsInput.checked;
  const grantedPort = getSelectedGrantedSerialPort();
  const portHint = requestedPortName ? ` ${requestedPortName}` : "";
  setSensorConnectStatus(`Connecting to Powerbahn USB serial${portHint} at ${baudRate} baud...`, { busyType: SENSOR_TYPES.power });

  try {
    await connectSerialPower(state.serialPower, {
      port: grantedPort,
      portName: requestedPortName,
      baudRate,
      flowControl,
      dataTerminalReady,
      requestToSend,
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

async function disconnectPowerbahnSerialSensor() {
  await disconnectSerialPower(state.serialPower);
  const sensor = state.activeSensors[SENSOR_TYPES.power];
  if (sensor?.id === "powerbahn-usb-serial") {
    sensor.connected = false;
    sensor.live = false;
    sensor.value = null;
  }
  state.activePowerSourceId = null;
  state.liveDisplayHistory = [];
  state.graphHistory = [];
  state.lastGraphSampleAt = null;
  state.pedalAnalysis = null;
  setSensorConnectStatus(state.serialPower.status);
  renderAll(true);
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
  sensor.value = measurement.rawPower;
  sensor.rawPower = measurement.rawPower;
  sensor.filteredPower = measurement.filteredPower;
  sensor.rawCadence = measurement.cadence;
  sensor.cadence = measurement.rawPower > CADENCE_ACTIVE_POWER_THRESHOLD_W
    ? measurement.cadence
    : 0;
  sensor.speed = measurement.speedMph;
  sensor.speedRaw = measurement.speedRaw;
  sensor.grade = measurement.grade;
  sensor.gradeRaw = measurement.gradeRaw;
  sensor.gradeStatus = measurement.gradeStatus;
  sensor.gear = measurement.gear;
  sensor.brakeRpm = measurement.brakeRpm;
  sensor.brakeRpmStatus = measurement.brakeRpmStatus;
  sensor.crankAngle = measurement.crankAngle;
  sensor.crankAngleRaw = measurement.crankAngleRaw;
  sensor.lastSeen = new Date();
  sensor.rawPacket = measurement.rawHex;
  state.lastTelemetry = measurement;
  state.tick += 1;
  state.history.push({
    at: sensor.lastSeen,
    power: measurement.rawPower ?? 0,
    rawPower: measurement.rawPower ?? 0,
    cadence: sensor.cadence ?? 0,
    speed: measurement.speedMph ?? 0,
    grade: measurement.grade ?? 0,
    gear: measurement.gear ?? 0,
    brakeRpm: measurement.brakeRpm ?? 0,
    crankAngle: measurement.crankAngle ?? 0,
  });
  if (state.history.length > 240) state.history.shift();

  updatePowerDisplayHistory();
  updateGraphHistory();
  renderAll(true);
}

function updateGraphHistory() {
  const now = performance.now();
  if (state.lastGraphSampleAt != null && now - state.lastGraphSampleAt < LIVE_GRAPH_SAMPLE_INTERVAL_MS) {
    return;
  }

  const power = getRollingAverage("power", POWER_ROLLING_WINDOW_MS);
  if (power == null) return;
  const cadence = getRollingAverage("cadence", CADENCE_ROLLING_WINDOW_MS) ?? 0;
  const speed = state.activeSensors[SENSOR_TYPES.power]?.speed ?? 0;

  state.lastGraphSampleAt = now;
  state.graphHistory.push({
    at: new Date(),
    power,
    cadence,
    speed,
  });
  if (state.graphHistory.length > 240) state.graphHistory.shift();
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
  renderPowerbahnConnectionStatus();
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
  const baudText = ` · baud=${state.serialBaudRate}`;
  const lineText = ` · flow=${state.serialFlowControl} · DTR=${state.serialDtr ? "on" : "off"} · RTS=${state.serialRts ? "on" : "off"}`;
  const selectedPort = getSelectedGrantedSerialPort()
    ? ` · selected ${getSerialPortLabel(getSelectedGrantedSerialPort(), Number(elements.serialPortSelect.value))}`
    : "";
  const serialSuffix = state.serialPower.lastError
    ? ` · ${state.serialPower.status}`
    : state.serialPower.connected
      ? ` · ${state.serialPower.status}`
      : "";
  elements.sensorConnectStatus.textContent = `${state.sensorConnect.message} · ${requestedPort}${baudText}${lineText}${selectedPort}${serialSuffix}`;
  elements.sensorConnectStatus.classList.toggle("warning", state.sensorConnect.error);
  elements.sensorConnectStatus.classList.toggle("busy", Boolean(state.sensorConnect.busyType));
  renderPowerbahnConnectionStatus();
}

function renderSerialDebug() {
  if (!elements.serialDebugText) return;
  const { serialPower } = state;
  const measurement = serialPower.lastMeasurement;
  const lastFrameAt = serialPower.lastFrameAt
    ? serialPower.lastFrameAt.toLocaleTimeString()
    : "never";
  const parsedText = measurement
    ? [
        `parsed power=${formatWholeNumber(measurement.power)}`,
        `cadence=${formatWholeNumber(measurement.cadence)}`,
        `grade=${measurement.grade == null ? "--" : measurement.grade.toFixed(1)}`,
        `gear=${formatWholeNumber(measurement.gear)}`,
        `crank=${formatWholeNumber(measurement.crankAngle)}`,
      ].join(" ")
    : "no parsed telemetry yet";
  const rawText = serialPower.lastPacketHex
    ? `last raw ${serialPower.lastPacketHex}`
    : "no raw packet";

  elements.serialDebugText.textContent = [
    `frames ${serialPower.frameCount}`,
    `parsed ${serialPower.parsedFrameCount}`,
    `writes ${serialPower.writeCount}`,
    `bytes ${serialPower.byteCount}`,
    serialPower.portInfo ? `port ${serialPower.portInfo}` : "port unknown",
    serialPower.signals ?? "signals not set",
    serialPower.encryptionSeedHex ? `seed ${serialPower.encryptionSeedHex}` : "seed pending",
    `torque ${serialPower.torqueFrameCount ?? 0} frames`,
    getSerialFixedPowerDebugText(serialPower),
    serialPower.startupStep ? `startup ${serialPower.startupStep}` : "startup pending",
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

function formatWholeNumber(value) {
  return value == null ? "--" : String(Math.round(value));
}

function formatWholeUnit(value, unit) {
  return value == null ? `-- ${unit}` : `${Math.round(value)} ${unit}`;
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
          ${sensor.cadence == null ? "" : `<span>${Math.round(sensor.cadence)} RPM</span>`}
          ${sensor.speed == null ? "" : `<span>${sensor.speed.toFixed(1)} mph</span>`}
          ${sensor.grade == null ? "" : `<span>${sensor.grade.toFixed(1)}% grade</span>`}
          ${sensor.gear == null ? "" : `<span>gear ${Math.round(sensor.gear)}</span>`}
          ${sensor.crankAngle == null ? "" : `<span>${Math.round(sensor.crankAngle)}° crank</span>`}
          ${sensor.balance == null ? "" : `<span>${sensor.balance}% L</span>`}
          ${sensor.battery == null ? "" : `<span>${sensor.battery}% battery</span>`}
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
  elements.useSerialPowerButton.disabled = busyType === SENSOR_TYPES.power || state.serialPower.connected;
  elements.disconnectSerialPowerButton.disabled = !state.serialPower.connected;
  elements.useSerialPowerButton.textContent = busyType === SENSOR_TYPES.power
    ? "Connecting..."
    : state.serialPower.connected
      ? "Powerbahn Connected"
      : "Connect Powerbahn";
  elements.useBluetoothPowerButton.textContent = busyType === SENSOR_TYPES.power
    ? "Searching..."
    : "Search BLE Power";
  elements.useBluetoothHeartButton.textContent = busyType === SENSOR_TYPES.heartRate
    ? "Searching..."
    : "Search BLE HR";
}

function syncPowerbahnTargetControls() {
  const grade = normalizePowerbahnGrade(elements.powerbahnGradeInput.value);
  const gear = normalizePowerbahnGear(elements.powerbahnGearInput.value);
  state.serialPower.targetGrade = grade;
  state.serialPower.targetGear = gear;
  elements.powerbahnGradeInput.value = grade;
  elements.powerbahnGearInput.value = gear;
  renderPowerbahnControl();
}

function syncPowerbahnFixedPowerControls() {
  const targetPower = normalizePowerbahnFixedPower(elements.powerbahnFixedPowerInput.value);
  state.serialPower.targetFixedPower = targetPower;
  elements.powerbahnFixedPowerInput.value = targetPower;
  renderPowerbahnControl();
}

function syncPowerbahnPureLogicFixedPowerControls() {
  const targetPower = normalizePowerbahnFixedPower(elements.powerbahnPureLogicFixedPowerInput.value);
  state.serialPower.targetPureLogicFixedPower = targetPower;
  elements.powerbahnPureLogicFixedPowerInput.value = targetPower;
  renderPowerbahnControl();
}

function adjustPowerbahnGrade(delta) {
  elements.powerbahnGradeInput.value = normalizePowerbahnGrade(
    state.serialPower.targetGrade + delta,
  );
  applyPowerbahnGrade();
}

function adjustPowerbahnGear(delta) {
  elements.powerbahnGearInput.value = normalizePowerbahnGear(
    state.serialPower.targetGear + delta,
  );
  applyPowerbahnGear();
}

async function applyPowerbahnGrade() {
  const grade = normalizePowerbahnGrade(elements.powerbahnGradeInput.value);
  state.serialPower.targetGrade = grade;
  elements.powerbahnGradeInput.value = grade;
  await runPowerbahnControlAction(() => setSerialGrade(state.serialPower, grade));
}

async function applyPowerbahnGear() {
  const gear = normalizePowerbahnGear(elements.powerbahnGearInput.value);
  state.serialPower.targetGear = gear;
  elements.powerbahnGearInput.value = gear;
  await runPowerbahnControlAction(() => setSerialGear(state.serialPower, gear));
}

async function applyPowerbahnFixedPower() {
  const targetPower = normalizePowerbahnFixedPower(elements.powerbahnFixedPowerInput.value);
  const enabled = elements.powerbahnFixedPowerEnabledInput.checked;
  state.serialPower.targetFixedPower = targetPower;
  state.serialPower.fixedPowerEnabled = enabled;
  if (enabled) {
    state.serialPower.pureLogicFixedPowerEnabled = false;
    elements.powerbahnPureLogicFixedPowerEnabledInput.checked = false;
  }
  elements.powerbahnFixedPowerInput.value = targetPower;
  await runPowerbahnControlAction(async () => {
    if (enabled) {
      const pureLogicTargetPower = normalizePowerbahnFixedPower(elements.powerbahnPureLogicFixedPowerInput.value);
      await setSerialPureLogicFixedPower(state.serialPower, false, pureLogicTargetPower);
    }
    await setSerialFixedPower(
      state.serialPower,
      enabled,
      targetPower,
    );
  });
}

async function applyPowerbahnPureLogicFixedPower() {
  const targetPower = normalizePowerbahnFixedPower(elements.powerbahnPureLogicFixedPowerInput.value);
  const enabled = elements.powerbahnPureLogicFixedPowerEnabledInput.checked;
  state.serialPower.targetPureLogicFixedPower = targetPower;
  state.serialPower.pureLogicFixedPowerEnabled = enabled;
  if (enabled) {
    state.serialPower.fixedPowerEnabled = false;
    elements.powerbahnFixedPowerEnabledInput.checked = false;
  }
  elements.powerbahnPureLogicFixedPowerInput.value = targetPower;
  await runPowerbahnControlAction(async () => {
    if (enabled) {
      const directTargetPower = normalizePowerbahnFixedPower(elements.powerbahnFixedPowerInput.value);
      await setSerialFixedPower(state.serialPower, false, directTargetPower);
    }
    await setSerialPureLogicFixedPower(
      state.serialPower,
      enabled,
      targetPower,
    );
  });
}

async function resetPowerbahnResistance() {
  const targetPower = normalizePowerbahnFixedPower(elements.powerbahnFixedPowerInput.value);
  const pureLogicTargetPower = normalizePowerbahnFixedPower(elements.powerbahnPureLogicFixedPowerInput.value);
  state.serialPower.targetGrade = 0;
  state.serialPower.targetGear = 0;
  state.serialPower.targetFixedPower = targetPower;
  state.serialPower.fixedPowerEnabled = false;
  state.serialPower.targetPureLogicFixedPower = pureLogicTargetPower;
  state.serialPower.pureLogicFixedPowerEnabled = false;
  elements.powerbahnGradeInput.value = 0;
  elements.powerbahnGearInput.value = 0;
  elements.powerbahnFixedPowerInput.value = targetPower;
  elements.powerbahnFixedPowerEnabledInput.checked = false;
  elements.powerbahnPureLogicFixedPowerInput.value = pureLogicTargetPower;
  elements.powerbahnPureLogicFixedPowerEnabledInput.checked = false;
  await runPowerbahnControlAction(async () => {
    await setSerialFixedPower(state.serialPower, false, targetPower);
    await setSerialPureLogicFixedPower(state.serialPower, false, pureLogicTargetPower);
    await setSerialGrade(state.serialPower, 0);
    await setSerialGear(state.serialPower, 0);
  });
}

async function runPowerbahnControlAction(action) {
  renderPowerbahnControl();
  try {
    await action();
  } catch (error) {
    state.serialPower.lastError = error.message;
    setSensorConnectStatus(`Powerbahn control failed: ${error.message}`, { error: true });
  } finally {
    renderPowerbahnControl();
    renderSensorConnectStatus();
  }
}

function normalizePowerbahnGrade(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(25, Math.max(0, Math.round(number)));
}

function normalizePowerbahnGear(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(POWERBAHN_GEAR_MAX, Math.max(0, Math.round(number)));
}

function normalizePowerbahnFixedPower(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(POWERBAHN_FIXED_POWER_MAX, Math.max(0, Math.round(number)));
}

function renderPowerbahnConnectionStatus() {
  const { serialPower } = state;
  const isConnected = serialPower.connected;
  const hasTelemetry = serialPower.parsedFrameCount > 0;
  elements.connectionStatus.textContent = isConnected ? "Powerbahn connected" : "Powerbahn offline";
  elements.sampleCounter.textContent = hasTelemetry ? "Live ride data" : "Waiting for ride data";
  elements.powerbahnSerialStatus.textContent = serialPower.lastError
    ? `Connection error: ${serialPower.lastError}`
    : isConnected
      ? "Connected"
      : "Ready to connect";
  elements.statusDot.classList.toggle("live", isConnected && hasTelemetry);
}

function renderPowerbahnControl() {
  const { serialPower } = state;
  const activeFixedPowerText = getAppliedFixedPowerText(serialPower);
  elements.gradeTargetValue.textContent = `target ${serialPower.targetGrade}%`;
  elements.gearTargetValue.textContent = `target ${serialPower.targetGear}`;
  elements.powerbahnFixedPowerEnabledInput.checked = Boolean(serialPower.fixedPowerEnabled);
  elements.powerbahnFixedPowerInput.value = serialPower.targetFixedPower;
  elements.powerbahnFixedPowerState.textContent = activeFixedPowerText;
  elements.powerbahnPureLogicFixedPowerEnabledInput.checked = Boolean(serialPower.pureLogicFixedPowerEnabled);
  elements.powerbahnPureLogicFixedPowerInput.value = serialPower.targetPureLogicFixedPower;
  elements.powerbahnPureLogicFixedPowerState.textContent = getAppliedPureLogicFixedPowerText(serialPower);
  const unsupported = !serialPower.supported;
  const gradeGearDisabled = unsupported || serialPower.fixedPowerEnabled || serialPower.pureLogicFixedPowerEnabled;
  elements.powerbahnGradeInput.disabled = gradeGearDisabled;
  elements.powerbahnGearInput.disabled = gradeGearDisabled;
  elements.applyPowerbahnGradeButton.disabled = gradeGearDisabled;
  elements.applyPowerbahnGearButton.disabled = gradeGearDisabled;
  elements.powerbahnFixedPowerEnabledInput.disabled = unsupported;
  elements.powerbahnFixedPowerInput.disabled = unsupported;
  elements.applyPowerbahnFixedPowerButton.disabled = unsupported;
  elements.powerbahnPureLogicFixedPowerEnabledInput.disabled = unsupported;
  elements.powerbahnPureLogicFixedPowerInput.disabled = unsupported;
  elements.applyPowerbahnPureLogicFixedPowerButton.disabled = unsupported;
  elements.resetPowerbahnResistanceButton.disabled = unsupported;
  document.querySelectorAll("[data-grade-step], [data-gear-step]").forEach((button) => {
    button.disabled = gradeGearDisabled;
  });
}

function getAppliedFixedPowerText(serialPower) {
  return getAppliedPowerModeText({
    enabled: serialPower.fixedPowerEnabled,
    target: serialPower.targetFixedPower,
    active: serialPower.activeFixedPower,
  });
}

function getAppliedPureLogicFixedPowerText(serialPower) {
  return getAppliedPowerModeText({
    enabled: serialPower.pureLogicFixedPowerEnabled,
    target: serialPower.targetPureLogicFixedPower,
    active: serialPower.activePureLogicFixedPower,
  });
}

function getAppliedPowerModeText({ enabled, target, active }) {
  if (active == null) {
    return enabled
      ? `staged ${target} W`
      : "applied off";
  }
  if (!enabled || active === 0) {
    return "applied off";
  }
  if (active !== target) {
    return `applied ${active} W · pending ${target} W`;
  }
  return `applied ${active} W`;
}

function getSerialFixedPowerDebugText(serialPower) {
  if (serialPower.fixedPowerEnabled) {
    return `fixed current ${serialPower.targetFixedPower} W`;
  }
  if (serialPower.pureLogicFixedPowerEnabled) {
    return `fixed PureLogic ${serialPower.targetPureLogicFixedPower} W`;
  }
  return "fixed off";
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
        <td>${session.samples}</td>
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
