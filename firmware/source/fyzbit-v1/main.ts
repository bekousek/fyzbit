/**
 * FyzBit firmware V1 — speaks the FyzBit serial protocol over USB.
 *
 * Pairs with the FyzBit web app (https://github.com/bekousek/fyzbit).
 * Build .hex in MakeCode → drag onto MICROBIT drive → open the app and connect.
 *
 * Protocol summary (newline-terminated ASCII, see spec §7):
 *
 *   ← micro:bit → PC
 *     #HELLO;v1;board=V1
 *     #CH;<id>;<NAZEV>;<UNIT>;<MIN>;<MAX>
 *     #READY
 *     #TARE;ok | #TARE;err
 *     #CAL;<id>;ok;<factor>
 *     #ERR;<text>
 *     <id>:<value>;<id>:<value>     (data row)
 *
 *   → micro:bit
 *     #HELLO?
 *     #TARE
 *     #CAL;<id>;<value>
 *     #RATE;<hz>           (1, 5, 10, 25, 50)
 *     #SELECT;<sensorName> (DS18B20, HX711, HCSR04, HX710B, DHT11)
 *     #START               (resume streaming)
 *     #STOP                (pause streaming)
 *
 * Buttons:
 *   A    = tare (only meaningful for HX711 / HX710B)
 *   B    = next sensor (cycles)
 *   A+B  = re-send handshake (#HELLO + #CH... + #READY)
 *
 * Default pins (match the fyzikalni_senzory MakeCode extension):
 *   DS18B20      P0          (data)
 *   HX711 force  P15 (DT) / P16 (SCK)
 *   HC-SR04      P1 (Trig) / P2 (Echo)
 *   HX710B press P0 (DT) / P1 (SCK)
 *   DHT11        P0          (data)
 *
 * Sensors sharing pins (DS18B20/DHT11/HX710B/HC-SR04 all touch P0 or P1) are
 * mutually exclusive at any moment — switch with button B or `#SELECT`.
 */

// === Sensor selection =====================================================

enum Sensor {
    DS18B20 = 0,
    HX711 = 1,
    HCSR04 = 2,
    HX710B = 3,
    DHT11 = 4,
}

let currentSensor: Sensor = Sensor.DS18B20

// === Runtime state ========================================================

let sampleHz = 10
let streaming = true            // start streaming as soon as we hand off to the app
let lastSampleMs = 0

// HX711 (force)
let forceOffset = 0
let forceScale = -10578
let tareForceRequested = false

// HX710B (pressure) — defaults from the fyzikalni_senzory extension
let pressOffset = -49207364
let pressScale = 581.84
let tarePressRequested = false

// HC-SR04 distance/speed memory
let lastDistanceCm = 0
let lastDistanceMs = 0

// DHT11 cache (1.5 s minimum read interval)
let dhtLastQueryMs = 0
let dhtTempC = -999
let dhtHumidity = -999

// === Serial helpers =======================================================

function send(line: string): void {
    serial.writeString(line)
    serial.writeString("\n")
}

function sendHandshake(): void {
    // control.hardwareVersion() returns 1 on V1, 2 on V2.
    const board = control.hardwareVersion() == 2 ? "V2" : "V1"
    send("#HELLO;v1;board=" + board)
    sendChannelDefinitions()
    send("#READY")
}

function sendChannelDefinitions(): void {
    if (currentSensor == Sensor.DS18B20) {
        send("#CH;t;Temperature;°C;-40;125")
    } else if (currentSensor == Sensor.HX711) {
        send("#CH;F;Force;N;-200;200")
    } else if (currentSensor == Sensor.HCSR04) {
        send("#CH;d;Distance;cm;0;400")
        send("#CH;v;Speed;m/s;-10;10")
    } else if (currentSensor == Sensor.HX710B) {
        send("#CH;p;Pressure;Pa;0;200000")
    } else if (currentSensor == Sensor.DHT11) {
        send("#CH;t;Temperature;°C;-20;60")
        send("#CH;h;Humidity;%;0;100")
    }
}

// === Sensor reads =========================================================

function readDS18B20(): void {
    const value = dstemp.celsius(DigitalPin.P0)
    send("t:" + roundTo(value, 2))
}

function pingSonarCm(trig: DigitalPin, echo: DigitalPin): number {
    pins.setPull(trig, PinPullMode.PullNone)
    pins.digitalWritePin(trig, 0)
    control.waitMicros(2)
    pins.digitalWritePin(trig, 1)
    control.waitMicros(10)
    pins.digitalWritePin(trig, 0)
    const us = pins.pulseIn(echo, PulseValue.High, 23000)
    return Math.idiv(us, 58)
}

function readHCSR04(): void {
    const cm = pingSonarCm(DigitalPin.P1, DigitalPin.P2)
    const now = control.millis()
    let speedMs = 0
    if (cm > 0 && cm < 400 && lastDistanceCm > 0) {
        const dt = (now - lastDistanceMs) / 1000
        if (dt > 0.02) {
            speedMs = (cm - lastDistanceCm) / 100 / dt
        }
    }
    if (cm > 0) {
        lastDistanceCm = cm
        lastDistanceMs = now
    }
    send("d:" + cm + ";v:" + roundTo(speedMs, 2))
}

function readHX711Force(): void {
    HX711.SetPIN_DOUT(DigitalPin.P15)
    HX711.SetPIN_SCK(DigitalPin.P16)
    HX711.begin()
    if (tareForceRequested) {
        tareForceRequested = false
        // Median of 5 reads for a clean zero.
        let s: number[] = []
        for (let i = 0; i < 5; i++) s.push(HX711.read())
        s.sort((a, b) => a - b)
        forceOffset = s[2]
    }
    // Median of 3 for stable measurement.
    const a = HX711.read()
    const b = HX711.read()
    const c = HX711.read()
    const mx = Math.max(a, Math.max(b, c))
    const mn = Math.min(a, Math.min(b, c))
    const median = a + b + c - mx - mn
    if (forceScale == 0) forceScale = 1
    const N = (median - forceOffset) / forceScale
    send("F:" + roundTo(N, 1))
}

function readHX710BPressure(): void {
    HX711.SetPIN_DOUT(DigitalPin.P0)
    HX711.SetPIN_SCK(DigitalPin.P1)
    HX711.begin()
    if (tarePressRequested) {
        tarePressRequested = false
        let s: number[] = []
        for (let i = 0; i < 5; i++) s.push(HX711.read())
        s.sort((a, b) => a - b)
        pressOffset = s[2]
    }
    const a = HX711.read()
    const b = HX711.read()
    const c = HX711.read()
    const mx = Math.max(a, Math.max(b, c))
    const mn = Math.min(a, Math.min(b, c))
    const median = a + b + c - mx - mn
    if (pressScale == 0) pressScale = 1
    const Pa = (median - pressOffset) / pressScale
    send("p:" + Math.round(Pa))
}

function readDHT11(): void {
    const now = control.millis()
    if (now - dhtLastQueryMs >= 1500) {
        dht11_dht22.queryData(DHTtype.DHT11, DigitalPin.P0, true, false, false)
        if (dht11_dht22.readDataSuccessful()) {
            dhtTempC = dht11_dht22.readData(dataType.temperature)
            dhtHumidity = dht11_dht22.readData(dataType.humidity)
        }
        dhtLastQueryMs = now
    }
    send("t:" + roundTo(dhtTempC, 1) + ";h:" + roundTo(dhtHumidity, 1))
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
    } else if (currentSensor == Sensor.DHT11) {
        readDHT11()
    }
}

// === Helpers ==============================================================

function roundTo(value: number, decimals: number): number {
    if (value < -998) return value  // sentinel pass-through (DHT11 'not yet read')
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
    if (s == Sensor.HX710B) return "HX710B"
    return "DHT11"
}

function sensorFromName(name: string): Sensor {
    if (name == "DS18B20") return Sensor.DS18B20
    if (name == "HX711") return Sensor.HX711
    if (name == "HCSR04") return Sensor.HCSR04
    if (name == "HX710B") return Sensor.HX710B
    if (name == "DHT11") return Sensor.DHT11
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
            // Reset HC-SR04 speed memory so next reading doesn't extrapolate.
            lastDistanceCm = 0
            lastDistanceMs = 0
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
            if (currentSensor == Sensor.HX711 && id == "F" && target != 0) {
                const raw = HX711.read()
                const newScale = (raw - forceOffset) / target
                if (newScale != 0) forceScale = newScale
                send("#CAL;F;ok;" + roundTo(forceScale, 3))
            } else if (currentSensor == Sensor.HX710B && id == "p" && target != 0) {
                const raw = HX711.read()
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
basic.pause(200)
sendHandshake()

serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    const data = serial.readString()
    // Some senders use \r\n; split on \n to handle batches.
    const lines = data.split("\n")
    for (let i = 0; i < lines.length; i++) {
        handleCommand(lines[i])
    }
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
    const nextS = ((currentSensor + 1) % 5) as Sensor
    currentSensor = nextS
    lastDistanceCm = 0
    lastDistanceMs = 0
    // Flash the new sensor name on the LED matrix briefly so the user knows
    // which mode the board is in without looking at the laptop.
    basic.showString(sensorName(currentSensor).charAt(0))
    sendHandshake()
})

input.onButtonPressed(Button.AB, function () {
    sendHandshake()
})

// Main loop — sample at the requested rate (best-effort; slow sensors will lag).
basic.forever(function () {
    if (!streaming) {
        basic.pause(10)
        return
    }
    const periodMs = Math.idiv(1000, sampleHz)
    const now = control.millis()
    if (now - lastSampleMs >= periodMs) {
        readAndStream()
        lastSampleMs = now
    }
    basic.pause(2)
})
