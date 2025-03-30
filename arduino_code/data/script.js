// Global variables
let ws
let temperatureChart
let humidityChart
const temperatureData = []
const humidityData = []
const maxDataPoints = 60 // 2 minutes of data at 2-second intervals
let profiles = []
let dryingStartTime = 0
let dryingDuration = 0
let timerInterval
let isConnected = false

// Initialize the application when the page loads
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing application...")

  // First, load the profiles directly to ensure they appear
  loadProfilesDirectly()

  // Then initialize the rest of the application
  initCharts()
  initWebSocket()
  setupEventListeners()

  // Fetch initial status to populate the UI
  fetchInitialStatus()
})

// Load profiles directly from the server without WebSocket
function loadProfilesDirectly() {
  console.log("Loading profiles directly...")

  // Fallback profiles in case the server request fails
  const fallbackProfiles = [
    { name: "PLA", temperature: 45.0, duration: 240 },
    { name: "PETG", temperature: 65.0, duration: 240 },
    { name: "ABS/ASA", temperature: 70.0, duration: 300 },
    { name: "Nylon", temperature: 75.0, duration: 360 },
    { name: "TPU", temperature: 50.0, duration: 240 },
  ]

  // Try to fetch from debug endpoint first (more reliable)
  fetch("/debug/profiles")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      console.log("Profiles loaded successfully from debug endpoint:", data)
      profiles = data
      renderProfiles()
    })
    .catch((error) => {
      console.error("Error loading profiles from debug endpoint:", error)

      // Try the regular endpoint as fallback
      fetch("/profiles")
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
          }
          return response.json()
        })
        .then((data) => {
          console.log("Profiles loaded successfully from regular endpoint:", data)
          profiles = data
          renderProfiles()
        })
        .catch((error) => {
          console.error("Error loading profiles from regular endpoint:", error)
          console.log("Using fallback profiles")
          profiles = fallbackProfiles
          renderProfiles()
        })
    })
}

// Fetch initial status to populate the UI
function fetchInitialStatus() {
  console.log("Fetching initial status...")

  fetch("/debug/status")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      console.log("Initial status loaded successfully:", data)
      updateUI(data)
    })
    .catch((error) => {
      console.error("Error loading initial status:", error)

      // Try the regular endpoint as fallback
      fetch("/status")
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
          }
          return response.json()
        })
        .then((data) => {
          console.log("Initial status loaded successfully from regular endpoint:", data)
          updateUI(data)
        })
        .catch((error) => {
          console.error("Error loading initial status from regular endpoint:", error)
        })
    })
}

// Initialize WebSocket connection
function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const wsUrl = `${protocol}//${window.location.host}/ws`

  console.log("Connecting to WebSocket at:", wsUrl)

  try {
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log("WebSocket connection established")
      isConnected = true
      updateConnectionStatus("Connected", true)
      // Request initial status immediately after connection
      fetchInitialStatus()
    }

    ws.onmessage = (event) => {
      console.log("WebSocket message received")
      try {
        const data = JSON.parse(event.data)
        updateUI(data)
      } catch (error) {
        console.error("Error parsing WebSocket data:", error)
      }
    }

    ws.onclose = () => {
      console.log("WebSocket connection closed")
      isConnected = false
      updateConnectionStatus("Disconnected - Reconnecting...", false)
      // Try to reconnect after 2 seconds
      setTimeout(initWebSocket, 2000)
    }

    ws.onerror = (error) => {
      console.error("WebSocket error:", error)
      isConnected = false
      updateConnectionStatus("Connection Error", false)
    }
  } catch (error) {
    console.error("Error creating WebSocket:", error)
    updateConnectionStatus("Failed to Connect", false)
  }
}

// Update connection status in the UI
function updateConnectionStatus(message, connected) {
  const connectionStatus = document.getElementById("connection-status")
  if (connectionStatus) {
    connectionStatus.textContent = message
    connectionStatus.className = "connection-status " + (connected ? "connected" : "disconnected")
  }
}

// Initialize temperature and humidity charts with improved styling
function initCharts() {
  console.log("Initializing charts with enhanced styling...")

  // Check if Chart.js is loaded
  if (typeof window.Chart === "undefined") {
    console.error("Chart.js is not loaded!")
    const chartsContainer = document.querySelector(".charts-container")
    if (chartsContainer) {
      chartsContainer.innerHTML =
        '<div class="error-message">Charts could not be loaded. Chart.js library is missing.</div>'
    }
    return
  }

  const tempCtx = document.getElementById("temperature-chart")
  const humidityCtx = document.getElementById("humidity-chart")

  if (!tempCtx || !humidityCtx) {
    console.error("Chart canvas elements not found!")
    return
  }

  // Common chart configuration
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 1000,
      easing: 'easeOutQuart'
    },
    interaction: {
      intersect: false,
      mode: 'index'
    },
    scales: {
      x: {
        grid: {
          display: false,
          drawBorder: false
        },
        ticks: {
          display: false
        }
      },
      y: {
        grid: {
          color: 'rgba(255, 255, 255, 0.1)',
          drawBorder: false
        },
        ticks: {
          color: '#888',
          font: {
            size: 12
          }
        }
      }
    },
    plugins: {
      legend: {
        labels: {
          color: '#ddd',
          font: {
            size: 13,
            weight: '500'
          },
          padding: 20,
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 12,
        usePointStyle: true,
        callbacks: {
          label: function(context) {
            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}${context.dataset.label.includes('Temperature') ? '°C' : '%'}`
          }
        }
      }
    }
  }

  // Temperature chart
  temperatureChart = new window.Chart(tempCtx.getContext("2d"), {
    type: "line",
    data: {
      labels: Array(maxDataPoints).fill(""),
      datasets: [
        {
          label: "Current Temperature (°C)",
          data: Array(maxDataPoints).fill(null),
          borderColor: "#FF6B6B",
          backgroundColor: "rgba(255, 107, 107, 0.1)",
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: "#FF6B6B",
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: "#fff",
          borderJoinStyle: 'round',
          borderCapStyle: 'round'
        },
        {
          label: "Target Temperature (°C)",
          data: Array(maxDataPoints).fill(null),
          borderColor: "#4ECDC4",
          backgroundColor: "rgba(78, 205, 196, 0.05)",
          borderWidth: 2,
          borderDash: [5, 3],
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: "#4ECDC4",
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: "#fff"
        }
      ]
    },
    options: {
      ...commonOptions,
      plugins: {
        ...commonOptions.plugins,
        title: {
          display: true,
          text: "Temperature Over Time",
          color: '#ddd',
          font: {
            size: 16,
            weight: '500'
          },
          padding: {
            top: 10,
            bottom: 20
          }
        }
      },
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          min: 20,
          max: 80
        }
      }
    }
  })

  // Humidity chart
  humidityChart = new window.Chart(humidityCtx.getContext("2d"), {
    type: "line",
    data: {
      labels: Array(maxDataPoints).fill(""),
      datasets: [
        {
          label: "Humidity (%)",
          data: Array(maxDataPoints).fill(null),
          borderColor: "#45B7D1",
          backgroundColor: "rgba(69, 183, 209, 0.1)",
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: "#45B7D1",
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: "#fff",
          borderJoinStyle: 'round',
          borderCapStyle: 'round'
        }
      ]
    },
    options: {
      ...commonOptions,
      plugins: {
        ...commonOptions.plugins,
        title: {
          display: true,
          text: "Humidity Over Time",
          color: '#ddd',
          font: {
            size: 16,
            weight: '500'
          },
          padding: {
            top: 10,
            bottom: 20
          }
        }
      },
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          min: 0,
          max: 100
        }
      }
    }
  })

  console.log("Enhanced charts initialized successfully")
}

// Update charts with smooth transitions
function updateCharts(data) {
  if (!temperatureChart || !humidityChart) {
    console.error("Charts not initialized!")
    return
  }

  // Get current time for label
  const now = new Date()
  const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Update temperature chart
  temperatureChart.data.labels.push(timestamp)
  temperatureChart.data.labels.shift()

  temperatureChart.data.datasets[0].data.push(data.temperature)
  temperatureChart.data.datasets[0].data.shift()

  temperatureChart.data.datasets[1].data.push(data.targetTemperature)
  temperatureChart.data.datasets[1].data.shift()

  // Update humidity chart
  humidityChart.data.labels.push(timestamp)
  humidityChart.data.labels.shift()

  humidityChart.data.datasets[0].data.push(data.humidity)
  humidityChart.data.datasets[0].data.shift()

  // Smooth update with animation
  temperatureChart.update('none')
  humidityChart.update('none')
}

// Render filament profiles in the UI
function renderProfiles() {
  console.log("Rendering profiles:", profiles)
  const profilesList = document.getElementById("profiles-list")

  if (!profilesList) {
    console.error("Profiles list element not found!")
    return
  }

  profilesList.innerHTML = ""

  if (!profiles || profiles.length === 0) {
    profilesList.innerHTML = '<div class="profile-card">No profiles available</div>'
    return
  }

  profiles.forEach((profile, index) => {
    const profileCard = document.createElement("div")
    profileCard.className = "profile-card"
    profileCard.innerHTML = `
      <div class="profile-name">${profile.name}</div>
      <div class="profile-details">
        ${profile.temperature}°C for ${formatDuration(profile.duration)}
      </div>
    `

    profileCard.addEventListener("click", () => {
      console.log(`Profile ${profile.name} clicked`)
      startProfile(index)
    })

    profilesList.appendChild(profileCard)
  })

  console.log("Profiles rendered successfully")
}

// Set up event listeners for UI controls
function setupEventListeners() {
  console.log("Setting up event listeners...")

  const setTempBtn = document.getElementById("set-temp-btn")
  if (setTempBtn) {
    setTempBtn.addEventListener("click", () => {
      console.log("Set temperature button clicked")
      const tempInput = document.getElementById("manual-temp")
      if (!tempInput) {
        console.error("Temperature input not found!")
        return
      }

      const temperature = Number.parseFloat(tempInput.value)

      if (isNaN(temperature) || temperature < 30 || temperature > 80) {
        alert("Please enter a valid temperature between 30°C and 80°C")
        return
      }

      setManualTemperature(temperature)
    })
  } else {
    console.error("Set temperature button not found!")
  }

  const stopBtn = document.getElementById("stop-btn")
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      console.log("Stop button clicked")
      stopDrying()
    })
  } else {
    console.error("Stop button not found!")
  }

  console.log("Event listeners set up successfully")
}

// Update UI with new data
function updateUI(data) {
  console.log("Updating UI with data:", data)

  // Update status cards
  updateElement("current-temp", data.temperature.toFixed(1))
  updateElement("current-humidity", data.humidity.toFixed(1))
  updateElement("target-temp", data.targetTemperature.toFixed(1))
  updateElement("heater-power", data.heaterPower)

  // Update charts
  updateCharts(data)

  // Update timer if drying is active
  const timerPanel = document.getElementById("timer-panel")
  if (timerPanel) {
    if (data.dryingActive) {
      timerPanel.style.display = "block"
      updateTimer(data.remainingTime)
    } else {
      timerPanel.style.display = "none"
      clearInterval(timerInterval)
    }
  }
}

// Helper function to safely update element text content
function updateElement(id, value) {
  const element = document.getElementById(id)
  if (element) {
    element.textContent = value
  } else {
    console.error(`Element with id ${id} not found!`)
  }
}

// Update temperature and humidity charts with new data
function updateCharts(data) {
  if (!temperatureChart || !humidityChart) {
    console.error("Charts not initialized!")
    return
  }

  const timestamp = new Date().toLocaleTimeString()

  // Update temperature chart
  temperatureChart.data.labels.push(timestamp)
  temperatureChart.data.labels.shift()

  temperatureChart.data.datasets[0].data.push(data.temperature)
  temperatureChart.data.datasets[0].data.shift()

  temperatureChart.data.datasets[1].data.push(data.targetTemperature)
  temperatureChart.data.datasets[1].data.shift()

  temperatureChart.update()

  // Update humidity chart
  humidityChart.data.labels.push(timestamp)
  humidityChart.data.labels.shift()

  humidityChart.data.datasets[0].data.push(data.humidity)
  humidityChart.data.datasets[0].data.shift()

  humidityChart.update()
}

// Start drying with selected profile
function startProfile(profileIndex) {
  if (!isConnected) {
    console.error("WebSocket not connected!")
    alert("Not connected to the dryer. Please refresh the page.")
    return
  }

  console.log(`Starting profile ${profileIndex}`)

  const command = {
    command: "startProfile",
    profileIndex: profileIndex,
  }

  try {
    ws.send(JSON.stringify(command))
    console.log("Start profile command sent")

    // Highlight the selected profile
    const profileCards = document.querySelectorAll(".profile-card")
    profileCards.forEach((card, index) => {
      if (index === profileIndex) {
        card.classList.add("active")
      } else {
        card.classList.remove("active")
      }
    })

    // Set drying duration for UI timer
    dryingDuration = profiles[profileIndex].duration * 60 // in seconds
    dryingStartTime = Math.floor(Date.now() / 1000)
  } catch (error) {
    console.error("Error sending start profile command:", error)
    alert("Failed to start drying. Please try again.")
  }
}

// Set manual temperature
function setManualTemperature(temperature) {
  if (!isConnected) {
    console.error("WebSocket not connected!")
    alert("Not connected to the dryer. Please refresh the page.")
    return
  }

  console.log(`Setting manual temperature to ${temperature}°C`)

  const command = {
    command: "setTemperature",
    temperature: temperature,
  }

  try {
    ws.send(JSON.stringify(command))
    console.log("Set temperature command sent")

    // Remove highlight from all profiles
    const profileCards = document.querySelectorAll(".profile-card")
    profileCards.forEach((card) => {
      card.classList.remove("active")
    })
  } catch (error) {
    console.error("Error sending set temperature command:", error)
    alert("Failed to set temperature. Please try again.")
  }
}

// Stop the drying process
function stopDrying() {
  if (!isConnected) {
    console.error("WebSocket not connected!")
    alert("Not connected to the dryer. Please refresh the page.")
    return
  }

  console.log("Stopping drying process")

  const command = {
    command: "stopDrying",
  }

  try {
    ws.send(JSON.stringify(command))
    console.log("Stop drying command sent")

    // Remove highlight from all profiles
    const profileCards = document.querySelectorAll(".profile-card")
    profileCards.forEach((card) => {
      card.classList.remove("active")
    })
  } catch (error) {
    console.error("Error sending stop drying command:", error)
    alert("Failed to stop drying. Please try again.")
  }
}

// Update the timer display
function updateTimer(remainingSeconds) {
  const hours = Math.floor(remainingSeconds / 3600)
  const minutes = Math.floor((remainingSeconds % 3600) / 60)
  const seconds = remainingSeconds % 60

  const timeString = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

  const remainingTimeElement = document.getElementById("remaining-time")
  if (remainingTimeElement) {
    remainingTimeElement.textContent = timeString
  }

  // Update progress bar
  const progressBar = document.getElementById("progress-bar")
  if (!progressBar) {
    return
  }

  const profile = document.querySelector(".profile-card.active")
  if (profile) {
    const profileIndex = Array.from(profile.parentNode.children).indexOf(profile)
    const totalDuration = profiles[profileIndex].duration * 60 // in seconds
    const progress = 100 - (remainingSeconds / totalDuration) * 100
    progressBar.style.width = `${progress}%`
  }
}

// Format duration in minutes to hours and minutes
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours > 0) {
    return `${hours}h ${mins}m`
  } else {
    return `${mins}m`
  }
}