#include <ESP8266WiFi.h>
#include <ESPAsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Adafruit_AHTX0.h>
#include <LittleFS.h>
#include <vector>
#include <limits.h>

// WiFi credentials
const char* ssid = "SSID";
const char* password = "VeryStrongPassword";

// Pin definitions
const int HEATER_PIN = D6;
const int PWM_FREQUENCY = 1000;
const int PWM_RANGE = 1023;

// AHT20 sensor
Adafruit_AHTX0 aht;

// Web server
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// Control variables
float targetTemp = 0.0;
float currentTemp = 0.0;
float currentHumidity = 0.0;
int heaterPower = 0;
bool heaterActive = false;
unsigned long lastSensorRead = 0;
unsigned long lastControlUpdate = 0;
unsigned long dryingStartTime = 0;
unsigned long dryingDuration = 0; // in milliseconds
bool dryingActive = false;

// Global variables for heater control
float Kp = 60.0;   // Proportional gain (reduced from 10.0)
float Ki = 0.04;   // Integral gain (reduced from 0.1)
float Kd = 20.0;    // Derivative gain (reduced from 5.0)
float integral = 0.0;
float lastError = 0.0;
unsigned long lastControlTime = 0;
const int controlInterval = 1000; // 1 second control loop

// Filament profiles
struct FilamentProfile {
  String name;
  float temperature;
  unsigned long duration; // in minutes
};

std::vector<FilamentProfile> profiles = {
  {"PLA", 45.0, 240},      // 45°C for 4 hours
  {"PETG", 65.0, 240},     // 65°C for 4 hours
  {"ABS/ASA", 70.0, 300},  // 70°C for 5 hours
  {"Nylon", 75.0, 360},    // 75°C for 6 hours
  {"TPU", 50.0, 240}       // 50°C for 4 hours
};

// Add this function to your Arduino code to help debug the profiles endpoint
void setupDebugRoutes() {
  // Route for testing if the server is alive
  server.on("/ping", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "text/plain", "pong");
  });
  
  // Route for getting raw profiles JSON for debugging
  server.on("/debug/profiles", HTTP_GET, [](AsyncWebServerRequest *request) {
    String profilesJson = getProfilesJson();
    request->send(200, "application/json", profilesJson);
  });
  
  // Route for getting raw status JSON for debugging
  server.on("/debug/status", HTTP_GET, [](AsyncWebServerRequest *request) {
    String status = getStatusJson();
    request->send(200, "application/json", status);
  });
}

void setup() {
  Serial.begin(115200);
  
  // Initialize heater pin as PWM output
  pinMode(HEATER_PIN, OUTPUT);
  analogWriteFreq(PWM_FREQUENCY);
  analogWriteRange(PWM_RANGE);
  analogWrite(HEATER_PIN, 0); // Start with heater off
  
  // Initialize AHT20 sensor
  if (!aht.begin()) {
    Serial.println("Could not find AHT sensor. Check wiring!");
    while (1) delay(10);
  }
  
  // Initialize file system
  if (!LittleFS.begin()) {
    Serial.println("An error occurred while mounting LittleFS");
    Serial.println("Formatting LittleFS...");
    LittleFS.format();
    if (!LittleFS.begin()) {
      Serial.println("LittleFS mount failed even after formatting");
      return;
    }
    Serial.println("LittleFS formatted and mounted successfully");
  }
  
  // Check if files exist
  Serial.println("Checking for required files:");
  if (LittleFS.exists("/index.html")) {
    Serial.println("index.html - OK");
  } else {
    Serial.println("index.html - MISSING");
  }
  if (LittleFS.exists("/style.css")) {
    Serial.println("style.css - OK");
  } else {
    Serial.println("style.css - MISSING");
  }
  if (LittleFS.exists("/script.js")) {
    Serial.println("script.js - OK");
  } else {
    Serial.println("script.js - MISSING");
  }
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("");
  Serial.println("WiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
  
  // Setup WebSocket
  ws.onEvent(onWebSocketEvent);
  server.addHandler(&ws);
  
  // Route for root / web page
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (LittleFS.exists("/index.html")) {
      request->send(LittleFS, "/index.html", "text/html");
    } else {
      request->send(200, "text/plain", "File system error: index.html not found. Please upload files to LittleFS.");
    }
  });
  
  // Route for styles
  server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(LittleFS, "/style.css", "text/css");
  });
  
  // Route for JavaScript
  server.on("/script.js", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(LittleFS, "/script.js", "text/javascript");
  });
  
  // Route for getting current status
  server.on("/status", HTTP_GET, [](AsyncWebServerRequest *request) {
    String status = getStatusJson();
    request->send(200, "application/json", status);
  });
  
  // Route for getting profiles
  server.on("/profiles", HTTP_GET, [](AsyncWebServerRequest *request) {
    String profilesJson = getProfilesJson();
    request->send(200, "application/json", profilesJson);
  });
  
  // Add this call to your setup() function, just before server.begin():
  setupDebugRoutes();
  
  // Start server
  server.begin();
  
  Serial.println("HTTP server started");
}

void loop() {
  unsigned long currentMillis = millis();
  
  // Read sensor data every 2 seconds
  if (currentMillis - lastSensorRead >= 2000) {
    readSensorData();
    lastSensorRead = currentMillis;
    
    // Send data to clients
    String status = getStatusJson();
    ws.textAll(status);
  }
  
  // Update heater control every 1 second
  if (currentMillis - lastControlUpdate >= 1000) {
    updateHeaterControl();
    lastControlUpdate = currentMillis;
  }
  
  // Check if drying process should end
  if (dryingActive && (currentMillis - dryingStartTime >= dryingDuration)) {
    stopDrying();
  }
  
  // Handle WebSocket cleanup
  ws.cleanupClients();
}

void readSensorData() {
  static unsigned long lastSuccessfulRead = 0;
  const unsigned long sensorTimeout = 10000; // 10 seconds timeout
  const int maxRetries = 3;
  static int consecutiveFailures = 0;
  
  // Temporary variables to store readings
  float tempReading = NAN;
  float humidityReading = NAN;
  bool readSuccess = false;

  // Try reading multiple times in case of temporary failure
  for (int attempt = 0; attempt < maxRetries; attempt++) {
    sensors_event_t humidity, temp;
    
    if (aht.getEvent(&humidity, &temp)) {
      // Validate the readings
      if (!isnan(temp.temperature) && temp.temperature >= -20 && temp.temperature <= 120 &&
          !isnan(humidity.relative_humidity) && humidity.relative_humidity >= 0 && humidity.relative_humidity <= 100) {
        tempReading = temp.temperature;
        humidityReading = humidity.relative_humidity;
        readSuccess = true;
        break;
      }
    }
    delay(50); // Short delay between retries
  }

  if (readSuccess) {
    // Only update values if we got good readings
    currentTemp = tempReading;
    currentHumidity = humidityReading;
    lastSuccessfulRead = millis();
    consecutiveFailures = 0;
    
    Serial.print("Sensor OK - Temperature: ");
    Serial.print(currentTemp);
    Serial.print(" °C, Humidity: ");
    Serial.print(currentHumidity);
    Serial.println(" %");
  } else {
    consecutiveFailures++;
    Serial.println("Failed to read valid sensor data!");
    
    // Handle sensor failure
    if (consecutiveFailures >= 3 || (millis() - lastSuccessfulRead > sensorTimeout)) {
      handleSensorFailure();
    }
  }
}

void handleSensorFailure() {
  Serial.println("Critical sensor failure detected!");
  
  // Emergency shutdown if we're actively heating
  if (heaterActive) {
    //emergencyShutdown();
    
    // Send alert to all WebSocket clients
    String alert = "{\"alert\":\"Sensor failure - System shutdown\",\"temperature\":";
    alert += isnan(currentTemp) ? "null" : String(currentTemp);
    alert += ",\"humidity\":";
    alert += isnan(currentHumidity) ? "null" : String(currentHumidity);
    alert += "}";
    ws.textAll(alert);
  }
  
  // Mark values as invalid
  currentTemp = NAN;
  currentHumidity = NAN;
}






// Add this emergency shutdown function:
void emergencyShutdown() {
  Serial.println("EMERGENCY SHUTDOWN ACTIVATED - SENSOR FAILURE");
  heaterActive = false;
  dryingActive = false;
  analogWrite(HEATER_PIN, 0);
  targetTemp = 0;
  
  // Notify clients
  String status = getStatusJson();
  ws.textAll(status);
}

void updateHeaterControl() {
  unsigned long currentTime = millis();
  
  // Only run control logic at fixed intervals
  if (currentTime - lastControlTime < controlInterval) {
    return;
  }
  lastControlTime = currentTime;

  // Safety checks - immediately disable heater if conditions aren't met
  if (!heaterActive || isnan(currentTemp)) {
    analogWrite(HEATER_PIN, 0);
    heaterPower = 0;
    integral = 0; // Reset integral term
    lastError = 0;
    return;
  }

  // Calculate error (difference between target and current temperature)
  float error = targetTemp - currentTemp;

  // PID calculations with anti-windup protection
  if (abs(error) < 10.0) { // Only accumulate integral when close to target
    integral += error;
    // Constrain integral term to prevent windup
    integral = constrain(integral, -100/Ki, 100/Ki);
  } else {
    integral = 0; // Reset integral when far from target
  }

  // Calculate derivative term (rate of change of error)
  float derivative = error - lastError;
  lastError = error;

  // Calculate PID output
  float output = Kp * error + Ki * integral + Kd * derivative;
  
  // Constrain and apply the output
  heaterPower = constrain(output, 0, PWM_RANGE);
  
  // Additional safety check - don't heat if already at or above target
  if (currentTemp >= targetTemp) {
    heaterPower = 0;
  }

  // Apply the PWM signal to the heater
  analogWrite(HEATER_PIN, heaterPower);

  // Debug output
  Serial.print("PID Control - Target: ");
  Serial.print(targetTemp);
  Serial.print("°C, Current: ");
  Serial.print(currentTemp);
  Serial.print("°C, Error: ");
  Serial.print(error);
  Serial.print(", PWM: ");
  Serial.print(heaterPower);
  Serial.print("/");
  Serial.print(PWM_RANGE);
  Serial.print(" (");
  Serial.print((heaterPower * 100) / PWM_RANGE);
  Serial.println("%)");
}


void stopDrying() {
  heaterActive = false;
  dryingActive = false;
  analogWrite(HEATER_PIN, 0);
  heaterPower = 0;
  targetTemp = 0;
  Serial.println("Drying process stopped");
}

void setManualTemperature(float temp) {
  targetTemp = temp;
  heaterActive = true;
  dryingActive = false;
  
  // Reset PID variables
  integral = 0.0;
  lastError = 0.0;
  
  Serial.print("Manual temperature set to: ");
  Serial.println(targetTemp);
}

String getStatusJson() {
  DynamicJsonDocument doc(256);
  
  doc["temperature"] = currentTemp;
  doc["humidity"] = currentHumidity;
  doc["targetTemperature"] = targetTemp;
  doc["heaterPower"] = map(heaterPower, 0, PWM_RANGE, 0, 100); // Convert to percentage
  doc["heaterActive"] = heaterActive;
  doc["dryingActive"] = dryingActive;
  
  if (dryingActive) {
    unsigned long elapsedTime = (millis() - dryingStartTime) / 1000; // in seconds
    unsigned long remainingTime = (dryingDuration / 1000) - elapsedTime; // in seconds
    doc["remainingTime"] = remainingTime;
  } else {
    doc["remainingTime"] = 0;
  }
  
  String result;
  serializeJson(doc, result);
  return result;
}

String getProfilesJson() {
  DynamicJsonDocument doc(1024);
  JsonArray profilesArray = doc.to<JsonArray>();
  
  for (const auto& profile : profiles) {
    JsonObject profileObj = profilesArray.createNestedObject();
    profileObj["name"] = profile.name;
    profileObj["temperature"] = profile.temperature;
    profileObj["duration"] = profile.duration;
  }
  
  String result;
  serializeJson(doc, result);
  return result;
}

void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, 
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("WebSocket client #%u connected from %s\n", client->id(), client->remoteIP().toString().c_str());
    // Send current status immediately when a client connects
    String status = getStatusJson();
    client->text(status);
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("WebSocket client #%u disconnected\n", client->id());
  } else if (type == WS_EVT_DATA) {
    // Add debug output for received messages
    Serial.printf("WebSocket message received: %.*s\n", len, data);
    AwsFrameInfo *info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len) {
      // Complete message received
      if (info->opcode == WS_TEXT) {
        data[len] = 0; // Null terminate
        String message = String((char*)data);
        handleWebSocketMessage(message);
      }
    }
  }
}

void startDrying(int profileIndex) {
  if (profileIndex >= 0 && profileIndex < profiles.size()) {
    // Reset PID controller
    integral = 0.0;
    lastError = 0.0;
    
    // Set new target parameters
    targetTemp = profiles[profileIndex].temperature;
    dryingDuration = profiles[profileIndex].duration * 60 * 1000; // Convert minutes to milliseconds
    dryingStartTime = millis();
    dryingActive = true;
    heaterActive = true;
    
    // Immediate update
    analogWrite(HEATER_PIN, PWM_RANGE * 0.7); // Start with 70% power for fast warm-up
    heaterPower = PWM_RANGE * 0.7;
    
    Serial.print("Starting drying with profile: ");
    Serial.print(profiles[profileIndex].name);
    Serial.print(" at ");
    Serial.print(targetTemp);
    Serial.println("°C");
    
    // Send update to all clients
    ws.textAll(getStatusJson());
  }
}

void handleWebSocketMessage(String message) {
  DynamicJsonDocument doc(256);
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.print("deserializeJson() failed: ");
    Serial.println(error.c_str());
    return;
  }
  
  String command = doc["command"];
  
  if (command == "startProfile") {
    int profileIndex = doc["profileIndex"];
    startDrying(profileIndex);
  } else if (command == "stopDrying") {
    stopDrying();
  } else if (command == "setTemperature") {
    float temperature = doc["temperature"];
    setManualTemperature(temperature);
  }
}

