const mediasoup = require("mediasoup");

const rooms = {};

async function getOrCreateRoom(roomId) {
  if (rooms[roomId]) return rooms[roomId];

  const worker = await mediasoup.createWorker({
    logLevel: "warn"
  });

  worker.on("died", () => {
    console.error(`mediasoup worker died, exiting in 2 seconds...`);
    setTimeout(() => process.exit(1), 2000);
  });

  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
      },
      {
        kind: "video",
        mimeType: "video/H264",
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f"
        }
      },
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
      }
    ]
  });

  console.log(`Router created for room ${roomId}`);
  
  rooms[roomId] = {
    router,
    peers: {},
    producers: {},
    teachers: new Set(),
    students: new Map()
  };

  return rooms[roomId];
}

module.exports = { getOrCreateRoom };