# 🌡️ ESP8266 Smart Filament Dryer Controller

![Project Banner](https://github.com/Akamecyan/filament-dryer-controller/blob/main/images/banner.jpg?raw=true)

## 📖 Overview

This project transforms a standard filament dryer into a smart, WiFi-connected device with precise temperature control, real-time monitoring, and customizable drying profiles. Built using an ESP8266 microcontroller, it offers:

- Web-based control interface
- Real-time temperature/humidity charts
- Multiple filament drying profiles
- PID-controlled heating
- Remote monitoring via any web browser

## 🛠 Hardware Requirements

- ESP8266 (NodeMCU or similar)
- AHT20 Temperature/Humidity Sensor
- MOSFET or Solid State Relay for heater control
- 5V Power Supply
- Enclosure and wiring components

## ⚙️ Software Features

### 🌐 Web Interface
- Responsive dashboard accessible from any device
- Real-time temperature/humidity graphs
- Profile-based drying presets
- Manual temperature control
- Mobile-friendly design

### 🔥 PID Temperature Control
- Optimized for 0-80°C range
- Multi-stage control strategy
- Fast heating with overshoot protection
- Configurable PID constants

### 📊 Pre-configured Filament Profiles
| Material | Temperature | Duration |
|----------|-------------|----------|
| PLA      | 45°C        | 4 hours  |
| PETG     | 65°C        | 6 hours  |
| ABS/ASA  | 70°C        | 8 hours  |
| Nylon    | 75°C        | 10 hours |
| TPU      | 50°C        | 6 hours  |

## 🚀 Getting Started

1. **Hardware Setup**
   ```bash
   # Clone the repository
   git clone https://github.com/Akamecyan/FilamentDryerESP12E.git
