const express = require("express");
const http = require("http");
const WebSocket = require('ws');
const { Server } = require("socket.io");
const { getOrCreateRoom } = require("./room.js");
const dotenv = require('dotenv');

dotenv.config({ path: require('path').join(__dirname, '.env') });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// WebSocket server for Flask communication
const wss = new WebSocket.Server({ port: 3002 });
let flaskConnection = null;

wss.on('connection', (ws) => {
  console.log('[WebSocket] Flask backend connected');
  flaskConnection = ws;
  
  ws.on('close', () => {
    console.log('[WebSocket] Flask backend disconnected');
    flaskConnection = null;
  });
});

app.use(express.static("public"));
app.use(express.json()); // Add JSON parsing middleware

// Test API endpoint to send audio data to Flask
app.post('/test-audio', (req, res) => {
  try {
    if (!flaskConnection) {
      return res.status(503).json({ 
        error: 'Flask backend not connected',
        message: 'Make sure the Flask server is running and connected to WebSocket port 3002'
      });
    }

    // Extract parameters from request body
    const { 
      roomId = 'test-room-001', 
      producerId = 'test-producer-001',
      text = 'Hello world, this is a test audio transcription for the AI learning platform.',
      chunkCount = 50
    } = req.body;

    // Generate simulated audio data (sine wave encoded as raw PCM)
    const sampleRate = 48000;
    const duration = 2.0; // 2 seconds
    const amplitude = 0.3;
    const frequency = 440; // A4 note
    
    const numSamples = Math.floor(sampleRate * duration);
    const audioBuffer = Buffer.alloc(numSamples * 2); // 16-bit samples
    
    // Generate sine wave
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
      const intSample = Math.round(sample * 32767); // Convert to 16-bit integer
      audioBuffer.writeInt16LE(intSample, i * 2);
    }

    // Create test audio data in the same format as real audio chunks
    const audioData = {
      roomId: roomId,
      producerId: producerId,
      timestamp: Date.now(),
      startTimestamp: Date.now() - 2000, // 2 seconds ago
      endTimestamp: Date.now(),
      chunkCount: chunkCount,
      missingPackets: 0,
      firstSequenceNumber: 1000,
      lastSequenceNumber: 1000 + chunkCount - 1,
      audioBuffer: audioBuffer.toString('base64'),
      payloadType: 111, // Opus payload type
      duration: duration * 1000, // Duration in milliseconds
      testMode: true, // Flag to indicate this is test data
      expectedTranscription: text // What we expect Whisper to transcribe
    };

    // Send to Flask backend via WebSocket
    flaskConnection.send(JSON.stringify({
      type: 'audio_chunk',
      data: audioData
    }));

    console.log(`[Test Audio] Sent test audio data for room ${roomId}, producer ${producerId}`);
    console.log(`[Test Audio] Audio buffer size: ${audioBuffer.length} bytes`);
    console.log(`[Test Audio] Expected transcription: "${text}"`);

    res.json({ 
      success: true,
      message: 'Test audio data sent to Flask backend',
      data: {
        roomId,
        producerId,
        audioBufferSize: audioBuffer.length,
        duration: duration,
        sampleRate: sampleRate,
        frequency: frequency,
        expectedTranscription: text,
        timestamp: audioData.timestamp
      }
    });

  } catch (error) {
    console.error('[Test Audio] Error:', error);
    res.status(500).json({ 
      error: 'Failed to send test audio data',
      details: error.message
    });
  }
});

// Enhanced test endpoint with real audio file support
app.post('/test-audio-with-speech', (req, res) => {
  try {
    if (!flaskConnection) {
      return res.status(503).json({ 
        error: 'Flask backend not connected',
        message: 'Make sure the Flask server is running and connected to WebSocket port 3002'
      });
    }

    const { 
      roomId = 'test-room-speech-001', 
      producerId = 'test-producer-speech-001',
      text = 'This is a test message for speech recognition using Whisper AI model.'
    } = req.body;

    // Generate a more realistic audio pattern that might contain speech-like frequencies
    const sampleRate = 48000;
    const duration = 3.0; // 3 seconds
    const audioBuffer = Buffer.alloc(Math.floor(sampleRate * duration) * 2);
    
    // Generate speech-like audio with multiple frequency components
    const numSamples = audioBuffer.length / 2;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      
      // Mix multiple frequencies to simulate speech formants
      const f1 = 300 + 200 * Math.sin(2 * Math.PI * 2 * t); // Varying fundamental
      const f2 = 1200 + 400 * Math.sin(2 * Math.PI * 3 * t); // Varying formant
      const f3 = 2400 + 200 * Math.sin(2 * Math.PI * 1.5 * t); // High formant
      
      const amplitude1 = 0.3 * Math.exp(-t * 0.5); // Decaying amplitude
      const amplitude2 = 0.2 * Math.exp(-t * 0.3);
      const amplitude3 = 0.1 * Math.exp(-t * 0.7);
      
      const sample = 
        amplitude1 * Math.sin(2 * Math.PI * f1 * t) +
        amplitude2 * Math.sin(2 * Math.PI * f2 * t) +
        amplitude3 * Math.sin(2 * Math.PI * f3 * t);
      
      // Add some noise to make it more realistic
      const noise = (Math.random() - 0.5) * 0.05;
      
      const intSample = Math.round((sample + noise) * 32767 * 0.7);
      audioBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, intSample)), i * 2);
    }

    const audioData = {
      roomId: roomId,
      producerId: producerId,
      timestamp: Date.now(),
      startTimestamp: Date.now() - 3000,
      endTimestamp: Date.now(),
      chunkCount: 75, // More chunks for longer audio
      missingPackets: 0,
      firstSequenceNumber: 2000,
      lastSequenceNumber: 2074,
      audioBuffer: audioBuffer.toString('base64'),
      payloadType: 111,
      duration: duration * 1000,
      testMode: true,
      testType: 'speech-like',
      expectedTranscription: text
    };

    flaskConnection.send(JSON.stringify({
      type: 'audio_chunk',
      data: audioData
    }));

    console.log(`[Test Speech Audio] Sent speech-like test audio for room ${roomId}`);

    res.json({ 
      success: true,
      message: 'Speech-like test audio data sent to Flask backend',
      data: {
        roomId,
        producerId,
        audioBufferSize: audioBuffer.length,
        duration: duration,
        type: 'speech-like',
        expectedTranscription: text,
        timestamp: audioData.timestamp
      }
    });

  } catch (error) {
    console.error('[Test Speech Audio] Error:', error);
    res.status(500).json({ 
      error: 'Failed to send test speech audio data',
      details: error.message
    });
  }
});

// Status endpoint to check WebSocket connection
app.get('/test-status', (req, res) => {
  res.json({
    flaskConnected: flaskConnection !== null,
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /test-audio': 'Send simple sine wave test audio',
      'POST /test-audio-with-speech': 'Send speech-like test audio',
      'GET /test-status': 'Check connection status'
    }
  });
});

const rooms = {};

const SIGNALING_LISTEN_IP = process.env.SIGNALING_LISTEN_IP || "0.0.0.0";
const SIGNALING_ANNOUNCED_IP = process.env.SIGNALING_ANNOUNCED_IP || null;
const SIGNALING_PORT = process.env.SIGNALING_PORT || 3001;
const SIGNALING_STUN_URL = process.env.SIGNALING_STUN_URL || "stun:stun.l.google.com:19302";

io.on("connection", async (socket) => {
  console.log("[Socket.IO] Client connected:", socket.id);
  try {
    const { roomId, role, studentName } = socket.handshake.query;
    console.log(`[Socket.IO] Handshake query: roomId=${roomId}, role=${role}, studentName=${studentName}`);
    if (!roomId || !role) {
      console.error("[Socket.IO] Room ID and role are required.");
      throw new Error("Room ID and role are required.");
    }
    const room = await getOrCreateRoom(roomId);
    const router = room.router;
    room.producers = room.producers || {};
    // --- Student/Teacher tracking logic ---
    room.peers = room.peers || {};
    room.teachers = room.teachers || new Set();
    room.students = room.students || new Map();
    console.log(`[Room] Room ${roomId} initialized. Teachers: ${Array.from(room.teachers)}, Students: ${Array.from(room.students.values())}`);
    // Register teacher or student
    if (role === 'teacher') {
      room.teachers.add(socket.id);
      console.log(`[Room] Teacher joined: ${socket.id}. Teachers now: ${Array.from(room.teachers)}`);
      // Send all current students to teacher
      room.students.forEach((name) => {
        socket.emit('student-joined', name);
      });
    } else if (role === 'student' && studentName) {
      room.students.set(socket.id, studentName);
      console.log(`[Room] Student joined: ${socket.id} (${studentName}). Students now: ${Array.from(room.students.values())}`);
      // Notify all teachers
      room.teachers.forEach((teacherId) => {
        if (room.peers[teacherId]) {
          room.peers[teacherId].socket.emit('student-joined', studentName);
        }
      });
    }
    // Manual student-joined event (for legacy clients)
    socket.on('student-joined', (name) => {
      console.log(`[Socket.IO] student-joined event received: ${name}`);
      if (role === 'student' && name) {
        room.students.set(socket.id, name);
        room.teachers.forEach((teacherId) => {
          if (room.peers[teacherId]) {
            room.peers[teacherId].socket.emit('student-joined', name);
          }
        });
      }
    });

    // Always initialize peer object for this socket
    if (!room.peers[socket.id]) {
      room.peers[socket.id] = {
        socket,
        role,
        producers: {},
        consumers: {},
        producerTransport: null,
        consumerTransport: null
      };
      console.log(`[Peer] Peer object initialized for ${socket.id} (${role})`);
    }

    socket.on("getRouterRtpCapabilities", (data, callback) => {
      console.log(`[Mediasoup] getRouterRtpCapabilities requested by ${socket.id}`);
      callback(router.rtpCapabilities);
    });

    socket.on("createTransport", async ({ isProducer }, callback) => {
      console.log(`[Mediasoup] createTransport requested by ${socket.id}, isProducer=${isProducer}`);
      try {
        const transport = await router.createWebRtcTransport({
          listenIps: [{ ip: SIGNALING_LISTEN_IP, announcedIp: SIGNALING_ANNOUNCED_IP }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          initialAvailableOutgoingBitrate: 1000000,
          iceServers: [
            { urls: SIGNALING_STUN_URL }
          ]
        });
        console.log(`[Mediasoup] WebRtcTransport created: id=${transport.id}, isProducer=${isProducer}`);
        if (isProducer) {
          room.peers[socket.id].producerTransport = transport;
        } else {
          room.peers[socket.id].consumerTransport = transport;
        }
        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        });
      } catch (error) {
        console.error("[Mediasoup] Failed to create transport:", error);
        callback({ error: error.message });
      }
    });

    socket.on("connectTransport", async ({ transportId, dtlsParameters }, callback) => {
      console.log(`[Mediasoup] connectTransport requested by ${socket.id}, transportId=${transportId}`);
      try {
        const peer = room.peers[socket.id];
        const transport = (peer.producerTransport?.id === transportId)
          ? peer.producerTransport
          : peer.consumerTransport;
        if (!transport) throw new Error(`[Mediasoup] Transport not found for id=${transportId}`);
        // Prevent duplicate connections
        if (!transport.connected) {
          await transport.connect({ dtlsParameters });
          console.log(`[Mediasoup] Transport ${transportId} connected for ${socket.id}`);
        } else {
          console.log(`[Mediasoup] Transport ${transportId} already connected for ${socket.id}`);
        }
        callback();
      } catch (error) {
        console.error("[Mediasoup] Failed to connect transport:", error);
        callback({ error: error.message });
      }
    });

    socket.on("produce", async ({ kind, rtpParameters }, callback) => {
      console.log(`[Mediasoup] produce requested by ${socket.id}, kind=${kind}`);
      try {
        const peer = room.peers[socket.id];
        console.log(`[Mediasoup] Creating producer: kind=${kind}`);
        console.log(`[Mediasoup] Producer RTP Parameters:`, JSON.stringify(rtpParameters, null, 2));
        const producer = await peer.producerTransport.produce({
          kind,
          rtpParameters
        });
        
        // Store producer by kind
        peer.producers[kind] = producer;
        room.producers[kind] = producer;
        
        // If it's an audio producer, start recording for Flask
        if (kind === 'audio' && flaskConnection) {
          console.log(`[Audio Recording] Starting audio recording for producer ${producer.id}`);
          startAudioRecording(producer, room.roomId);
        }
        
        console.log(`[Mediasoup] Producer created: id=${producer.id}, kind=${producer.kind}`);
        console.log(`[Mediasoup] Producer codec:`, producer.rtpParameters.codecs);
        callback({ id: producer.id });
        // Notify students
        for (const otherPeer of Object.values(room.peers)) {
          if (otherPeer.role === "student") {
            otherPeer.socket.emit("new-producer");
          }
        }
      } catch (error) {
        console.error("[Mediasoup] Failed to create producer:", error);
        callback({ error: error.message });
      }
    });

    socket.on("consume", async ({ kind, rtpCapabilities }, callback) => {
      console.log(`[Mediasoup] consume requested by ${socket.id}, kind=${kind}`);
      try {
        if (!room.producers[kind]) {
          console.warn(`[Mediasoup] No ${kind} producer in the room for consume by ${socket.id}`);
          return callback({ error: `No ${kind} producer in the room` });
        }
        const producer = room.producers[kind];
        if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
          console.error(`[Mediasoup] Cannot consume: producerId=${producer.id}, kind=${kind}`);
          return callback({ error: `Client cannot consume ${kind}` });
        }
        const peer = room.peers[socket.id];
        if (!peer.consumerTransport) {
          console.error(`[Mediasoup] No consumer transport for peer ${socket.id} when trying to consume ${kind}`);
          return callback({ error: "Consumer transport not ready. Please retry." });
        }
        console.log(`[Mediasoup] Creating consumer: kind=${kind}, producerId=${producer.id}`);
        console.log(`[Mediasoup] Consumer RTP Capabilities:`, JSON.stringify(rtpCapabilities, null, 2));
        // Set paused: false to start consumer immediately
        const consumer = await peer.consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          kind,
          paused: false
        });
        peer.consumers = peer.consumers || {};
        peer.consumers[kind] = consumer;
        console.log(`[Mediasoup] Consumer created: id=${consumer.id}, kind=${consumer.kind}`);
        console.log(`[Mediasoup] Consumer codec:`, consumer.rtpParameters.codecs);
        callback({
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        });
      } catch (error) {
        console.error(`[Mediasoup] Failed to create ${kind} consumer:`, error);
        callback({ error: error.message });
      }
    });

    socket.on("resume", async ({ consumerId }, callback) => {
      console.log(`[Mediasoup] resume requested by ${socket.id}, consumerId=${consumerId}`);
      try {
        const peer = room.peers[socket.id];
        if (!peer.consumers) return callback();
        // Find consumer by ID
        const consumer = Object.values(peer.consumers).find(
          c => c.id === consumerId
        );
        if (consumer) {
          await consumer.resume();
          console.log(`[Mediasoup] Consumer ${consumerId} resumed for ${socket.id}. Paused state: ${consumer.paused}`);
        } else {
          console.warn(`[Mediasoup] Consumer ${consumerId} not found for ${socket.id}`);
        }
        callback();
      } catch (error) {
        console.error("[Mediasoup] Resume error:", error);
        callback({ error: error.message });
      }
    });

    // On disconnect, clean up
    socket.on("disconnect", () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      const peer = room.peers[socket.id];
      if (peer) {
        // Close all producers
        Object.values(peer.producers || {}).forEach(producer => {
          console.log(`[Mediasoup] Closing producer: id=${producer.id}, kind=${producer.kind}`);
          producer.close();
          // Remove from room producers
          Object.keys(room.producers).forEach(kind => {
            if (room.producers[kind]?.id === producer.id) {
              delete room.producers[kind];
              console.log(`[Mediasoup] Removed producer from room: kind=${kind}`);
            }
          });
        });
        // Close all consumers
        Object.values(peer.consumers || {}).forEach(consumer => {
          console.log(`[Mediasoup] Closing consumer: id=${consumer.id}, kind=${consumer.kind}`);
          consumer.close();
        });
        if (peer.producerTransport) {
          console.log(`[Mediasoup] Closing producer transport for ${socket.id}`);
          peer.producerTransport.close();
        }
        if (peer.consumerTransport) {
          console.log(`[Mediasoup] Closing consumer transport for ${socket.id}`);
          peer.consumerTransport.close();
        }
      }
      if (role === 'teacher') {
        room.teachers.delete(socket.id);
        console.log(`[Room] Teacher left: ${socket.id}. Teachers now: ${Array.from(room.teachers)}`);
      } else if (role === 'student') {
        room.students.delete(socket.id);
        console.log(`[Room] Student left: ${socket.id}. Students now: ${Array.from(room.students.values())}`);
      }
      delete room.peers[socket.id];
      // Optionally: clean up room if empty
      if (room.teachers.size === 0 && room.students.size === 0) {
        delete rooms[roomId];
        console.log(`[Room] Room ${roomId} deleted (empty)`);
      }
    });

  } catch (error) {
    console.error("[Socket.IO] Error during connection setup:", error);
    socket.disconnect();
  }
});

server.listen(SIGNALING_PORT, () => {
  console.log(`✅ Server is running on http://${SIGNALING_LISTEN_IP}:${SIGNALING_PORT}`);
});

// Audio recording function with buffering for better transcription
const audioBuffers = new Map(); // Store audio buffers per producer
const BUFFER_DURATION_MS = 3000; // 3 seconds buffer
const MIN_AUDIO_CHUNK_SIZE = 5000; // Minimum 5KB bytes before sending (more realistic for speech)
const FORCE_SEND_DURATION_MS = 4000; // Force send after 4 seconds regardless of size

async function startAudioRecording(producer, roomId) {
  try {
    console.log(`[Audio Recording] Starting audio recording for producer ${producer.id} in room ${roomId}`);
    
    // Initialize audio buffer for this producer
    audioBuffers.set(producer.id, {
      chunks: [],
      lastSent: Date.now(),
      totalBytes: 0
    });
    
    // Get the room to access the router
    const room = rooms[roomId];
    if (!room || !room.router) {
      console.error(`[Audio Recording] No router found for room ${roomId}`);
      return;
    }
    
    // Create PlainTransport with RTCP multiplexing
    const plainTransport = await room.router.createPlainTransport({
      listenIp: '127.0.0.1',
      rtcpMux: true,     // Use same port for RTP and RTCP
      comedia: false
    });

    console.log(`[Audio Recording] PlainTransport created for producer ${producer.id}`);

    // Create UDP socket and bind to any available port
    const dgram = require('dgram');
    const rtpSocket = dgram.createSocket('udp4');
    
    rtpSocket.bind(0, '127.0.0.1', async () => {
      try {
        const { address, port } = rtpSocket.address();
        console.log(`[Audio Recording] RTP socket bound to ${address}:${port}`);
        
        // Connect PlainTransport to our socket
        await plainTransport.connect({ ip: address, port });
        console.log(`[Audio Recording] PlainTransport connected to UDP socket`);
        
        // Create consumer to receive audio from the producer
        const consumer = await plainTransport.consume({
          producerId: producer.id,
          rtpCapabilities: room.router.rtpCapabilities,
          paused: false
        });

        console.log(`[Audio Recording] Consumer created for producer ${producer.id}`);

        // Process incoming RTP packets with buffering
        rtpSocket.on('message', (rtpPacket, rinfo) => {
          try {
            // Extract RTP payload (skip 12-byte RTP header)
            const rtpHeader = rtpPacket.slice(0, 12);
            const audioPayload = rtpPacket.slice(12);
            
            if (audioPayload.length === 0) return;
            
            // Basic RTP header parsing
            const version = (rtpHeader[0] >> 6) & 0x03;
            const payloadType = rtpHeader[1] & 0x7F;
            const sequenceNumber = rtpHeader.readUInt16BE(2);
            const timestamp = rtpHeader.readUInt32BE(4);
            const ssrc = rtpHeader.readUInt32BE(8);

            // Buffer audio data for this producer
            const buffer = audioBuffers.get(producer.id);
            if (buffer) {
              buffer.chunks.push({
                data: audioPayload,
                timestamp: timestamp,
                sequenceNumber: sequenceNumber,
                receivedAt: Date.now()
              });
              buffer.totalBytes += audioPayload.length;
              
              // Send buffered audio if conditions are met
              const now = Date.now();
              const timeSinceLastSent = now - buffer.lastSent;
              
              // More practical conditions for real speech:
              // Send if: (3+ seconds AND 5KB+) OR 4+ seconds total OR 20KB+ accumulated
              if ((timeSinceLastSent >= BUFFER_DURATION_MS && buffer.totalBytes >= MIN_AUDIO_CHUNK_SIZE) || 
                  timeSinceLastSent >= FORCE_SEND_DURATION_MS ||
                  buffer.totalBytes >= 20000) {  // Also send if we accumulate 20KB
                console.log(`[Audio Recording] Sending buffered audio: ${buffer.totalBytes} bytes, ${timeSinceLastSent}ms duration, ${buffer.chunks.length} chunks`);
                sendBufferedAudio(producer.id, roomId, buffer);
                // Reset buffer
                buffer.chunks = [];
                buffer.lastSent = now;
                buffer.totalBytes = 0;
              }
            }

            // Only log occasionally to avoid spam, but show more detail when buffering
            if (sequenceNumber % 100 === 0) {  // Log more frequently to see progress
              console.log(`[Audio Recording] RTP packet: PT=${payloadType}, seq=${sequenceNumber}, buffered=${buffer ? buffer.totalBytes : 0} bytes, chunks=${buffer ? buffer.chunks.length : 0}, time_since_last_sent=${buffer ? (Date.now() - buffer.lastSent) : 0}ms`);
            }

          } catch (error) {
            console.error('[Audio Recording] Error processing RTP packet:', error);
          }
        });

        rtpSocket.on('error', (err) => {
          console.error('[Audio Recording] RTP socket error:', err);
        });
        
        // Clean up when producer closes
        producer.on('close', () => {
          console.log(`[Audio Recording] Producer ${producer.id} closed, cleaning up`);
          
          // Send any remaining buffered audio if it's substantial enough
          const buffer = audioBuffers.get(producer.id);
          if (buffer && buffer.chunks.length > 0 && buffer.totalBytes >= 5000) { // At least 5KB
            console.log(`[Audio Recording] Producer closing, sending final buffered audio: ${buffer.totalBytes} bytes`);
            sendBufferedAudio(producer.id, roomId, buffer);
          }
          
          // Cleanup
          audioBuffers.delete(producer.id);
          rtpSocket.close();
          consumer.close();
          plainTransport.close();
        });

        // Clean up when consumer closes
        consumer.on('close', () => {
          console.log(`[Audio Recording] Consumer for producer ${producer.id} closed`);
        });
        
      } catch (error) {
        console.error('[Audio Recording] Error setting up transport:', error);
        rtpSocket.close();
      }
    });
    
  } catch (error) {
    console.error('[Audio Recording] Error starting audio recording:', error);
  }
}

function sendBufferedAudio(producerId, roomId, buffer) {
  try {
    if (!buffer.chunks.length || !flaskConnection || flaskConnection.readyState !== WebSocket.OPEN) {
      console.log(`[Audio Recording] Skipping send: chunks=${buffer ? buffer.chunks.length : 0}, flask_connected=${flaskConnection ? flaskConnection.readyState === WebSocket.OPEN : false}`);
      return;
    }

    // Check if we have enough audio data to be meaningful for Whisper
    const bufferSize = buffer.chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    if (bufferSize < 1000) { // At least 1KB for any transcription attempt
      console.log(`[Audio Recording] Audio chunk too small (${bufferSize} bytes), skipping send to Flask`);
      return;
    }

    // Sort chunks by sequence number to handle out-of-order packets
    buffer.chunks.sort((a, b) => {
      // Handle sequence number rollover (16-bit)
      const seqA = a.sequenceNumber;
      const seqB = b.sequenceNumber;
      
      // Simple comparison for most cases
      if (Math.abs(seqA - seqB) < 32768) {
        return seqA - seqB;
      } else {
        // Handle rollover case (e.g., 65535 -> 0)
        return seqB - seqA;
      }
    });

    // Detect and log missing packets
    let missingPackets = 0;
    for (let i = 1; i < buffer.chunks.length; i++) {
      const prevSeq = buffer.chunks[i - 1].sequenceNumber;
      const currSeq = buffer.chunks[i].sequenceNumber;
      const expectedSeq = (prevSeq + 1) % 65536; // Handle 16-bit rollover
      
      if (currSeq !== expectedSeq) {
        missingPackets++;
      }
    }

    if (missingPackets > 0) {
      console.log(`[Audio Recording] Detected ${missingPackets} missing/out-of-order packets for producer ${producerId}`);
    }

    // Combine all audio chunks into one buffer (now properly ordered)
    const totalSize = buffer.chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const combinedAudio = Buffer.alloc(totalSize);
    let offset = 0;

    buffer.chunks.forEach(chunk => {
      chunk.data.copy(combinedAudio, offset);
      offset += chunk.data.length;
    });

    // Send combined audio data to Flask backend
    const durationMs = buffer.chunks[buffer.chunks.length - 1].receivedAt - buffer.chunks[0].receivedAt;
    const audioData = {
      roomId: roomId,
      producerId: producerId,
      timestamp: Date.now(),
      startTimestamp: buffer.chunks[0].receivedAt,
      endTimestamp: buffer.chunks[buffer.chunks.length - 1].receivedAt,
      chunkCount: buffer.chunks.length,
      missingPackets: missingPackets,
      firstSequenceNumber: buffer.chunks[0].sequenceNumber,
      lastSequenceNumber: buffer.chunks[buffer.chunks.length - 1].sequenceNumber,
      audioBuffer: combinedAudio.toString('base64'),
      payloadType: 111, // Opus payload type
      duration: Math.max(durationMs, buffer.chunks.length * 20) // Use actual duration or estimate (20ms per packet)
    };
    
    flaskConnection.send(JSON.stringify({
      type: 'audio_chunk',
      data: audioData
    }));

    console.log(`[Audio Recording] Sent ${totalSize} bytes audio chunk for producer ${producerId} (${buffer.chunks.length} packets, ${missingPackets} missing, ${durationMs}ms duration)`);
    
  } catch (error) {
    console.error('[Audio Recording] Error sending buffered audio:', error);
  }
}