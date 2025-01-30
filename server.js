const express = require('express');
const mqtt = require('mqtt');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const WebSocket = require('ws');

const app = express();
const port = 5000;

// Enable CORS and JSON parsing
const allowedOrigins = ['https://elfifthsem.netlify.app'];
//const allowedOrigins = ['http://localhost:3000', 'https://elfifthsem.netlify.app'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);  // Allow the request
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));
app.use(express.json());

// MQTT broker details
const mqttBroker = 'mqtt://broker.hivemq.com'; // HiveMQ public broker
const mqttTopic = 'waste/bin/data'; // Ensure your topic is unique

// WebSocket setup for live updates
const wss = new WebSocket.Server({ noServer: true });

// Connect to MongoDB
mongoose.connect('mongodb+srv://waste:subham@waste.1kmvc.mongodb.net/?retryWrites=true&w=majority&appName=waste', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// MongoDB Schemas and Models
const ConsumerSchema = new mongoose.Schema({
  name: String,
  address: String,
  contactNumber: String,
  password: String,
  caNumber: String,
});

const SupportRequestSchema = new mongoose.Schema({
  caNumber: String,
  name: String,
  subject: String,
});

const Consumer = mongoose.model('Consumer', ConsumerSchema);
const SupportRequest = mongoose.model('SupportRequest', SupportRequestSchema);

// Bin data storage
let wasteData = [
  {
    bin: "BIN 1",
    level: 0,
    latitude: 12.92351,
    longitude: 77.49971,
    address: "CURRENT",
    lastEmpty: null, 
  },
  {
    bin: "BIN 2",
    level: 0,
    latitude: 12.915872, 
    longitude: 77.49364,
    address: "CAUVERY HOSTEL",
    lastEmpty: null, 
  },
];

// Generate random Consumer Account Number (CA)
const generateCANumber = () => {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
};

// Function to get the current date and time
const getCurrentTime = () => {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now
    .getDate()
    .toString()
    .padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
};

// API Endpoints

// Get Bin Data
app.get('/api/data', (req, res) => {
  res.json(wasteData);
});

// Consumer Registration
app.post('/api/register', async (req, res) => {
  const { name, address, contactNumber, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const caNumber = generateCANumber();

    const newConsumer = new Consumer({
      name,
      address,
      contactNumber,
      password: hashedPassword,
      caNumber,
    });

    await newConsumer.save();
    res.status(201).json({ message: 'Account created successfully', caNumber });
  } catch (error) {
    res.status(500).json({ error: 'Error creating account' });
  }
});

// Consumer Login (by name instead of CA number)
app.post('/api/login', async (req, res) => {
  const { name, password } = req.body;
  try {
    const consumer = await Consumer.findOne({ name });
    if (!consumer) {
      return res.status(404).json({ error: 'Consumer not found' });
    }

    const isPasswordValid = await bcrypt.compare(password, consumer.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    res.status(200).json({
      message: 'Login successful',
      consumer: {
        name: consumer.name,
        address: consumer.address,
        caNumber: consumer.caNumber,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Error during login' });
  }
});

// Support Request
app.post('/api/support', async (req, res) => {
  const { caNumber, name, subject } = req.body;
  try {
    const newRequest = new SupportRequest({ caNumber, name, subject });
    await newRequest.save();
    res.status(201).json({ message: 'Support request submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error submitting support request' });
  }
});

// MQTT Setup
const mqttClient = mqtt.connect(mqttBroker);

mqttClient.on('connect', () => {
  console.log('Connected to HiveMQ Broker');
  mqttClient.subscribe(mqttTopic, (err) => {
    if (err) {
      console.error('Subscription failed:', err);
    } else {
      console.log(`Successfully subscribed to topic: ${mqttTopic}`);
    }
  });
});

// Handle incoming MQTT messages
mqttClient.on('message', (topic, message) => {
  if (topic === mqttTopic) {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received MQTT data:', data);

      // Update BIN 1 data
      if (data.bin1_level !== undefined) {
        wasteData[0].level = data.bin1_level;

        if (wasteData[0].level < 10 && !wasteData[0].lastEmpty) {
          wasteData[0].lastEmpty = getCurrentTime();
        }
      }

      // Update BIN 2 data
      if (data.bin2_level !== undefined) {
        wasteData[1].level = data.bin2_level;

        if (wasteData[1].level < 30 && !wasteData[1].lastEmpty) {
          wasteData[1].lastEmpty = getCurrentTime();
        }
      }

      // Notify all connected WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(wasteData));
        }
      });
    } catch (error) {
      console.error('Error processing MQTT message:', error);
    }
  }
});

// WebSocket connection setup
app.server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Handle WebSocket upgrade requests
app.server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
