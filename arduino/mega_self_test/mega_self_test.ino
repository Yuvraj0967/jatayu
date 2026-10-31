const int pins[8] = {2, 3, 4, 5, 6, 7, 8, 9};

void setup() {
  Serial.begin(9600);
  Serial.println("JATAYU KEYPAD WIRE TEST");
}

void loop() {
  for (int i = 0; i < 8; i++) {

    // Set all keypad pins as inputs with pull-ups
    for (int j = 0; j < 8; j++) {
      pinMode(pins[j], INPUT_PULLUP);
    }

    // Drive one pin LOW
    pinMode(pins[i], OUTPUT);
    digitalWrite(pins[i], LOW);

    delay(5);

    // Check the remaining pins
    for (int j = 0; j < 8; j++) {
      if (i != j && digitalRead(pins[j]) == LOW) {
        Serial.print("Key connection detected: D");
        Serial.print(pins[i]);
        Serial.print(" and D");
        Serial.println(pins[j]);

        delay(250);
      }
    }
  }
}