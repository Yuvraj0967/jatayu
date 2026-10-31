/*
 * JATAYU field controller for Arduino Mega 2560
 * =============================================
 *
 * Implements the laptop side of backend/jatayu/protocol.py:
 * newline-delimited JSON over USB serial at 115200 8N1.
 *
 * Mega -> laptop
 *   {"type":"hello","firmware":...,"model":...,"uptime_ms":...,"seq":...}
 *   {"type":"sensor_reading","sensor":"mq_raw","raw_adc":0..1023,...}
 *   {"type":"key_event","key":"0".."9","*","#","A".."D","seq":...}
 *   {"type":"cmd_ack","command_id":...,"status":"received|executed|failed",...}
 *
 * Laptop -> Mega
 *   {"type":"display","line1":...,"line2":...,"command_id":...}
 *   {"type":"command","command_id":...,"name":"PING|LCD_SHOW|BUZZER|REBOOT_PERIPHERALS","args":{...}}
 *
 * The laptop owns every key-to-action decision; this firmware only reports
 * presses and executes the four allowed commands. Nothing here interprets
 * the gas reading: it is raw 10-bit ADC counts, never ppm.
 *
 * ---------------------------------------------------------------------------
 * WIRING (defaults; change the pin constants below if yours differ)
 * ---------------------------------------------------------------------------
 *   16x2 LCD with PCF8574 I2C backpack
 *       SDA -> 20 (Mega SDA)      SCL -> 21 (Mega SCL)
 *       VCC -> 5V                 GND -> GND
 *       addresses probed: 0x27, 0x3F
 *
 *   4x4 matrix keypad
 *       rows -> 22, 23, 24, 25    cols -> 26, 27, 28, 29
 *       key map:  1 2 3 A
 *                 4 5 6 B
 *                 7 8 9 C
 *                 * 0 # D
 *
 *   MQ-series gas sensor (analog)
 *       VCC -> 5V   GND -> GND   AOUT -> A0
 *       The heater must be powered from 5V, never from a GPIO.
 *
 *   Active buzzer (through an NPN transistor / MOSFET, never directly)
 *       signal -> 10
 *
 *   Optional relay for REBOOT_PERIPHERALS (disabled by default)
 *       signal -> 11
 *
 * ---------------------------------------------------------------------------
 * NO EXTERNAL LIBRARIES. Only the built-in Wire library is used, so the
 * PCF8574 LCD driver below is included in this file.
 *
 * BENCH TEST WITHOUT A LAPTOP
 *   Upload, open Serial Monitor at 115200, and you should see hello +
 *   sensor readings. Pressing a keypad key prints key_event. Set
 *   DEBUG_SERIAL to 1 for human-readable traces (do NOT leave it on while
 *   the backend is attached: the backend counts non-JSON lines as rejected).
 *
 * COMPILE-TIME OPTIONS
 *   Set any ENABLE_* below to 0 if that peripheral is not fitted. With no
 *   LCD fitted, LCD_SHOW commands are answered "failed" (honest lifecycle)
 *   rather than silently pretending the text was shown.
 */

#include <Wire.h>

#define FW_VERSION        "jatayu-mega-1.0"

#define ENABLE_LCD        1     // 16x2 LCD on a PCF8574 I2C backpack
#define ENABLE_KEYPAD     1     // 4x4 matrix keypad
#define ENABLE_GAS        1     // MQ-series analog sensor on A0
#define ENABLE_BUZZER     1     // active buzzer on BUZZER_PIN
#define ENABLE_REBOOT_RELAY 0   // 1 only if a relay powers the peripherals
#define DEBUG_SERIAL      0     // 1 = human-readable log on the same port

#define SERIAL_BAUD       115200
#define MAX_LINE          512

// --- pins -------------------------------------------------------------------
static const uint8_t ROW_PINS[4] = {22, 23, 24, 25};
static const uint8_t COL_PINS[4] = {26, 27, 28, 29};
static const uint8_t GAS_PIN     = A0;
static const uint8_t BUZZER_PIN  = 10;
static const uint8_t RELAY_PIN   = 11;
static const uint8_t STATUS_LED  = 13;

#define GAS_MODEL "MQ-2"
#define RELAY_PULSE_MS 1500UL
#define BUZZER_DEFAULT_MS 300UL
#define BUZZER_MAX_MS 60000UL

// ===========================================================================
// Minimal PCF8574 -> HD44780 (4-bit) driver
// ===========================================================================
class PcfLcd {
public:
  PcfLcd() : addr_(0), ok_(false) {}

  bool begin() {
    Wire.begin();
    Wire.setClock(100000L);
    const uint8_t candidates[2] = {0x27, 0x3F};
    for (uint8_t i = 0; i < 2; i++) {
      Wire.beginTransmission(candidates[i]);
      if (Wire.endTransmission() == 0) {
        addr_ = candidates[i];
        ok_ = true;
        break;
      }
    }
    if (!ok_) return false;

    delay(60);
    // HD44780 reset into 4-bit mode.
    nibble(0x03, false); delay(5);
    nibble(0x03, false); delay(5);
    nibble(0x03, false); delay(1);
    nibble(0x02, false); delay(1);
    cmd(0x28);            // 4-bit, 2 lines, 5x8 font
    cmd(0x0C);            // display on, cursor off, blink off
    cmd(0x06);            // increment, no shift
    cmd(0x01);            // clear
    delay(3);
    return true;
  }

  bool ready() const { return ok_; }

  void show(const char* line1, const char* line2) {
    if (!ok_) return;
    cmd(0x80);
    padded(line1);
    cmd(0xC0);
    padded(line2);
  }

private:
  uint8_t addr_;
  bool ok_;
  static const uint8_t BACKLIGHT = 0x08;  // P3

  void pulse(uint8_t value) {
    Wire.beginTransmission(addr_);
    Wire.write((uint8_t)(value | 0x04));  // E high
    Wire.endTransmission();
    delayMicroseconds(2);
    Wire.beginTransmission(addr_);
    Wire.write((uint8_t)(value & ~0x04)); // E low
    Wire.endTransmission();
    delayMicroseconds(50);
  }

  void nibble(uint8_t value, bool rs) {
    uint8_t out = (uint8_t)((value & 0x0F) << 4) | BACKLIGHT | (rs ? 0x01 : 0x00);
    pulse(out);
  }

  void send(uint8_t value, bool rs) {
    nibble((uint8_t)(value >> 4), rs);
    nibble((uint8_t)(value & 0x0F), rs);
    delayMicroseconds(40);
  }

  void cmd(uint8_t value) { send(value, false); }
  void put(char c)        { send((uint8_t)c, true); }

  void padded(const char* text) {
    uint8_t written = 0;
    if (text) {
      while (text[written] && written < 16) {
        put(text[written]);
        written++;
      }
    }
    while (written < 16) {
      put(' ');
      written++;
    }
  }
};

static PcfLcd lcd;

// ===========================================================================
// Tiny JSON field extractor (the backend emits compact, flat-ish JSON)
// ===========================================================================
static const char* valueAfterKey(const char* src, const char* key) {
  if (!src || !key) return nullptr;
  char pattern[28];
  if (strlen(key) + 3 > sizeof(pattern)) return nullptr;
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* p = strstr(src, pattern);
  if (!p) return nullptr;
  p += strlen(pattern);
  while (*p == ' ' || *p == '\t') p++;
  if (*p != ':') return nullptr;
  p++;
  while (*p == ' ' || *p == '\t') p++;
  return p;
}

static bool jsonString(const char* src, const char* key, char* out, size_t outSize) {
  const char* p = valueAfterKey(src, key);
  if (!p || *p != '"') return false;
  p++;
  size_t i = 0;
  while (*p && *p != '"') {
    char c = *p++;
    if (c == '\\' && *p) {
      char e = *p++;
      switch (e) {
        case 'n': c = '\n'; break;
        case 'r': c = '\r'; break;
        case 't': c = '\t'; break;
        case 'b': c = '\b'; break;
        case 'f': c = '\f'; break;
        case 'u': {
          for (uint8_t k = 0; k < 4 && *p; k++) p++;
          c = '?';  // non-ASCII has no glyph on a 16x2 HD44780
          break;
        }
        default: c = e; break;  // \" \\ \/
      }
    }
    if (i + 1 < outSize) out[i++] = c;
  }
  out[i] = '\0';
  return true;
}

static bool jsonLong(const char* src, const char* key, long* out) {
  const char* p = valueAfterKey(src, key);
  if (!p) return false;
  bool negative = false;
  if (*p == '-') { negative = true; p++; }
  if (*p < '0' || *p > '9') return false;
  long value = 0;
  while (*p >= '0' && *p <= '9') {
    value = value * 10 + (*p - '0');
    p++;
    if (value > 100000000L) break;
  }
  *out = negative ? -value : value;
  return true;
}

static bool jsonBool(const char* src, const char* key, bool* out) {
  const char* p = valueAfterKey(src, key);
  if (!p) return false;
  if (strncmp(p, "true", 4) == 0)  { *out = true;  return true; }
  if (strncmp(p, "false", 5) == 0) { *out = false; return true; }
  return false;
}

// ===========================================================================
// Outgoing messages
// ===========================================================================
static unsigned long sequence = 0;

static void emit(const char* json) {
  Serial.println(json);
}

static void sanitize(const char* in, char* out, size_t outSize) {
  size_t i = 0;
  while (in && in[i] && i + 1 < outSize) {
    char c = in[i];
    out[i] = (c == '"' || c == '\\') ? '_' : c;
    i++;
  }
  out[i] = '\0';
}

static void sendHello() {
  char buf[192];
  snprintf(buf, sizeof(buf),
           "{\"type\":\"hello\",\"firmware\":\"%s\",\"model\":\"%s\",\"uptime_ms\":%lu,\"seq\":%lu}",
           FW_VERSION, GAS_MODEL, (unsigned long)millis(), ++sequence);
  emit(buf);
}

static void sendAck(const char* commandId, const char* status, const char* detail) {
  char id[48];
  sanitize(commandId, id, sizeof(id));
  char buf[240];
  if (detail && *detail) {
    snprintf(buf, sizeof(buf),
             "{\"type\":\"cmd_ack\",\"command_id\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\",\"seq\":%lu}",
             id, status, detail, ++sequence);
  } else {
    snprintf(buf, sizeof(buf),
             "{\"type\":\"cmd_ack\",\"command_id\":\"%s\",\"status\":\"%s\",\"seq\":%lu}",
             id, status, ++sequence);
  }
  emit(buf);
}

static void sendKey(char key) {
  char buf[96];
  snprintf(buf, sizeof(buf), "{\"type\":\"key_event\",\"key\":\"%c\",\"seq\":%lu}",
           key, ++sequence);
  emit(buf);
}

static void sendReading(int rawAdc) {
  char buf[224];
  snprintf(buf, sizeof(buf),
           "{\"type\":\"sensor_reading\",\"sensor\":\"mq_raw\",\"raw_adc\":%d,"
           "\"model\":\"%s\",\"calibration\":\"NOT_CALIBRATED\",\"unit\":\"adc_counts\","
           "\"timestamp_ms\":%lu,\"seq\":%lu}",
           rawAdc, GAS_MODEL, (unsigned long)millis(), ++sequence);
  emit(buf);
}

// ===========================================================================
// Peripherals
// ===========================================================================
static unsigned long buzzerOffAt = 0;   // 0 = no timed off
static unsigned long relayOffAt  = 0;

static void buzzerSet(bool on) {
  if (!ENABLE_BUZZER) return;
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
}

static void buzzerTimed(unsigned long ms) {
  if (ms > BUZZER_MAX_MS) ms = BUZZER_MAX_MS;
  buzzerSet(true);
  buzzerOffAt = millis() + ms;
}

static void keypadInit() {
  for (uint8_t r = 0; r < 4; r++) {
    digitalWrite(ROW_PINS[r], HIGH);
    pinMode(ROW_PINS[r], OUTPUT);
    digitalWrite(ROW_PINS[r], HIGH);
  }
  for (uint8_t c = 0; c < 4; c++) {
    pinMode(COL_PINS[c], INPUT_PULLUP);
  }
}

static char keypadScan() {
  static const char MAP[4][4] = {
    {'1', '2', '3', 'A'},
    {'4', '5', '6', 'B'},
    {'7', '8', '9', 'C'},
    {'*', '0', '#', 'D'}
  };
  for (uint8_t r = 0; r < 4; r++) {
    digitalWrite(ROW_PINS[r], LOW);
    delayMicroseconds(40);
    for (uint8_t c = 0; c < 4; c++) {
      if (digitalRead(COL_PINS[c]) == LOW) {
        digitalWrite(ROW_PINS[r], HIGH);
        return MAP[r][c];
      }
    }
    digitalWrite(ROW_PINS[r], HIGH);
  }
  return 0;
}

// ===========================================================================
// Incoming commands
// ===========================================================================
static bool showLcd(const char* line1, const char* line2) {
#if ENABLE_LCD
  if (!lcd.ready()) return false;
  lcd.show(line1, line2);
  return true;
#else
  (void)line1; (void)line2;
  return false;
#endif
}

static void handleCommand(const char* line, const char* commandId) {
  char name[24] = {0};
  if (!jsonString(line, "name", name, sizeof(name))) {
    sendAck(commandId, "failed", "missing command name");
    return;
  }

  sendAck(commandId, "received", nullptr);

  if (strcmp(name, "PING") == 0) {
    sendAck(commandId, "executed", nullptr);
    return;
  }

  if (strcmp(name, "LCD_SHOW") == 0) {
    char line1[20] = {0};
    char line2[20] = {0};
    jsonString(line, "line1", line1, sizeof(line1));
    jsonString(line, "line2", line2, sizeof(line2));
    bool shown = showLcd(line1, line2);
    sendAck(commandId, shown ? "executed" : "failed",
            shown ? nullptr : "LCD not detected");
    return;
  }

  if (strcmp(name, "BUZZER") == 0) {
    long duration = 0;
    bool active = false;
    bool haveActive = jsonBool(line, "active", &active);
    bool haveDuration = jsonLong(line, "duration_ms", &duration);
    if (haveDuration && duration > 0) {
      buzzerTimed((unsigned long)duration);
    } else if (haveActive) {
      buzzerOffAt = 0;
      buzzerSet(active);
    } else {
      buzzerTimed(BUZZER_DEFAULT_MS);
    }
    sendAck(commandId, "executed", nullptr);
    return;
  }

  if (strcmp(name, "REBOOT_PERIPHERALS") == 0) {
#if ENABLE_REBOOT_RELAY
    digitalWrite(RELAY_PIN, HIGH);
    relayOffAt = millis() + RELAY_PULSE_MS;
    sendAck(commandId, "executed", nullptr);
#else
    sendAck(commandId, "failed", "relay not configured");
#endif
    return;
  }

  sendAck(commandId, "failed", "unknown command");
}

static void handleLine(char* line) {
  char type[16] = {0};
  if (!jsonString(line, "type", type, sizeof(type))) return;

  char commandId[48] = {0};
  bool hasId = jsonString(line, "command_id", commandId, sizeof(commandId));

  if (strcmp(type, "display") == 0) {
    char line1[20] = {0};
    char line2[20] = {0};
    jsonString(line, "line1", line1, sizeof(line1));
    jsonString(line, "line2", line2, sizeof(line2));
    if (hasId) sendAck(commandId, "received", nullptr);
    bool shown = showLcd(line1, line2);
    if (hasId) {
      sendAck(commandId, shown ? "executed" : "failed",
              shown ? nullptr : "LCD not detected");
    }
    return;
  }

  if (strcmp(type, "command") == 0) {
    if (!hasId) return;  // cannot acknowledge what we cannot identify
    handleCommand(line, commandId);
  }
}

// ===========================================================================
// Main loop
// ===========================================================================
static char lineBuffer[MAX_LINE];
static size_t lineLength = 0;

static void pollSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      lineBuffer[lineLength] = '\0';
      if (lineLength > 0) handleLine(lineBuffer);
      lineLength = 0;
    } else if (c != '\r') {
      if (lineLength + 1 < sizeof(lineBuffer)) {
        lineBuffer[lineLength++] = c;
      } else {
        lineLength = 0;  // oversized line: drop and resynchronise at next \n
      }
    }
  }
}

void setup() {
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

#if ENABLE_BUZZER
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
#endif
#if ENABLE_REBOOT_RELAY
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
#endif

  Serial.begin(SERIAL_BAUD);

#if ENABLE_KEYPAD
  keypadInit();
#endif

#if ENABLE_LCD
  lcd.begin();
  if (lcd.ready()) {
    lcd.show("JATAYU", "MEGA READY");
  }
#endif

  sendHello();

#if DEBUG_SERIAL
  Serial.println("JATAYU Mega controller ready");
#endif
}

void loop() {
  pollSerial();

#if ENABLE_KEYPAD
  static unsigned long lastScan = 0;
  static char candidate = 0;
  static char reported = 0;
  static uint8_t stableCount = 0;

  if (millis() - lastScan >= 15) {
    lastScan = millis();
    char key = keypadScan();
    if (key == candidate) {
      if (stableCount < 255) stableCount++;
    } else {
      candidate = key;
      stableCount = 0;
    }
    if (stableCount >= 2) {
      if (candidate && candidate != reported) {
        sendKey(candidate);
        reported = candidate;
      } else if (!candidate) {
        reported = 0;
      }
    }
  }
#endif

#if ENABLE_GAS
  static unsigned long lastReading = 0;
  if (millis() - lastReading >= 1000) {
    lastReading = millis();
    sendReading(analogRead(GAS_PIN));
  }
#endif

  static unsigned long lastHello = 0;
  if (millis() - lastHello >= 10000) {
    lastHello = millis();
    sendHello();  // lets a backend started later discover the Mega
  }

  if (buzzerOffAt && millis() >= buzzerOffAt) {
    buzzerOffAt = 0;
    buzzerSet(false);
  }
  if (relayOffAt && millis() >= relayOffAt) {
    relayOffAt = 0;
    digitalWrite(RELAY_PIN, LOW);
  }

  static unsigned long lastBlink = 0;
  static bool ledOn = false;
  if (millis() - lastBlink >= 500) {
    lastBlink = millis();
    ledOn = !ledOn;
    digitalWrite(STATUS_LED, ledOn ? HIGH : LOW);
  }
}
