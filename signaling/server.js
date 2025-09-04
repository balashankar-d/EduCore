const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { getOrCreateRoom } = require("./room.js");
const dotenv = require('dotenv');
const axios = require('axios'); // Add axios for HTTP requests to Flask backend

dotenv.config({ path: require('path').join(__dirname, '.env') });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));

const rooms = {};

const SIGNALING_LISTEN_IP = process.env.SIGNALING_LISTEN_IP || "0.0.0.0";
const SIGNALING_ANNOUNCED_IP = process.env.SIGNALING_ANNOUNCED_IP || null;
const SIGNALING_PORT = process.env.SIGNALING_PORT || 3001;
const SIGNALING_STUN_URL = process.env.SIGNALING_STUN_URL || "stun:stun.l.google.com:19302";
const FLASK_BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5000";

// Helper function to save message to Flask backend
const saveMessageToDatabase = async (roomId, senderName, senderRole, message, isSystemMessage = false) => {
  try {
    const response = await axios.post(`${FLASK_BACKEND_URL}/chat/messages`, {
      roomId,
      senderName,
      senderRole,
      message,
      isSystemMessage
    });
    console.log('[Chat] Message saved to database:', response.data);
    return response.data;
  } catch (error) {
    console.error('[Chat] Failed to save message to database:', error.message);
    throw error;
  }
};

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

    // Chat message handling
    socket.on("chat-message", async ({ roomId, senderName, senderRole, message }, callback) => {
      console.log(`[Chat] Message from ${senderName} (${senderRole}): ${message}`);
      try {
        // Save message to database
        await saveMessageToDatabase(roomId, senderName, senderRole, message);
        // Broadcast message to all clients in the room
        io.to(roomId).emit("chat-message", { senderName, senderRole, message });
        callback({ status: "ok" });
      } catch (error) {
        console.error("[Chat] Error handling message:", error);
        callback({ error: error.message });
      }
    });

    // Chat functionality
    socket.on('send-message', async (data, callback) => {
      console.log('[Chat] send-message event received:', data);
      try {
        const { message } = data;
        const senderName = role === 'teacher' ? 'Teacher' : (room.students.get(socket.id) || 'Unknown');
        
        // Save message to database
        const savedMessage = await saveMessageToDatabase(roomId, senderName, role, message, false);
        
        // Broadcast message to all peers in the room
        const messageData = {
          id: savedMessage.id,
          senderName,
          senderRole: role,
          message,
          timestamp: Date.now(),
          isSystemMessage: false
        };
        
        // Send to all peers in the room
        Object.values(room.peers).forEach(peer => {
          peer.socket.emit('new-message', messageData);
        });
        
        if (callback) callback({ success: true, messageId: savedMessage.id });
        console.log('[Chat] Message broadcasted to room:', roomId);
      } catch (error) {
        console.error('[Chat] Error handling send-message:', error);
        if (callback) callback({ error: error.message });
      }
    });

    socket.on('typing', (data) => {
      console.log('[Chat] typing event received:', data);
      const senderName = role === 'teacher' ? 'Teacher' : (room.students.get(socket.id) || 'Unknown');
      
      // Broadcast typing indicator to all other peers in the room
      Object.values(room.peers).forEach(peer => {
        if (peer.socket.id !== socket.id) {
          peer.socket.emit('user-typing', {
            senderName,
            senderRole: role,
            isTyping: data.isTyping
          });
        }
      });
    });

    // Send system message when student joins
    if (role === 'student' && studentName) {
      try {
        const systemMessage = `${studentName} joined the class`;
        await saveMessageToDatabase(roomId, 'System', 'system', systemMessage, true);
        
        // Broadcast system message to all peers
        const messageData = {
          senderName: 'System',
          senderRole: 'system',
          message: systemMessage,
          timestamp: Date.now(),
          isSystemMessage: true
        };
        
        Object.values(room.peers).forEach(peer => {
          peer.socket.emit('new-message', messageData);
        });
        
        console.log('[Chat] System message sent for student join:', studentName);
      } catch (error) {
        console.error('[Chat] Error sending system message for student join:', error);
      }
    }

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