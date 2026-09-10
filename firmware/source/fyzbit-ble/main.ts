/**
 * FyzBit firmware V2 — speaks the FyzBit serial protocol over USB *and*
 * Bluetooth (Nordic UART Service). Same protocol/sensors as fyzbit-v1;
 * this variant additionally mirrors every line to BLE UART and accepts
 * commands from either transport. V2-only — V1 doesn't have the flash/RAM
 * headroom for the sensor drivers plus the full Bluetooth stack.
 *
 * Pairs with the FyzBit web app (https://github.com/bekousek/fyzbit).
 * No pairing/bonding required (open Bluetooth UART) — connect straight from
 * the app's "Bluetooth" option.
 *
 * Protocol summary (newline-terminated ASCII, see spec §7):
 *
 *   ← micro:bit → PC
 *     #HELLO;v1;board=V2;sensor=<name>
 *     #CH;<id>;<NAZEV>;<UNIT>;<MIN>;<MAX>
 *     #READY
 *     #TARE;ok | #TARE;err
 *     #CAL;<id>;ok;<factor>
 *     #ERR;<text>
 *     <id>:<value>[;<id>:<value>]    (data row)
 *
 *   → micro:bit
 *     #HELLO?
 *     #TARE
 *     #CAL;<id>;<value>
 *     #RATE;<hz>           (1, 5, 10, 25, 50)
 *     #SELECT;<sensorName> (DS18B20, HX711, HCSR04, HX710B)
 *     #START               (resume streaming)
 *     #STOP                (pause streaming)
 *
 * Buttons:
 *   A    = tare (only meaningful for HX711 / HX710B)
 *   B    = next sensor (cycles)
 *   A+B  = re-send handshake (#HELLO + #CH... + #READY)
 *
 * Pins — every sensor lives on P0/P1/P2:
 *   DS18B20      P0          (data)
 *   HX711 force  P0 (DT)   / P1 (SCK)
 *   HC-SR04      P1 (Trig) / P2 (Echo)
 *   HX710B press P0 (OUT)  / P1 (SCK)
 *
 * Only P0, P1, P2, 3V and GND have the wide pads with the 4 mm hole that a
 * crocodile clip can grip; P3-P16 are 1 mm strips that need a breakout board.
 * The load cell used to sit on P15/P16, where the fyzikalni_senzory extension
 * puts it, and could not be wired at all without one — so it moved onto the
 * pressure module's pads: same chip, same two wires, same clips.
 *
 * Every sensor therefore overlaps every other one, which costs nothing: only
 * one is ever plugged in. Switch with button B or `#SELECT`.
 */

// === Sensor selection =====================================================

enum Sensor {
    DS18B20 = 0,
    HX711 = 1,
    HCSR04 = 2,
    HX710B = 3,
}

let currentSensor: Sensor = Sensor.DS18B20

// === Pins =================================================================

// Both HX711-family modules — the load cell and the pressure sensor — are the
// same converter reached over the same two wires, so they share one pair of
// pads. See the header for why those pads have to be P0/P1.
const HX_DOUT = DigitalPin.P0
const HX_SCK = DigitalPin.P1

// === Runtime state ========================================================

let sampleHz = 10
let streaming = true            // start streaming as soon as we hand off to the app

// DS18B20 — celsius() only ever says -Infinity; the reason for a failed read
// arrives separately, through the driver's error callback.
let tempErrorMsg = ""
let tempErrorCode = 0
let tempErrorReported = false
let tempErrorMs = 0

/**
 * How long to give the converter to pull DOUT low before giving up on it.
 * An HX711 strapped for 10 SPS answers every 100 ms, so this is one full
 * period plus margin; only a missing module ever waits the whole time.
 */
const HX_READY_TIMEOUT_MS = 150

// HX711 (force)
let hxErrorReported = false
let hxErrorMs = 0
let forceOffset = 0
let forceScale = -10578
let tareForceRequested = false

// HX710B (pressure) — scale from the fyzikalni_senzory extension; its offset
// carried the +2^23 that hxRead() now takes off, so it moves with it.
let pressOffset = -57595972
let pressScale = 581.84
let tarePressRequested = false

// === Serial + Bluetooth UART helpers ======================================

function send(line: string): void {
    serial.writeString(line)
    serial.writeString("\n")
    bluetooth.uartWriteString(line + "\n")
}

function sendHandshake(): void {
    // control.hardwareVersion() returns "1" on V1, "2" on V2 (string, not number).
    const board = control.hardwareVersion() == "2" ? "V2" : "V1"
    send("#HELLO;v1;board=" + board + ";sensor=" + sensorName(currentSensor))
    sendChannelDefinitions()
    send("#READY")
}

// ASCII only on the wire: MakeCode's compiler replaces non-ASCII characters in
// string literals with '?', so a literal "°C" reaches the app as "?C". The
// unit is sent as "degC" and the app maps it back — see normalizeUnit() in
// src/units/units.ts, which also still repairs "?C" from older builds.
function sendChannelDefinitions(): void {
    if (currentSensor == Sensor.DS18B20) {
        send("#CH;t;Temperature;degC;-40;125")
    } else if (currentSensor == Sensor.HX711) {
        send("#CH;F;Force;N;-200;200")
    } else if (currentSensor == Sensor.HCSR04) {
        send("#CH;d;Distance;cm;0;400")
    } else if (currentSensor == Sensor.HX710B) {
        send("#CH;p;Pressure;Pa;0;200000")
    }
}

// === Sensor reads =========================================================

/**
 * One temperature sample — or a #ERR saying why there is none.
 *
 * dstemp.celsius() answers -Infinity for every kind of failure. Passing that on
 * is worse than useless: MakeCode renders it as the literal string "-Infinity",
 * the app cannot read a number out of the row and drops it, so a probe that
 * never reads looks exactly like a working one with nothing to say.
 *
 * The retries are for Bluetooth. The driver bit-bangs 1-Wire with cycle-counted
 * busy waits and never masks interrupts, and a read slot has to be sampled
 * within 15 us of pulling the line low. Once a BLE connection exists the
 * SoftDevice takes the radio every connection interval at the highest priority
 * and walks straight through that window; merely advertising, which is the
 * board's state on the USB cable, leaves long quiet gaps. Pausing between
 * attempts lets a radio event land between two reads rather than inside one.
 */
function readDS18B20(): void {
    for (let attempt = 0; attempt < 3; attempt++) {
        tempErrorMsg = ""
        const value = dstemp.celsius(DigitalPin.P0)
        // Anything above -300 is a real reading: the sentinel is -Infinity, and
        // -300 C is below absolute zero anyway. (The driver's own advice.)
        if (value > -300) {
            tempErrorReported = false
            send("t:" + roundTo(value, 2))
            return
        }
        basic.pause(15)
    }
    reportTempError()
}

/**
 * Say the probe cannot be read — but not once per sample. The app turns #ERR
 * into a toast, and a toast every second is noise rather than information.
 */
function reportTempError(): void {
    const now = control.millis()
    if (tempErrorReported && now - tempErrorMs < 5000) return
    tempErrorReported = true
    tempErrorMs = now
    const why = tempErrorMsg == "" ? "read failed" : tempErrorMsg
    send("#ERR;DS18B20: " + why + " (" + tempErrorCode + ")")
}

function pingSonarCm(trig: DigitalPin, echo: DigitalPin): number {
    pins.setPull(trig, PinPullMode.PullNone)
    pins.digitalWritePin(trig, 0)
    control.waitMicros(2)
    pins.digitalWritePin(trig, 1)
    control.waitMicros(10)
    pins.digitalWritePin(trig, 0)
    const us = pins.pulseIn(echo, PulseValue.High, 23000)
    // 58 us per centimetre, kept as a fraction. Rounding to whole centimetres
    // here used to cost far more than it saved: the app differentiates this
    // signal for speed and acceleration, and a 1 cm step is a much larger
    // error in those than the sensor's own ~3 mm accuracy.
    return us / 58
}

function readHCSR04(): void {
    const cm = pingSonarCm(DigitalPin.P1, DigitalPin.P2)
    // pulseIn returns 0 when no echo came back inside the timeout: out of
    // range, or an angled or soft target. Reporting that as "0 cm" would put a
    // step into the distance and a far bigger one into the speed derived from
    // it, so send nothing and let the app see a gap in time instead.
    if (cm <= 0 || cm > 400) return
    // Speed and acceleration are the app's job (src/state/derive.ts): it has
    // the whole series and can fit a curve through it, where the firmware
    // could only ever subtract two neighbouring samples.
    send("d:" + roundTo(cm, 1))
}

/**
 * Point the driver at the pads and start a conversion.
 *
 * Both load-cell sensors go through the one driver, which keeps its pins in
 * globals, so no read may assume the previous caller left them the way it
 * needs them.
 */
function hxBegin(): boolean {
    HX711.SetPIN_DOUT(HX_DOUT)
    HX711.SetPIN_SCK(HX_SCK)
    // Nothing below this line may run without a converter answering: both
    // HX711.begin() (set_gain ends in a read) and HX711.read() open with
    // wait_ready(0), which is an unbounded `while (!is_ready())`. The
    // extension says so itself — "will halt the sketch until a load cell is
    // connected" — and is_ready() means nothing more than "DOUT is low".
    if (!HX711.wait_ready_timeout(HX_READY_TIMEOUT_MS, 1)) return false
    HX711.begin()
    return true
}

/**
 * Say the converter is not answering — throttled, like the probe's own error.
 *
 * This is what a board switched to force or pressure mode with no HX711 on the
 * pads does now. Before the load cell moved onto P0 it would hang on a floating
 * pin, which at least sometimes read low by accident; P0 is shared with the
 * DS18B20's data line, and a 4.7k pull-up holds that hard high, so the sampling
 * loop stopped for good — no data on any transport, and only the RESET button
 * got it back, because the stuck fiber never looks at currentSensor again.
 */
function reportHxMissing(id: string): void {
    const now = control.millis()
    if (hxErrorReported && now - hxErrorMs < 5000) return
    hxErrorReported = true
    hxErrorMs = now
    send("#ERR;" + id + ": no HX711 on P0/P1")
}

/**
 * One ADC sample, in honest 24-bit two's-complement counts.
 *
 * The HX711 extension does not hand those over: it sign-extends the reading to
 * 32 bits and *then* flips the sign bit, so what comes back is raw + 2^23 for a
 * non-negative sample and raw - 2^23 for a negative one. A constant offset
 * would be harmless — tare and calibration absorb it — but this one changes
 * sign with the reading, so the value jumps by 2^24 counts the moment a
 * measurement crosses the ADC's electrical zero: about 29 kPa on the pressure
 * module, about 1600 N on the load cell. Undo it once, here, and everything
 * downstream (tare, calibration, the reads below) works on a continuous scale.
 */
function hxRead(): number {
    const v = HX711.read()
    return v >= 0 ? v - 8388608 : v + 8388608
}

/** Median of 5 samples — a clean zero, immune to a single noisy read. */
function hxMedian5(): number {
    let s: number[] = []
    for (let i = 0; i < 5; i++) s.push(hxRead())
    s.sort((a, b) => a - b)
    return s[2]
}

/**
 * Zero whichever load-cell sensor asked for it.
 *
 * Called from the sampling loop rather than straight from the #TARE handler:
 * the loop is the only owner of the HX711's bit-banged bus, and taring from
 * the serial handler's fiber could interleave two reads. The loop runs it
 * whether or not it is streaming, because zeroing a sensor is exactly what you
 * want to do *before* starting a measurement.
 */
function applyPendingTare(): void {
    if (tareForceRequested) {
        tareForceRequested = false
        if (hxBegin()) forceOffset = hxMedian5()
        else reportHxMissing("F")
    }
    if (tarePressRequested) {
        tarePressRequested = false
        if (hxBegin()) pressOffset = hxMedian5()
        else reportHxMissing("p")
    }
}

function readHX711Force(): void {
    if (!hxBegin()) {
        reportHxMissing("F")
        return
    }
    hxErrorReported = false
    // Median of 3 for stable measurement.
    const a = hxRead()
    const b = hxRead()
    const c = hxRead()
    const mx = Math.max(a, Math.max(b, c))
    const mn = Math.min(a, Math.min(b, c))
    const median = a + b + c - mx - mn
    if (forceScale == 0) forceScale = 1
    const N = (median - forceOffset) / forceScale
    send("F:" + roundTo(N, 1))
}

function readHX710BPressure(): void {
    if (!hxBegin()) {
        reportHxMissing("p")
        return
    }
    hxErrorReported = false
    const a = hxRead()
    const b = hxRead()
    const c = hxRead()
    const mx = Math.max(a, Math.max(b, c))
    const mn = Math.min(a, Math.min(b, c))
    const median = a + b + c - mx - mn
    if (pressScale == 0) pressScale = 1
    const Pa = (median - pressOffset) / pressScale
    send("p:" + Math.round(Pa))
}

function readAndStream(): void {
    if (currentSensor == Sensor.DS18B20) {
        readDS18B20()
    } else if (currentSensor == Sensor.HX711) {
        readHX711Force()
    } else if (currentSensor == Sensor.HCSR04) {
        readHCSR04()
    } else if (currentSensor == Sensor.HX710B) {
        readHX710BPressure()
    }
}

// === Helpers ==============================================================

function roundTo(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals)
    return Math.round(value * factor) / factor
}

// MakeCode lacks String.prototype.trim — implement minimally.
function trim(s: string): string {
    let start = 0
    let end = s.length
    while (start < end && (s.charAt(start) == " " || s.charAt(start) == "\r" || s.charAt(start) == "\n" || s.charAt(start) == "\t")) start++
    while (end > start && (s.charAt(end - 1) == " " || s.charAt(end - 1) == "\r" || s.charAt(end - 1) == "\n" || s.charAt(end - 1) == "\t")) end--
    return s.substr(start, end - start)
}

function sensorName(s: Sensor): string {
    if (s == Sensor.DS18B20) return "DS18B20"
    if (s == Sensor.HX711) return "HX711"
    if (s == Sensor.HCSR04) return "HCSR04"
    return "HX710B"
}

/**
 * One letter for the LED matrix. Deliberately not the first letter of the
 * sensor's name: three of the four are called H-something, so the display said
 * nothing about which of them had been picked. These are the quantities —
 * temperature, force, distance, pressure.
 */
function sensorLetter(s: Sensor): string {
    if (s == Sensor.DS18B20) return "T"
    if (s == Sensor.HX711) return "F"
    if (s == Sensor.HCSR04) return "D"
    return "P"
}

function sensorFromName(name: string): Sensor {
    if (name == "DS18B20") return Sensor.DS18B20
    if (name == "HX711") return Sensor.HX711
    if (name == "HCSR04") return Sensor.HCSR04
    if (name == "HX710B") return Sensor.HX710B
    return currentSensor
}

// === Command parsing ======================================================

function handleCommand(rawLine: string): void {
    const cmd = trim(rawLine)
    if (cmd.length == 0) return

    if (cmd == "#HELLO?") {
        sendHandshake()
        return
    }
    if (cmd == "#START") {
        streaming = true
        return
    }
    if (cmd == "#STOP") {
        streaming = false
        return
    }
    if (cmd == "#TARE") {
        if (currentSensor == Sensor.HX711) tareForceRequested = true
        else if (currentSensor == Sensor.HX710B) tarePressRequested = true
        send("#TARE;ok")
        return
    }
    if (cmd.indexOf("#RATE;") == 0) {
        const hzText = cmd.substr(6)
        const hz = parseInt(hzText)
        if (hz == 1 || hz == 5 || hz == 10 || hz == 25 || hz == 50) {
            sampleHz = hz
        }
        return
    }
    if (cmd.indexOf("#SELECT;") == 0) {
        const name = cmd.substr(8)
        const next = sensorFromName(name)
        if (next != currentSensor) {
            currentSensor = next
            sendHandshake()
        }
        return
    }
    if (cmd.indexOf("#CAL;") == 0) {
        // Format: #CAL;<id>;<value>
        const parts = cmd.split(";")
        if (parts.length >= 3) {
            const id = parts[1]
            const target = parseFloat(parts[2])
            // For HX711 / HX710B we can compute a new scale factor from current
            // raw reading. For other sensors there's no app-side calibration yet.
            // hxBegin() first, and not only for the pins: this runs in the
            // command handler's fiber, so an unguarded read would wedge the
            // one thing still able to talk to a hung board.
            if (currentSensor == Sensor.HX711 && id == "F" && target != 0) {
                if (!hxBegin()) {
                    send("#CAL;F;err")
                    return
                }
                const raw = hxRead()
                const newScale = (raw - forceOffset) / target
                if (newScale != 0) forceScale = newScale
                send("#CAL;F;ok;" + roundTo(forceScale, 3))
            } else if (currentSensor == Sensor.HX710B && id == "p" && target != 0) {
                if (!hxBegin()) {
                    send("#CAL;p;err")
                    return
                }
                const raw = hxRead()
                const newScale = (raw - pressOffset) / target
                if (newScale != 0) pressScale = newScale
                send("#CAL;p;ok;" + roundTo(pressScale, 3))
            } else {
                // Acknowledge as a no-op so the app's wizard doesn't time out.
                send("#CAL;" + id + ";ok;1.0")
            }
        }
        return
    }
    // Unknown — reply ERR so the app can surface it.
    send("#ERR;unknown_cmd:" + cmd)
}

// === Boot =================================================================

serial.redirectToUSB()
serial.setRxBufferSize(64)
bluetooth.startUartService()
basic.pause(200)
sendHandshake()

// celsius() cannot say more than "-Infinity"; this is where the reason comes
// from. Codes: 1 not connected, 2 start error, 3 read timeout, 4 conversion
// failure.
dstemp.sensorError(function (errorMessage: string, errorCode: number, port: number) {
    tempErrorMsg = errorMessage
    tempErrorCode = errorCode
})

serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    // readUntil (not readString) so a command that straddles two buffer
    // fills can't get sliced in half at the receive boundary.
    const line = serial.readUntil(serial.delimiters(Delimiters.NewLine))
    handleCommand(line)
})

bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    const line = bluetooth.uartReadUntil(serial.delimiters(Delimiters.NewLine))
    handleCommand(line)
})

// A newly-connected central (the FyzBit app) hasn't seen the boot-time
// handshake, so resend it — mirrors what #HELLO? does on demand.
bluetooth.onBluetoothConnected(function () {
    basic.showIcon(IconNames.Yes)
    sendHandshake()
})

bluetooth.onBluetoothDisconnected(function () {
    basic.showIcon(IconNames.No)
    basic.pause(300)
    basic.clearScreen()
})

input.onButtonPressed(Button.A, function () {
    if (currentSensor == Sensor.HX711) {
        tareForceRequested = true
    } else if (currentSensor == Sensor.HX710B) {
        tarePressRequested = true
    }
    send("#TARE;ok")
})

input.onButtonPressed(Button.B, function () {
    const nextS = ((currentSensor + 1) % 4) as Sensor
    currentSensor = nextS
    // Flash the new sensor on the LED matrix briefly so the user knows which
    // mode the board is in without looking at the laptop.
    basic.showString(sensorLetter(currentSensor))
    sendHandshake()
})

input.onButtonPressed(Button.AB, function () {
    sendHandshake()
})

// Main loop — sample at the requested rate (best-effort; slow sensors will lag).
//
// Deliberately control.inBackground and not basic.forever: forever sleeps a
// fixed 20 ms after every iteration, which caps the whole loop at well under
// the 50 Hz the sonar is asked for. Pacing by hand also subtracts the time the
// read itself took, so a slow sensor eats into the pause rather than adding to
// the period.
control.inBackground(function () {
    while (true) {
        applyPendingTare()
        if (!streaming) {
            basic.pause(20)
        } else {
            const started = control.millis()
            readAndStream()
            const periodMs = Math.idiv(1000, sampleHz)
            const elapsed = control.millis() - started
            // Always yield at least 1 ms, or serial, Bluetooth and the button
            // handlers never get scheduled.
            basic.pause(Math.max(1, periodMs - elapsed))
        }
    }
})
