/*
 * JATAYU Arduino UNO: MQ-135 raw reading and 4x4 keypad over USB serial.
 *
 * Sends one JSON object per line at 115200 baud (see backend/jatayu/protocol.py).
 * The Pi owns all decisions: this sketch only reports what it reads.
 * MQ-135 values are raw ADC counts (0-1023), never ppm.
 *
 * Wiring:  MQ-135 VCC -> 5V, GND -> GND, AO -> A0 (DO not connected).
 *          Keypad ribbon wires 1-8 -> D2-D9. No external power.
 *
 * Which wires are rows is not yet verified. The earlier test only connected a
 * wire from D2-D5 to one from D6-D9, which fits ROW_PINS/COL_PINS below. Every
 * key_event carries its row and column ("r", "c"), so a wrong entry in KEYS can
 * be spotted and corrected.
 */

const uint8_t MQ_PIN = A0;
const uint8_t ROW_PINS[4] = {2, 3, 4, 5};
const uint8_t COL_PINS[4] = {6, 7, 8, 9};
const char KEYS[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};

const unsigned long SENSOR_INTERVAL_MS = 1000;
const unsigned long DEBOUNCE_MS = 30;
const uint8_t SENSOR_SAMPLES = 8;
const uint8_t LINE_MAX = 160;  // the UNO has only 2 KB of SRAM

unsigned long lastSensorMs = 0;
int8_t stableRow = -1, stableCol = -1, candidateRow = -1, candidateCol = -1;
unsigned long candidateSinceMs = 0;
char line[LINE_MAX];
uint8_t lineLength = 0;
bool lineOverflow = false;

void sendSensorReading() {
  long total = 0;
  for (uint8_t i = 0; i < SENSOR_SAMPLES; i++) {
    total += analogRead(MQ_PIN);
  }
  int raw = total / SENSOR_SAMPLES;
  // Stuck at either end of the range usually means a wiring fault.
  bool atRail = raw <= 2 || raw >= 1021;
  Serial.print(F("{\"type\":\"sensor_reading\",\"sensor\":\"mq_raw\",\"model\":\"MQ-135\",\"raw_adc\":"));
  Serial.print(raw);
  Serial.print(F(",\"calibration\":\"NOT_CALIBRATED\",\"sensor_status\":\""));
  Serial.print(atRail ? F("at_rail") : F("ok"));
  Serial.print(F("\",\"timestamp_ms\":"));
  Serial.print(millis());
  Serial.println('}');
}

void scanKeypad(unsigned long now) {
  int8_t foundRow = -1, foundCol = -1;
  for (uint8_t row = 0; row < 4 && foundRow < 0; row++) {
    pinMode(ROW_PINS[row], OUTPUT);
    digitalWrite(ROW_PINS[row], LOW);
    delayMicroseconds(10);
    for (uint8_t col = 0; col < 4; col++) {
      if (digitalRead(COL_PINS[col]) == LOW) {
        foundRow = row;
        foundCol = col;
        break;
      }
    }
    pinMode(ROW_PINS[row], INPUT_PULLUP);
  }

  if (foundRow != candidateRow || foundCol != candidateCol) {
    candidateRow = foundRow;
    candidateCol = foundCol;
    candidateSinceMs = now;
    return;
  }
  if (now - candidateSinceMs < DEBOUNCE_MS || (foundRow == stableRow && foundCol == stableCol)) {
    return;
  }
  stableRow = foundRow;
  stableCol = foundCol;
  if (stableRow >= 0) {  // one event per press, none on release
    Serial.print(F("{\"type\":\"key_event\",\"key\":\""));
    Serial.print(KEYS[stableRow][stableCol]);
    Serial.print(F("\",\"r\":"));
    Serial.print(stableRow);
    Serial.print(F(",\"c\":"));
    Serial.print(stableCol);
    Serial.println('}');
  }
}

void sendAck(const char *commandId, const __FlashStringHelper *status, const __FlashStringHelper *detail) {
  Serial.print(F("{\"type\":\"cmd_ack\",\"command_id\":\""));
  Serial.print(commandId);
  Serial.print(F("\",\"status\":\""));
  Serial.print(status);
  Serial.print('"');
  if (detail != NULL) {
    Serial.print(F(",\"detail\":\""));
    Serial.print(detail);
    Serial.print('"');
  }
  Serial.println('}');
}

// Finds "key":"value" in the line and cuts the line after the value.
const char *findValue(char *text, const char *key) {
  char *start = strstr(text, key);
  if (start == NULL) {
    return NULL;
  }
  start += strlen(key);
  char *end = strchr(start, '"');
  if (end == NULL) {
    return NULL;
  }
  *end = '\0';
  return start;
}

void handleLine(char *text) {
  // Name first: it may come after the id, and findValue cuts the text.
  bool isPing = strstr(text, "\"name\":\"PING\"") != NULL;
  const char *commandId = findValue(text, "\"command_id\":\"");
  if (commandId == NULL) {
    return;  // display messages and anything else need no reply
  }
  sendAck(commandId, F("received"), NULL);
  if (isPing) {
    sendAck(commandId, F("executed"), NULL);
  } else {
    sendAck(commandId, F("failed"), F("not supported on this board"));
  }
}

void readCommands() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      if (!lineOverflow) {
        line[lineLength] = '\0';
        handleLine(line);
      }
      lineLength = 0;
      lineOverflow = false;
    } else if (lineLength < LINE_MAX - 1) {
      line[lineLength++] = c;
    } else {
      lineOverflow = true;
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(MQ_PIN, INPUT);
  for (uint8_t i = 0; i < 4; i++) {
    pinMode(ROW_PINS[i], INPUT_PULLUP);
    pinMode(COL_PINS[i], INPUT_PULLUP);
  }
  Serial.println(F("{\"type\":\"hello\",\"firmware\":\"jatayu-uno-1.0\",\"model\":\"MQ-135\",\"lcd\":false}"));
}

void loop() {
  unsigned long now = millis();
  readCommands();
  scanKeypad(now);
  if (now - lastSensorMs >= SENSOR_INTERVAL_MS) {
    lastSensorMs = now;
    sendSensorReading();
  }
}
