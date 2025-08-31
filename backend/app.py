from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from dateutil import parser
import uuid
import datetime
import jwt
import os
import base64
from dotenv import load_dotenv
import asyncio
import websockets
import json
import threading
import time
import queue
import tempfile
import subprocess
import atexit
from collections import defaultdict
import logging
import hashlib
import struct
import traceback
import requests

# AI/ML imports
try:
    import whisper
    WHISPER_AVAILABLE = True
    print("[AI] ✅ Whisper is available")
except ImportError:
    WHISPER_AVAILABLE = False
    print("[AI] ❌ Whisper not available - pip install openai-whisper")

try:
    import chromadb
    from chromadb.config import Settings
    CHROMADB_AVAILABLE = True
    print("[AI] ✅ ChromaDB is available")
except ImportError:
    CHROMADB_AVAILABLE = False
    print("[AI] ❌ ChromaDB not available - pip install chromadb")

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
    print("[AI] ✅ SentenceTransformers is available")
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    print("[AI] ❌ SentenceTransformers not available - pip install sentence-transformers")

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    print("[AI] ❌ NumPy not available - pip install numpy")

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your_secret_key_here')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///ailearn.db')
db = SQLAlchemy(app)

# AI/ML Configuration and Thread-Safe Resource Management
AI_MODELS = {
    'whisper': None,
    'chromadb_client': None,
    'chromadb_collection': None,
    'embedding_model': None
}

# Thread-safe locks for AI operations
whisper_lock = threading.Lock()
chromadb_lock = threading.Lock()
embedding_lock = threading.Lock()
initialization_lock = threading.Lock()

# AI model initialization flags
AI_INITIALIZED = {
    'whisper': False,
    'chromadb': False,
    'embedding': False
}

def initialize_whisper():
    """Initialize Whisper model (thread-safe)"""
    global AI_MODELS, AI_INITIALIZED
    
    if not WHISPER_AVAILABLE:
        print("[AI] Whisper not available, skipping initialization")
        return False
        
    with whisper_lock:
        if AI_INITIALIZED['whisper']:
            return True
            
        try:
            print("[AI] Initializing Whisper model...")
            # Use base model for balance of speed and accuracy
            AI_MODELS['whisper'] = whisper.load_model("base")
            AI_INITIALIZED['whisper'] = True
            print("[AI] ✅ Whisper model loaded successfully")
            return True
        except Exception as e:
            print(f"[AI] ❌ Failed to load Whisper model: {e}")
            return False

def initialize_embedding_model():
    """Initialize SentenceTransformer model (thread-safe)"""
    global AI_MODELS, AI_INITIALIZED
    
    if not SENTENCE_TRANSFORMERS_AVAILABLE:
        print("[AI] SentenceTransformers not available, skipping initialization")
        return False
        
    with embedding_lock:
        if AI_INITIALIZED['embedding']:
            return True
            
        try:
            print("[AI] Initializing SentenceTransformer model...")
            # Use a good general-purpose model
            AI_MODELS['embedding_model'] = SentenceTransformer('all-MiniLM-L6-v2')
            AI_INITIALIZED['embedding'] = True
            print("[AI] ✅ SentenceTransformer model loaded successfully")
            return True
        except Exception as e:
            print(f"[AI] ❌ Failed to load SentenceTransformer model: {e}")
            return False

def initialize_chromadb():
    """Initialize ChromaDB client and collection (thread-safe)"""
    global AI_MODELS, AI_INITIALIZED
    
    if not CHROMADB_AVAILABLE:
        print("[AI] ChromaDB not available, skipping initialization")
        return False
        
    with chromadb_lock:
        if AI_INITIALIZED['chromadb']:
            return True
            
        try:
            print("[AI] Initializing ChromaDB...")
            
            # Create ChromaDB client with persistent storage
            chroma_dir = os.path.join(os.path.dirname(__file__), 'chroma_db')
            os.makedirs(chroma_dir, exist_ok=True)
            
            AI_MODELS['chromadb_client'] = chromadb.PersistentClient(path=chroma_dir)
            
            # Create or get collection for transcriptions
            AI_MODELS['chromadb_collection'] = AI_MODELS['chromadb_client'].get_or_create_collection(
                name="transcriptions",
                metadata={"description": "Audio transcriptions with embeddings for semantic search"}
            )
            
            AI_INITIALIZED['chromadb'] = True
            print("[AI] ✅ ChromaDB initialized successfully")
            return True
            
        except Exception as e:
            print(f"[AI] ❌ Failed to initialize ChromaDB: {e}")
            return False

def initialize_ai_models():
    """Initialize all AI models (call once during startup)"""
    with initialization_lock:
        print("[AI] Initializing AI models...")
        whisper_ok = initialize_whisper()
        chromadb_ok = initialize_chromadb()
        embedding_ok = initialize_embedding_model()
        
        success_count = sum([whisper_ok, chromadb_ok, embedding_ok])
        
        if success_count == 3:
            print("[AI] 🎉 All AI models initialized successfully")
        elif success_count > 0:
            print(f"[AI] ⚠️  {success_count}/3 AI models initialized (partial functionality)")
        else:
            print("[AI] ❌ No AI models available (running in basic mode)")
        
        return whisper_ok, chromadb_ok, embedding_ok

def store_transcription_in_chromadb(room_id, producer_id, timestamp, transcription, whisper_result):
    """Store transcription with embeddings in ChromaDB (thread-safe)"""
    if not AI_INITIALIZED['chromadb'] or not AI_INITIALIZED['embedding']:
        print(f"[ChromaDB] Room {room_id}: ChromaDB or embedding model not available")
        return False
        
    with chromadb_lock:
        try:
            print(f"[ChromaDB] Room {room_id}: Acquiring ChromaDB lock...")
            
            # Generate embedding for the transcription
            with embedding_lock:
                embedding = AI_MODELS['embedding_model'].encode(transcription)
            
            # Create unique ID for this transcription
            doc_id = f"{room_id}_{producer_id}_{timestamp}"
            
            # Extract additional metadata from Whisper result
            segments = whisper_result.get("segments", [])
            language = whisper_result.get("language", "unknown")
            
            # Prepare metadata
            from datetime import datetime
            metadata = {
                "room_id": room_id,
                "producer_id": producer_id,
                "timestamp": int(timestamp),
                "datetime": datetime.fromtimestamp(timestamp / 1000).isoformat(),
                "language": language,
                "segment_count": len(segments),
                "text_length": len(transcription)
            }
            
            # Store in ChromaDB
            AI_MODELS['chromadb_collection'].add(
                ids=[doc_id],
                embeddings=[embedding.tolist()],
                documents=[transcription],
                metadatas=[metadata]
            )
            
            print(f"[ChromaDB] Room {room_id}: Stored transcription: {doc_id} ({len(transcription)} chars)")
            
            # Also store individual segments for better granularity
            for i, segment in enumerate(segments):
                if segment.get("text", "").strip():
                    segment_id = f"{doc_id}_seg_{i}"
                    segment_text = segment["text"].strip()
                    
                    with embedding_lock:
                        segment_embedding = AI_MODELS['embedding_model'].encode(segment_text)
                    
                    segment_metadata = metadata.copy()
                    segment_metadata.update({
                        "segment_id": i,
                        "segment_start": segment.get("start", 0),
                        "segment_end": segment.get("end", 0),
                        "is_segment": True
                    })
                    
                    AI_MODELS['chromadb_collection'].add(
                        ids=[segment_id],
                        embeddings=[segment_embedding.tolist()],
                        documents=[segment_text],
                        metadatas=[segment_metadata]
                    )
            
            print(f"[ChromaDB] Room {room_id}: Released ChromaDB lock")
            return True
            
        except Exception as e:
            print(f"[ChromaDB] Room {room_id}: Error storing transcription: {e}")
            return False

# WebSocket connection to signaling server
websocket_connection = None

# Audio processing configuration
MAX_AUDIO_FILE_SIZE = 10 * 1024 * 1024  # 10MB per audio file
MAX_AUDIO_FILES_PER_ROOM = 100  # Maximum audio files to keep per room
AUDIO_CLEANUP_INTERVAL = 3600  # Cleanup old files every hour

async def connect_to_signaling_server():
    global websocket_connection
    max_retries = 3
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            print(f"[WebSocket] Attempting to connect to ws://localhost:3002 (attempt {retry_count + 1}/{max_retries})")
            websocket_connection = await asyncio.wait_for(
                websockets.connect("ws://localhost:3002"),
                timeout=5.0  # 5 second timeout
            )
            print("[WebSocket] ✅ Connected to signaling server successfully")
            retry_count = 0  # Reset on successful connection
            
            async for message in websocket_connection:
                try:
                    data = json.loads(message)
                    message_type = data.get('type')
                    
                    print(f"[WebSocket] 📥 Received message type: {message_type}")
                    
                    if message_type == 'audio_stream':
                        print(f"[WebSocket] Processing audio_stream message")
                        handle_audio_stream(data.get('data', {}))
                    elif message_type == 'audio_chunk':
                        print(f"[WebSocket] Processing audio_chunk message")
                        handle_audio_chunk(data.get('data', {}))
                    else:
                        print(f"[WebSocket] Unknown message type: {message_type}")
                        
                except json.JSONDecodeError as e:
                    print(f"[WebSocket] ❌ JSON decode error: {e}")
                except Exception as e:
                    print(f"[WebSocket] ❌ Message processing error: {e}")
                    
        except websockets.exceptions.ConnectionClosed:
            print(f"[WebSocket] 🔌 Connection closed, retrying... ({retry_count + 1}/{max_retries})")
            retry_count += 1
            if retry_count < max_retries:
                await asyncio.sleep(2)
        except asyncio.TimeoutError:
            print(f"[WebSocket] ⏰ Connection timeout (attempt {retry_count + 1}/{max_retries})")
            print("[WebSocket] Make sure the signaling server is running on port 3002")
            retry_count += 1
            if retry_count < max_retries:
                await asyncio.sleep(2)
        except (ConnectionRefusedError, OSError) as e:
            print(f"[WebSocket] ❌ Connection refused: {e}")
            print("[WebSocket] Make sure the signaling server is running on port 3002")
            retry_count += 1
            if retry_count < max_retries:
                await asyncio.sleep(2)
        except Exception as e:
            print(f"[WebSocket] ❌ Unexpected error: {e}")
            retry_count += 1
            if retry_count < max_retries:
                await asyncio.sleep(2)
            else:
                print("[WebSocket] ⚠️  Max retries reached, audio transport disabled")
                break

def handle_audio_stream(audio_data):
    """Process incoming audio stream from Mediasoup"""
    room_id = audio_data.get('roomId')
    timestamp = audio_data.get('timestamp')
    producer_id = audio_data.get('producerId')
    rtp_timestamp = audio_data.get('rtpTimestamp')
    sequence_number = audio_data.get('sequenceNumber')
    payload_type = audio_data.get('payloadType')
    audio_buffer = audio_data.get('audioBuffer')
    
    # Only log occasionally to avoid spam
    if sequence_number and sequence_number % 100 == 0:
        print(f"[Audio Stream] Room {room_id}, Producer {producer_id}, RTP seq {sequence_number}, payload {len(audio_buffer) if audio_buffer else 0} bytes")
    
    if not audio_buffer:
        return
        
    try:
        # Decode base64 audio data
        audio_bytes = base64.b64decode(audio_buffer)
        
        # Create audio directory if it doesn't exist
        audio_dir = os.path.join(os.path.dirname(__file__), 'audio_recordings')
        os.makedirs(audio_dir, exist_ok=True)
        
        # Save audio chunks to files (for debugging/analysis)
        if sequence_number % 500 == 0:  # Save every 500th packet for analysis
            audio_file = os.path.join(audio_dir, f"audio_{room_id}_{producer_id}_{timestamp}.raw")
            with open(audio_file, "wb") as f:
                f.write(audio_bytes)
            print(f"[Audio Stream] Saved audio chunk to {audio_file}")
        
        # Here you can add more audio processing:
        # 1. Convert to different formats (WAV, MP3, etc.)
        # 2. Apply speech-to-text processing
        # 3. Real-time audio analysis
        # 4. Forward to other services
        # 5. Store metadata in database
        
        # Example: Add to processing queue for speech-to-text
        # process_speech_to_text(audio_bytes, room_id, timestamp)  # Commented out until room_audio_processor is defined
        
    except Exception as e:
        print(f"[Audio Stream] Error processing audio data: {e}")

def handle_audio_chunk(audio_data):
    """Process incoming audio chunk from Mediasoup with improved room-based processing"""
    room_id = audio_data.get('roomId')
    producer_id = audio_data.get('producerId')
    timestamp = audio_data.get('timestamp')
    audio_buffer = audio_data.get('audioBuffer')
    chunk_count = audio_data.get('chunkCount', 0)
    
    print(f"[Audio Chunk] 🎤 Room {room_id}, Producer {producer_id}, {chunk_count} packets, {len(audio_buffer) if audio_buffer else 0} bytes")
    
    if not audio_buffer:
        print(f"[Audio Chunk] ⚠️  No audio buffer received for room {room_id}")
        return
        
    try:
        # Decode base64 audio data
        audio_bytes = base64.b64decode(audio_buffer)
        print(f"[Audio Chunk] 📊 Decoded {len(audio_bytes)} bytes of audio data")
        
        # Create audio directory if it doesn't exist (for backup saves)
        audio_dir = os.path.join(os.path.dirname(__file__), 'audio_recordings')
        os.makedirs(audio_dir, exist_ok=True)
        
        # Save audio chunks to files (for debugging/analysis)
        audio_file = os.path.join(audio_dir, f"chunk_{room_id}_{producer_id}_{timestamp}.raw")
        with open(audio_file, "wb") as f:
            f.write(audio_bytes)
        print(f"[Audio Chunk] 💾 Saved {len(audio_bytes)} bytes to {audio_file}")
        
        # Prepare audio data for room processor
        audio_item = {
            'room_id': room_id,
            'producer_id': producer_id,
            'timestamp': timestamp,
            'audio_bytes': audio_bytes,
            'chunk_count': chunk_count
        }
        
        # Add to appropriate room queue for processing (if room_audio_processor is available)
        try:
            success = room_audio_processor.add_audio_chunk(audio_item)
            
            if success:
                print(f"[Audio Queue] ✅ Added audio chunk to room {room_id} queue")
            else:
                print(f"[Audio Queue] ❌ Failed to add audio chunk to room {room_id} queue")
        except NameError:
            print(f"[Audio Queue] ⚠️  room_audio_processor not yet initialized, processing directly")
            # Process directly if room processor not available yet
            process_speech_to_text(audio_bytes, room_id, timestamp)
        
    except Exception as e:
        print(f"[Audio Chunk] ❌ Error processing audio data: {e}")
        import traceback
        traceback.print_exc()



def process_speech_to_text(audio_bytes, room_id, timestamp):
    """Optional: Process audio for speech-to-text conversion"""
    try:
        # This is where you'd integrate with speech-to-text services
        # Examples: Google Speech-to-Text, Azure Speech, AWS Transcribe, OpenAI Whisper
        
        # For now, just log that we received audio data
        print(f"[Speech-to-Text] Processing {len(audio_bytes)} bytes for room {room_id} at {timestamp}")
        
        # Example integration with OpenAI Whisper (requires openai-whisper package):
        # import whisper
        # model = whisper.load_model("base")
        # # Convert audio_bytes to appropriate format for Whisper
        # result = model.transcribe(audio_file_path)
        # transcription = result["text"]
        # print(f"[Speech-to-Text] Transcription: {transcription}")
        
    except Exception as e:
        print(f"[Speech-to-Text] Error: {e}")

def start_websocket_client():
    """Start WebSocket client in background thread"""
    try:
        # Create new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Run the WebSocket connection
        loop.run_until_complete(connect_to_signaling_server())
        
    except Exception as e:
        print(f"[WebSocket Thread] Error: {e}")
    finally:
        # Clean up the loop
        try:
            loop.close()
        except:
            pass

# Start WebSocket client when Flask starts (with error handling)
try:
    websocket_thread = threading.Thread(target=start_websocket_client, daemon=True)
    websocket_thread.start()
    print("[WebSocket] Background thread started")
except Exception as e:
    print(f"[WebSocket] Failed to start background thread: {e}")
    print("[WebSocket] Audio transport will be disabled")

# Per-room audio processing system
class RoomAudioProcessor:
    def __init__(self):
        self.room_queues = {}  # room_id -> queue.Queue()
        self.room_threads = {}  # room_id -> threading.Thread
        self.room_locks = defaultdict(threading.Lock)  # room_id -> Lock for thread safety
        self.active_rooms = set()  # Track active rooms
        self.shutdown_event = threading.Event()
        
        # Audio buffering for accumulating chunks before transcription
        self.room_audio_buffers = defaultdict(lambda: {
            'chunks': [],
            'total_bytes': 0,
            'last_chunk_time': 0,
            'first_chunk_time': None,
            'producer_id': None
        })
        
        # Buffering configuration - optimized for Whisper's 30-second sweet spot
        self.MIN_BUFFER_SIZE = 500000    # Minimum 500KB for substantial audio content
        self.MAX_BUFFER_SIZE = 1500000   # Maximum 1.5MB buffer (about 30+ seconds of audio)
        self.BUFFER_TIMEOUT = 30.0       # 30 seconds timeout to match Whisper's optimal length
        self.MIN_AUDIO_DURATION = 10.0   # Minimum 10 seconds of audio for good transcription
        self.WHISPER_OPTIMAL_DURATION = 30.0  # Whisper's optimal duration
        self.MIN_CHUNK_COUNT = 500       # Minimum 500 chunks before processing
        self.FORCE_PROCESS_TIMEOUT = 45.0 # Force processing after 45 seconds regardless of size
        
    def get_or_create_room_queue(self, room_id):
        """Get existing queue for room or create new one with dedicated thread"""
        if room_id not in self.room_queues:
            with self.room_locks[room_id]:
                # Double-check pattern to avoid race conditions
                if room_id not in self.room_queues:
                    # Create queue for this room
                    self.room_queues[room_id] = queue.Queue(maxsize=50)  # Limit queue size
                    
                    # Create and start dedicated thread for this room
                    thread = threading.Thread(
                        target=self._process_room_queue,
                        args=(room_id,),
                        name=f"AudioProcessor-{room_id}",
                        daemon=True
                    )
                    self.room_threads[room_id] = thread
                    self.active_rooms.add(room_id)
                    thread.start()
                    
                    print(f"[Audio Processor] Created new queue and thread for room {room_id}")
        
        return self.room_queues[room_id]
    
    def add_audio_chunk(self, audio_data):
        """Add audio chunk to appropriate room queue"""
        room_id = audio_data.get('room_id')
        if not room_id:
            print("[Audio Processor] ❌ Error: No room_id in audio data")
            return False
            
        try:
            room_queue = self.get_or_create_room_queue(room_id)
            
            # Add to queue with timeout to prevent blocking
            room_queue.put(audio_data, timeout=1.0)
            
            # Log every addition to see activity
            queue_size = room_queue.qsize()
            print(f"[Audio Processor] 📥 Added chunk to room {room_id} queue (size: {queue_size})")
                
            return True
            
        except queue.Full:
            print(f"[Audio Processor] ⚠️  Warning: Room {room_id} queue is full, dropping audio chunk")
            return False
        except Exception as e:
            print(f"[Audio Processor] ❌ Error adding audio chunk for room {room_id}: {e}")
            return False
    
    def _process_room_queue(self, room_id):
        """Background thread to process audio queue for specific room"""
        print(f"[Audio Processor] Started processing thread for room {room_id}")
        
        room_queue = self.room_queues[room_id]
        consecutive_empty_polls = 0
        max_empty_polls = 600  # 60 seconds of empty polls (0.1s * 600)
        
        while not self.shutdown_event.is_set():
            try:
                # Try to get audio item with timeout
                try:
                    audio_item = room_queue.get(timeout=0.1)
                    consecutive_empty_polls = 0  # Reset counter
                    
                    # Process the audio
                    self._process_audio_for_transcription(audio_item, room_id)
                    
                    # Mark task as done
                    room_queue.task_done()
                    
                except queue.Empty:
                    consecutive_empty_polls += 1
                    
                    # Clean up inactive room after period of inactivity
                    if consecutive_empty_polls >= max_empty_polls:
                        print(f"[Audio Processor] Room {room_id} inactive for 60s, shutting down thread")
                        break
                        
            except Exception as e:
                print(f"[Audio Processor] Error in room {room_id} processing thread: {e}")
                time.sleep(1)  # Brief pause on error
        
        # Cleanup when thread exits
        self._cleanup_room(room_id)
    
    def _process_audio_for_transcription(self, audio_item, room_id):
        """Process audio bytes for speech-to-text conversion using Whisper with buffering"""
        try:
            producer_id = audio_item.get('producer_id')
            timestamp = audio_item.get('timestamp')
            audio_bytes = audio_item.get('audio_bytes')
            chunk_count = audio_item.get('chunk_count', 1)
            
            print(f"[Transcription] 🎵 Room {room_id}: Received {len(audio_bytes)} bytes from producer {producer_id}")
            
            # Check file size limit for individual chunks
            if len(audio_bytes) > MAX_AUDIO_FILE_SIZE:
                print(f"[Transcription] ❌ Room {room_id}: Audio chunk too large ({len(audio_bytes)} bytes), skipping")
                return
            
            # Get or create buffer for this room
            buffer_key = f"{room_id}_{producer_id}"
            buffer = self.room_audio_buffers[buffer_key]
            
            # Add chunk to buffer
            buffer['chunks'].append({
                'data': audio_bytes,
                'timestamp': timestamp,
                'size': len(audio_bytes)
            })
            buffer['total_bytes'] += len(audio_bytes)
            buffer['last_chunk_time'] = timestamp
            buffer['producer_id'] = producer_id
            
            # Set first chunk time if not set
            if buffer['first_chunk_time'] is None:
                buffer['first_chunk_time'] = timestamp
            
            print(f"[Audio Buffer] 📊 Room {room_id}: Buffer now has {len(buffer['chunks'])} chunks, {buffer['total_bytes']} bytes")
            
            # Check if we should process the buffer
            current_time = timestamp
            time_since_first = (current_time - buffer['first_chunk_time']) / 1000.0  # Convert to seconds
            
            # Whisper-optimized decision logic
            should_process = False
            reason = ""
            
            # Primary: Optimal duration for Whisper (30 seconds)
            if time_since_first >= self.WHISPER_OPTIMAL_DURATION and buffer['total_bytes'] >= 100000:
                should_process = True
                reason = f"Whisper optimal duration ({time_since_first:.1f}s >= {self.WHISPER_OPTIMAL_DURATION}s, {buffer['total_bytes']} bytes)"
            
            # Secondary: Large enough for meaningful transcription
            elif buffer['total_bytes'] >= self.MIN_BUFFER_SIZE:
                should_process = True
                reason = f"sufficient audio data ({buffer['total_bytes']} >= {self.MIN_BUFFER_SIZE})"
            
            # Force processing for very large buffers
            elif buffer['total_bytes'] >= self.MAX_BUFFER_SIZE:
                should_process = True
                reason = f"max buffer size ({buffer['total_bytes']} >= {self.MAX_BUFFER_SIZE})"
            
            # Minimum meaningful duration + substantial data
            elif time_since_first >= self.MIN_AUDIO_DURATION and buffer['total_bytes'] >= 200000:
                should_process = True
                reason = f"minimum meaningful duration ({time_since_first:.1f}s, {buffer['total_bytes']} bytes)"
            
            # Force processing to prevent infinite accumulation
            elif time_since_first >= self.FORCE_PROCESS_TIMEOUT:
                should_process = True
                reason = f"forced timeout ({time_since_first:.1f}s >= {self.FORCE_PROCESS_TIMEOUT}s)"
            
            # Large chunk accumulation (substantial real audio)
            elif len(buffer['chunks']) >= self.MIN_CHUNK_COUNT and buffer['total_bytes'] >= 300000:
                should_process = True
                reason = f"substantial chunk accumulation ({len(buffer['chunks'])} chunks, {buffer['total_bytes']} bytes)"
            
            if should_process:
                estimated_audio_duration = buffer['total_bytes'] / (48000 * 2)  # Rough estimate
                print(f"[Audio Buffer] 🚀 Room {room_id}: PROCESSING BUFFER - {reason}")
                print(f"[Audio Buffer] 📈 Room {room_id}: Stats - {len(buffer['chunks'])} chunks, est_audio: {estimated_audio_duration:.1f}s")
                self._process_buffered_audio(buffer_key, room_id, buffer)
                
                # Clear the buffer after processing
                self.room_audio_buffers[buffer_key] = {
                    'chunks': [],
                    'total_bytes': 0,
                    'last_chunk_time': timestamp,
                    'first_chunk_time': None,
                    'producer_id': producer_id
                }
                print(f"[Audio Buffer] 🔄 Room {room_id}: Buffer cleared after processing")
            else:
                estimated_audio_duration = buffer['total_bytes'] / (48000 * 2)  # Rough estimate
                progress_optimal = (time_since_first / self.WHISPER_OPTIMAL_DURATION) * 100
                progress_size = (buffer['total_bytes'] / self.MIN_BUFFER_SIZE) * 100
                print(f"[Audio Buffer] ⏳ Room {room_id}: Accumulating for Whisper")
                print(f"[Audio Buffer] 📊 Room {room_id}: Progress - Time: {time_since_first:.1f}s/{self.WHISPER_OPTIMAL_DURATION}s ({progress_optimal:.1f}%), Size: {buffer['total_bytes']}/{self.MIN_BUFFER_SIZE} ({progress_size:.1f}%), Est Audio: {estimated_audio_duration:.1f}s")
                
        except Exception as e:
            print(f"[Transcription] ❌ Room {room_id}: Error: {e}")
            import traceback
            traceback.print_exc()
    
    def _process_buffered_audio(self, buffer_key, room_id, buffer):
        """Process accumulated audio buffer for transcription"""
        try:
            if not buffer['chunks']:
                print(f"[Audio Buffer] ⚠️  Room {room_id}: No chunks to process")
                return
            
            producer_id = buffer['producer_id']
            timestamp = buffer['last_chunk_time']
            
            # Combine all audio chunks into one buffer
            combined_audio = b''.join([chunk['data'] for chunk in buffer['chunks']])
            
            print(f"[Audio Buffer] 🔄 Room {room_id}: Processing combined buffer of {len(combined_audio)} bytes from {len(buffer['chunks'])} chunks")
            
            # Estimate audio duration (assuming 16-bit mono at 48kHz)
            estimated_duration = len(combined_audio) / (2 * 48000)  # 2 bytes per sample, 48kHz
            print(f"[Audio Buffer] ⏱️  Room {room_id}: Estimated audio duration: {estimated_duration:.2f} seconds")
            
            # Create temporary file for audio processing
            with tempfile.NamedTemporaryFile(suffix='.raw', delete=False) as temp_file:
                temp_file.write(combined_audio)
                temp_raw_path = temp_file.name
            
            print(f"[Audio Buffer] 💾 Room {room_id}: Created temp file: {temp_raw_path}")
            
            try:
                transcription = None
                whisper_result = None
                
                # Try Whisper transcription first
                if AI_INITIALIZED['whisper'] and AI_MODELS['whisper']:
                    print(f"[Audio Buffer] 🤖 Room {room_id}: Starting Whisper transcription...")
                    transcription, whisper_result = self._transcribe_with_whisper(temp_raw_path, room_id)
                    if transcription:
                        print(f"[Audio Buffer] ✅ Room {room_id}: Whisper transcription successful!")
                    else:
                        print(f"[Audio Buffer] ❌ Room {room_id}: Whisper transcription failed or returned no speech")
                else:
                    print(f"[Audio Buffer] ⚠️  Room {room_id}: Whisper not available")
                
                # Fallback to simulated transcription if Whisper fails or unavailable
                if not transcription:
                    transcription = f"[Simulated transcription for room {room_id} at {timestamp}]"
                    whisper_result = {"text": transcription, "language": "en", "segments": []}
                    print(f"[Transcription] 🔄 Room {room_id}: Using simulated transcription (Whisper unavailable or failed)")
                
                if transcription and len(transcription.strip()) > 10:
                    print(f"[Transcription] 🎉 Room {room_id} SUCCESS: '{transcription[:100]}{'...' if len(transcription) > 100 else ''}'")
                    
                    # Store transcription (both file and ChromaDB)
                    print(f"[Transcription] 💾 Room {room_id}: Storing transcription...")
                    store_transcription_metadata(room_id, producer_id, timestamp, transcription)
                    
                    # Store in ChromaDB for semantic search
                    if AI_INITIALIZED['chromadb'] and AI_INITIALIZED['embedding']:
                        print(f"[Transcription] 📚 Room {room_id}: Storing in ChromaDB...")
                        store_transcription_in_chromadb(room_id, producer_id, timestamp, transcription, whisper_result)
                    else:
                        print(f"[Transcription] ⚠️  Room {room_id}: ChromaDB not available for storage")
                else:
                    print(f"[Transcription] ⚠️  Room {room_id}: Skipped short/empty transcription")
                
                # Cleanup temporary files
                os.unlink(temp_raw_path)
                print(f"[Audio Buffer] 🧹 Room {room_id}: Cleaned up temp file")
                
            except Exception as e:
                print(f"[Transcription] ❌ Room {room_id}: Processing failed: {e}")
                import traceback
                traceback.print_exc()
                if os.path.exists(temp_raw_path):
                    os.unlink(temp_raw_path)
            
        except Exception as e:
            print(f"[Audio Buffer] ❌ Room {room_id}: Error processing buffer: {e}")
            import traceback
            traceback.print_exc()
    
    def _transcribe_with_whisper(self, audio_file_path, room_id):
        """Transcribe audio using Whisper with improved audio format handling (thread-safe)"""
        try:
            # Convert raw audio to WAV format for Whisper
            wav_path = audio_file_path.replace('.raw', '.wav')
            
            print(f"[Whisper] Room {room_id}: Converting {audio_file_path} to {wav_path}")
            
            # Analyze raw audio data first for debugging
            try:
                with open(audio_file_path, 'rb') as f:
                    raw_data = f.read()
                    
                print(f"[Whisper] Room {room_id}: Raw audio file size: {len(raw_data)} bytes")
                
                # Simple audio analysis - check for silence vs. actual content
                if len(raw_data) >= 200:  # At least 100 samples
                    import struct
                    # Read samples as 16-bit integers
                    sample_count = min(1000, len(raw_data) // 2)  # Check up to 1000 samples
                    samples = struct.unpack(f'<{sample_count}h', raw_data[:sample_count * 2])
                    
                    # Calculate comprehensive stats
                    max_amplitude = max(abs(s) for s in samples)
                    avg_amplitude = sum(abs(s) for s in samples) / len(samples)
                    non_zero_samples = sum(1 for s in samples if abs(s) > 100)
                    silence_samples = sum(1 for s in samples if abs(s) < 50)
                    
                    print(f"[Whisper] Room {room_id}: Audio analysis - Max: {max_amplitude}, Avg: {avg_amplitude:.1f}")
                    print(f"[Whisper] Room {room_id}: Audio content - Non-zero: {non_zero_samples}/{len(samples)}, Silence: {silence_samples}/{len(samples)}")
                    
                    # Estimate duration more accurately
                    total_samples = len(raw_data) // 2
                    duration_seconds = total_samples / 48000  # 48kHz
                    print(f"[Whisper] Room {room_id}: Audio duration: {duration_seconds:.2f} seconds ({total_samples} samples)")
                        
                else:
                    print(f"[Whisper] Room {room_id}: Raw audio too small for analysis ({len(raw_data)} bytes)")
                    
            except Exception as e:
                print(f"[Whisper] Room {room_id}: Audio analysis failed: {e}")
            
            # Try to handle both Opus-encoded and raw PCM data
            # First, try assuming it's Opus-encoded data from WebRTC
            opus_path = audio_file_path.replace('.raw', '.opus')
            
            # For potential Opus data, try FFmpeg Opus decoding first
            ffmpeg_opus_cmd = [
                'ffmpeg', 
                '-i', audio_file_path,   # Input: assume it might be Opus in raw container
                '-ar', '16000',          # Resample to 16kHz for Whisper (optimal)
                '-ac', '1',              # Ensure mono output
                '-f', 'wav',             # Output format: WAV
                '-y',                    # Overwrite output file
                wav_path                 # Output file
            ]
            
            print(f"[Whisper] Room {room_id}: Trying Opus decode: {' '.join(ffmpeg_opus_cmd)}")
            result = subprocess.run(ffmpeg_opus_cmd, capture_output=True, text=True)
            
            # If Opus decoding fails, fall back to raw PCM interpretation
            if result.returncode != 0:
                print(f"[Whisper] Room {room_id}: Opus decoding failed, trying raw PCM fallback")
                print(f"[Whisper] Room {room_id}: FFmpeg Opus stderr: {result.stderr}")
                
                # Fallback: treat as raw 16-bit PCM at 48kHz
                ffmpeg_pcm_cmd = [
                    'ffmpeg', 
                    '-f', 's16le',        # Input format: 16-bit signed little endian
                    '-ar', '48000',       # Sample rate: 48kHz
                    '-ac', '1',           # Channels: mono
                    '-i', audio_file_path, # Input file
                    '-ar', '16000',       # Resample to 16kHz for Whisper
                    '-ac', '1',           # Ensure mono output
                    '-y',                 # Overwrite output file
                    wav_path              # Output file
                ]
                
                print(f"[Whisper] Room {room_id}: Running FFmpeg (Raw PCM): {' '.join(ffmpeg_pcm_cmd)}")
                result = subprocess.run(ffmpeg_pcm_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"[Whisper] Room {room_id}: FFmpeg failed with code {result.returncode}")
                print(f"[Whisper] Room {room_id}: FFmpeg stderr: {result.stderr}")
                return None, None
            
            # Check if WAV file was created and has meaningful content for Whisper
            if not os.path.exists(wav_path):
                print(f"[Whisper] Room {room_id}: WAV file was not created")
                return None, None
                
            wav_size = os.path.getsize(wav_path)
            
            # Calculate minimum WAV size for meaningful transcription
            # For 16kHz mono WAV: 1 second ≈ 32KB, 10 seconds ≈ 320KB, 30 seconds ≈ 960KB
            min_wav_size_absolute = 32000       # 1 second (minimum)
            
            if wav_size < min_wav_size_absolute:
                print(f"[Whisper] Room {room_id}: WAV file too small ({wav_size} bytes < {min_wav_size_absolute}), insufficient for transcription")
                os.unlink(wav_path)
                return None, None
                
            # Estimate audio duration from WAV file size (16kHz mono = ~32KB/second)
            estimated_duration = (wav_size - 44) / (16000 * 2)  # Remove WAV header, 16kHz 16-bit mono
            print(f"[Whisper] Room {room_id}: WAV conversion successful ({wav_size} bytes, ~{estimated_duration:.1f}s)")
            
            # Thread-safe Whisper transcription
            with whisper_lock:
                print(f"[Whisper] Room {room_id}: Acquiring Whisper lock...")
                
                if not AI_MODELS['whisper']:
                    print(f"[Whisper] Room {room_id}: Model not available")
                    if os.path.exists(wav_path):
                        os.unlink(wav_path)
                    return None, None
                
                print(f"[Whisper] Room {room_id}: Starting transcription with Whisper...")
                
                # Use Whisper to transcribe with optimized settings for real speech
                result = AI_MODELS['whisper'].transcribe(
                    wav_path,
                    language='en',           # Set to English, change as needed
                    task="transcribe",       # Task: transcribe (not translate)
                    fp16=False,             # Use FP32 for better compatibility
                    verbose=True,           # Enable verbose for better debugging
                    condition_on_previous_text=False,  # Don't use previous context
                    temperature=0.0,        # Deterministic output
                    compression_ratio_threshold=2.4,  # Default threshold
                    logprob_threshold=-1.0, # Default threshold
                    no_speech_threshold=0.6, # More sensitive to speech (lowered from 0.8)
                    word_timestamps=True,   # Get word-level timestamps
                    # Don't use initial_prompt to avoid biasing toward synthetic content
                )
                
                transcription = result.get("text", "").strip()
                language = result.get("language", "en")
                no_speech_prob = result.get("no_speech_prob", 1.0)
                segments = result.get("segments", [])
                
                print(f"[Whisper] Room {room_id}: Released Whisper lock")
                print(f"[Whisper] Room {room_id}: Transcription result:")
                print(f"[Whisper] Room {room_id}:   - Language detected: {language}")
                print(f"[Whisper] Room {room_id}:   - No speech probability: {no_speech_prob:.3f}")
                print(f"[Whisper] Room {room_id}:   - Raw text: '{transcription}'")
                print(f"[Whisper] Room {room_id}:   - Text length: {len(transcription)} chars")
                print(f"[Whisper] Room {room_id}:   - Segments found: {len(segments)}")
                
                # Clean up WAV file
                os.unlink(wav_path)
                
                # Improved speech detection logic
                has_meaningful_speech = False
                
                # Check 1: If no_speech_prob is reasonably low
                if no_speech_prob < 0.7:  # Reasonable threshold
                    has_meaningful_speech = True
                    print(f"[Whisper] Room {room_id}: Speech detected based on no_speech_prob: {no_speech_prob:.3f}")
                
                # Check 2: Filter out obvious synthetic/repetitive content
                if transcription and len(transcription.strip()) > 0:
                    # Check for repetitive patterns that indicate synthetic content
                    words = transcription.lower().split()
                    if len(words) > 5:
                        # Count word repetitions
                        word_counts = {}
                        for word in words:
                            word_counts[word] = word_counts.get(word, 0) + 1
                        
                        # Check if any single word dominates (indicates repetitive synthetic content)
                        max_word_count = max(word_counts.values())
                        repetition_ratio = max_word_count / len(words)
                        
                        # Check for the specific "teacher" pattern we've been seeing
                        teacher_patterns = ['teacher', 'he is a teacher', 'not a teacher']
                        has_teacher_pattern = any(pattern in transcription.lower() for pattern in teacher_patterns)
                        
                        if repetition_ratio > 0.6:  # More than 60% repetition
                            print(f"[Whisper] Room {room_id}: REJECTED - High repetition detected ({repetition_ratio:.1f})")
                            has_meaningful_speech = False
                        elif has_teacher_pattern and repetition_ratio > 0.3:
                            print(f"[Whisper] Room {room_id}: REJECTED - Synthetic 'teacher' pattern detected")
                            has_meaningful_speech = False
                        else:
                            has_meaningful_speech = True
                            print(f"[Whisper] Room {room_id}: Speech accepted - low repetition ({repetition_ratio:.1f})")
                    else:
                        has_meaningful_speech = True  # Short text, probably real
                
                # Check 3: If we have segments with reasonable confidence
                if segments and len(segments) > 0:
                    confident_segments = [s for s in segments if s.get('no_speech_prob', 1.0) < 0.8]
                    if confident_segments:
                        print(f"[Whisper] Room {room_id}: Found {len(confident_segments)} confident segments")
                        if not has_meaningful_speech:  # Give segments a chance even if other checks failed
                            has_meaningful_speech = True
                
                if has_meaningful_speech:
                    print(f"[Whisper] Room {room_id}: Valid transcription found: '{transcription}'")
                    return transcription, result
                else:
                    print(f"[Whisper] Room {room_id}: No meaningful speech detected (no_speech_prob: {no_speech_prob:.3f})")
                    return None, None
                    
        except subprocess.CalledProcessError as e:
            print(f"[Whisper] Room {room_id}: FFmpeg conversion failed: {e}")
            if os.path.exists(wav_path):
                os.unlink(wav_path)
            return None, None
        except Exception as e:
            print(f"[Whisper] Room {room_id}: Error during transcription: {e}")
            if os.path.exists(wav_path):
                os.unlink(wav_path)
            return None, None
    
    def _cleanup_room(self, room_id):
        """Clean up resources for a room"""
        try:
            with self.room_locks[room_id]:
                if room_id in self.room_queues:
                    # Process any remaining items in queue
                    room_queue = self.room_queues[room_id]
                    remaining_items = []
                    
                    try:
                        while True:
                            item = room_queue.get_nowait()
                            remaining_items.append(item)
                    except queue.Empty:
                        pass
                    
                    if remaining_items:
                        print(f"[Audio Processor] Processing {len(remaining_items)} remaining items for room {room_id}")
                        for item in remaining_items:
                            self._process_audio_for_transcription(item, room_id)
                    
                    # Process any remaining buffered audio for this room
                    buffers_to_process = []
                    for buffer_key in list(self.room_audio_buffers.keys()):
                        if buffer_key.startswith(f"{room_id}_"):
                            buffer = self.room_audio_buffers[buffer_key]
                            if buffer['chunks'] and buffer['total_bytes'] > 5000:  # Process if > 5KB
                                buffers_to_process.append((buffer_key, buffer))
                    
                    for buffer_key, buffer in buffers_to_process:
                        print(f"[Audio Processor] Processing remaining buffer for {buffer_key}")
                        self._process_buffered_audio(buffer_key, room_id, buffer)
                        del self.room_audio_buffers[buffer_key]
                    
                    # Remove room from tracking
                    del self.room_queues[room_id]
                    if room_id in self.room_threads:
                        del self.room_threads[room_id]
                    if room_id in self.active_rooms:
                        self.active_rooms.remove(room_id)
                    
                    print(f"[Audio Processor] Cleaned up resources for room {room_id}")
                    
        except Exception as e:
            print(f"[Audio Processor] Error cleaning up room {room_id}: {e}")
    
    def get_room_stats(self):
        """Get statistics about active rooms and queues"""
        stats = {}
        for room_id in self.active_rooms:
            if room_id in self.room_queues:
                queue_size = self.room_queues[room_id].qsize()
                thread_alive = self.room_threads[room_id].is_alive() if room_id in self.room_threads else False
                stats[room_id] = {
                    "queue_size": queue_size,
                    "thread_active": thread_alive
                }
        return stats
    
    def shutdown(self):
        """Gracefully shutdown all processing threads"""
        print("[Audio Processor] Shutting down all room processors...")
        self.shutdown_event.set()
        
        # Wait for all threads to finish (copy items to avoid dictionary change during iteration)
        thread_items = list(self.room_threads.items())
        for room_id, thread in thread_items:
            if thread.is_alive():
                print(f"[Audio Processor] Waiting for room {room_id} thread to finish...")
                thread.join(timeout=5.0)
                if thread.is_alive():
                    print(f"[Audio Processor] Warning: Room {room_id} thread did not shut down gracefully")

# Create global room processor instance
room_audio_processor = RoomAudioProcessor()

# Add graceful shutdown handling early
atexit.register(room_audio_processor.shutdown)

def store_transcription_metadata(room_id, producer_id, timestamp, transcription):
    """Store transcription metadata (simplified version)"""
    try:
        from datetime import datetime
        
        # Create transcription directory if it doesn't exist
        transcript_dir = os.path.join(os.path.dirname(__file__), 'transcriptions')
        os.makedirs(transcript_dir, exist_ok=True)
        
        # Save transcription to file
        transcript_file = os.path.join(transcript_dir, f"transcript_{room_id}_{timestamp}.txt")
        with open(transcript_file, 'w', encoding='utf-8') as f:
            f.write(f"Room: {room_id}\n")
            f.write(f"Producer: {producer_id}\n")
            f.write(f"Timestamp: {timestamp}\n")
            f.write(f"DateTime: {datetime.fromtimestamp(timestamp / 1000).isoformat()}\n")
            f.write(f"Text: {transcription}\n")
        
        print(f"[Transcription Storage] Saved to {transcript_file}")
        
    except Exception as e:
        print(f"[Transcription Storage] Error: {e}")

# Models
class Student(db.Model):
    student_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, unique=True, nullable=False)
    class_ = db.Column('class', db.Text)
    college = db.Column(db.Text)
    password_hash = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class Teacher(db.Model):
    teacher_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, unique=True, nullable=False)
    institution = db.Column(db.Text)
    password_hash = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class Class(db.Model):
    class_id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.Text)
    teacher_id = db.Column(db.Integer, db.ForeignKey('teacher.teacher_id'))
    target_class = db.Column(db.Text)
    institution_name = db.Column(db.Text)
    start_time = db.Column(db.DateTime)
    end_time = db.Column(db.DateTime)
    room_id = db.Column(db.String(36), default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

# JWT helper
def encode_auth_token(user_id, user_type, email):
    print('DEBUG SECRET_KEY (encode):', app.config['SECRET_KEY'])
    payload = {
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=1),
        'iat': datetime.datetime.utcnow(),
        'sub': str(user_id),  # Ensure subject is a string
        'type': user_type,
        'email': email
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token

def decode_auth_token(token):
    print('DEBUG SECRET_KEY (decode):', app.config['SECRET_KEY'])
    print('DEBUG token type:', type(token))
    print('DEBUG token repr:', repr(token))
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        print('DEBUG: Token expired')
        return None
    except jwt.InvalidTokenError as e:
        print('DEBUG: Invalid token:', str(e))
        return None

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.error(f"Unhandled Exception: {str(e)}", exc_info=True)
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    app.logger.warning(f"404 Not Found: {request.path}")
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(400)
def bad_request(e):
    app.logger.warning(f"400 Bad Request: {request.data}")
    return jsonify({'error': 'Bad request'}), 400

# Registration endpoints
@app.route('/register/student', methods=['POST'])
def register_student():
    try:
        data = request.json
        if not data or not all(k in data for k in ('name', 'email', 'password')):
            app.logger.warning('Student registration missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        if Student.query.filter_by(email=data['email']).first():
            app.logger.warning(f"Student registration duplicate email: {data['email']}")
            return jsonify({'error': 'Email already exists'}), 409
        hashed_pw = generate_password_hash(data['password'])
        student = Student(name=data['name'], email=data['email'], class_=data.get('class'), college=data.get('college'), password_hash=hashed_pw)
        db.session.add(student)
        db.session.commit()
        app.logger.info(f"Student registered: {data['email']}")
        return jsonify({'message': 'Student registered successfully.'}), 201
    except Exception as e:
        app.logger.error(f"Student registration error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Registration failed'}), 500

@app.route('/register/teacher', methods=['POST'])
def register_teacher():
    try:
        data = request.json
        if not data or not all(k in data for k in ('name', 'email', 'password')):
            app.logger.warning('Teacher registration missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        if Teacher.query.filter_by(email=data['email']).first():
            app.logger.warning(f"Teacher registration duplicate email: {data['email']}")
            return jsonify({'error': 'Email already exists'}), 409
        hashed_pw = generate_password_hash(data['password'])
        teacher = Teacher(name=data['name'], email=data['email'], institution=data.get('institution'), password_hash=hashed_pw)
        db.session.add(teacher)
        db.session.commit()
        app.logger.info(f"Teacher registered: {data['email']}")
        return jsonify({'message': 'Teacher registered successfully.'}), 201
    except Exception as e:
        app.logger.error(f"Teacher registration error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Registration failed'}), 500

# Login endpoints
@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.json
        print('DEBUG login payload:', data)
        if not data or not all(k in data for k in ('email', 'password')):
            app.logger.warning('Login missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        # Try student first
        user = Student.query.filter_by(email=data['email']).first()
        role = None
        if user and check_password_hash(user.password_hash, data['password']):
            role = 'student'
        else:
            # Try teacher
            user = Teacher.query.filter_by(email=data['email']).first()
            if user and check_password_hash(user.password_hash, data['password']):
                role = 'teacher'
        if role:
            token = encode_auth_token(user.student_id if role == 'student' else user.teacher_id, role, user.email)
            print('DEBUG login token:', token)
            app.logger.info(f"Login success: {data['email']} as {role}")
            return jsonify({'token': token, 'role': role, 'name': user.name}), 200
        app.logger.warning(f"Login failed: {data['email']}")
        return jsonify({'error': 'Invalid credentials'}), 401
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Login failed'}), 500

# Protected route example
@app.route('/classes', methods=['POST'])
def create_class():
    try:
        token = request.headers.get('Authorization')
        print('DEBUG token:', token)
        if token and token.startswith('Bearer '):
            token = token.split(' ', 1)[1]
        payload = decode_auth_token(token)
        print('DEBUG payload:', payload)
        if not payload or payload['type'] != 'teacher':
            app.logger.warning('Unauthorized class creation attempt')
            return jsonify({'error': 'Unauthorized'}), 401
        data = request.json
        if not data or not all(k in data for k in ('title', 'start_time', 'end_time')):
            app.logger.warning('Class creation missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        # Robust datetime parsing
        try:
            start_time = parser.isoparse(data['start_time'])
            end_time = parser.isoparse(data['end_time'])
        except Exception as dt_err:
            app.logger.error(f"Datetime parse error: {str(dt_err)}")
            return jsonify({'error': 'Invalid date format'}), 400
        new_class = Class(
            title=data['title'],
            teacher_id=payload['sub'],
            target_class=data.get('target_class'),
            institution_name=data.get('institution_name'),
            start_time=start_time,
            end_time=end_time
        )
        db.session.add(new_class)
        db.session.commit()
        app.logger.info(f"Class created: {data['title']} by teacher {payload['email']}")
        return jsonify({'message': 'Class created', 'room_id': new_class.room_id}), 201
    except Exception as e:
        app.logger.error(f"Class creation error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Class creation failed'}), 500

@app.route('/students', methods=['GET'])
def get_students():
    students = Student.query.all()
    return jsonify({'students': [
        {
            'student_id': s.student_id,
            'name': s.name,
            'email': s.email,
            'class': s.class_,
            'college': s.college,
            'created_at': s.created_at
            # ❌ REMOVED: password_hash for security
        } for s in students
    ]})

@app.route('/teachers', methods=['GET'])
def get_teachers():
    teachers = Teacher.query.all()
    return jsonify({'teachers': [
        {
            'teacher_id': t.teacher_id,
            'name': t.name,
            'email': t.email,
            'institution': t.institution,
            'created_at': t.created_at
        } for t in teachers
    ]})

@app.route('/classes', methods=['GET'])
def get_classes():
    class_ = request.args.get('class')
    institution = request.args.get('institution')
    query = Class.query
    if class_:
        query = query.filter_by(target_class=class_)
    if institution:
        query = query.filter_by(institution_name=institution)
    classes = query.all()
    return jsonify({'classes': [
        {
            'class_id': c.class_id,
            'title': c.title,
            'teacher_id': c.teacher_id,
            'target_class': c.target_class,
            'institution_name': c.institution_name,
            'start_time': c.start_time,
            'end_time': c.end_time,
            'room_id': c.room_id,
            'created_at': c.created_at
        } for c in classes
    ]})

@app.route('/students/me', methods=['GET'])
def get_student_me():
    token = request.headers.get('Authorization')
    if token and token.startswith('Bearer '):
        token = token.split(' ', 1)[1]
    payload = decode_auth_token(token)
    if not payload or payload['type'] != 'student':
        return jsonify({'error': 'Unauthorized'}), 401
    student = Student.query.filter_by(email=payload['email']).first()
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    return jsonify({
        'student_id': student.student_id,
        'name': student.name,
        'email': student.email,
        'class': student.class_,
        'college': student.college,
        'created_at': student.created_at
    })


def cleanup_old_audio_files():
    """Clean up old audio files to prevent disk space issues"""
    try:
        audio_dir = os.path.join(os.path.dirname(__file__), 'audio_recordings')
        if not os.path.exists(audio_dir):
            return
            
        # Get all audio files with their timestamps
        audio_files = []
        for filename in os.listdir(audio_dir):
            if filename.endswith('.raw'):
                filepath = os.path.join(audio_dir, filename)
                stat = os.stat(filepath)
                audio_files.append({
                    'path': filepath,
                    'filename': filename,
                    'mtime': stat.st_mtime,
                    'size': stat.st_size
                })
        
        # Group by room and cleanup if needed
        room_files = {}
        for file_info in audio_files:
            # Extract room_id from filename pattern: chunk_room-id_producer_timestamp.raw
            parts = file_info['filename'].split('_')
            if len(parts) >= 2:
                room_id = parts[1]
                if room_id not in room_files:
                    room_files[room_id] = []
                room_files[room_id].append(file_info)
        
        # Cleanup each room's files
        total_cleaned = 0
        for room_id, files in room_files.items():
            # Sort by modification time (oldest first)
            files.sort(key=lambda x: x['mtime'])
            
            # Remove excess files if more than limit
            if len(files) > MAX_AUDIO_FILES_PER_ROOM:
                files_to_remove = files[:-MAX_AUDIO_FILES_PER_ROOM]
                for file_info in files_to_remove:
                    try:
                        os.unlink(file_info['path'])
                        total_cleaned += 1
                        print(f"[Cleanup] Removed old audio file: {file_info['filename']}")
                    except Exception as e:
                        print(f"[Cleanup] Error removing {file_info['filename']}: {e}")
        
        if total_cleaned > 0:
            print(f"[Cleanup] Cleaned up {total_cleaned} old audio files")
            
    except Exception as e:
        print(f"[Cleanup] Error during audio file cleanup: {e}")

def schedule_audio_cleanup():
    """Schedule periodic cleanup of audio files"""
    cleanup_old_audio_files()
    # Schedule next cleanup
    threading.Timer(AUDIO_CLEANUP_INTERVAL, schedule_audio_cleanup).start()

# Start audio file cleanup scheduler
schedule_audio_cleanup()

# WebSocket connection to signaling server
@app.route('/test_transcription', methods=['POST'])
def test_transcription():
    """Trigger a test transcription to verify the pipeline"""
    try:
        print("[Test Transcription] 🧪 Test transcription endpoint called")
        
        # Send a request to the signaling server's test endpoint
        import requests
        response = requests.post('http://localhost:3001/test-audio-with-speech', 
                               json={
                                   'roomId': 'test-room-flask-debug',
                                   'producerId': 'test-producer-debug',
                                   'text': 'This is a test of the improved audio buffering system for Whisper transcription.',
                                   'chunkCount': 150  # Simulate enough chunks for 3+ seconds
                               })
        
        if response.status_code == 200:
            result = response.json()
            print(f"[Test Transcription] ✅ Test audio sent successfully: {result}")
            return jsonify({
                "success": True,
                "message": "Test audio sent to signaling server",
                "details": result
            })
        else:
            print(f"[Test Transcription] ❌ Failed to send test audio: {response.status_code}")
            return jsonify({
                "success": False,
                "error": f"Signaling server returned {response.status_code}",
                "details": response.text
            }), 500
            
    except Exception as e:
        print(f"[Test Transcription] ❌ Error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/audio_diagnostics', methods=['GET'])
def get_audio_diagnostics():
    """Get comprehensive audio processing diagnostics"""
    try:
        room_id = request.args.get('room_id')
        
        # Get room processor stats
        room_stats = room_audio_processor.get_room_stats()
        
        # Get buffer stats
        buffer_stats = {}
        for buffer_key, buffer in room_audio_processor.room_audio_buffers.items():
            if not room_id or buffer_key.startswith(f"{room_id}_"):
                buffer_stats[buffer_key] = {
                    "chunk_count": len(buffer['chunks']),
                    "total_bytes": buffer['total_bytes'],
                    "first_chunk_time": buffer['first_chunk_time'],
                    "last_chunk_time": buffer['last_chunk_time'],
                    "producer_id": buffer['producer_id'],
                    "estimated_duration_seconds": buffer['total_bytes'] / (48000 * 2) if buffer['total_bytes'] > 0 else 0
                }
        
        # Get recent audio files
        audio_dir = os.path.join(os.path.dirname(__file__), 'audio_recordings')
        recent_files = []
        if os.path.exists(audio_dir):
            for filename in sorted(os.listdir(audio_dir))[-20:]:  # Last 20 files
                if filename.endswith('.raw'):
                    filepath = os.path.join(audio_dir, filename)
                    stat = os.stat(filepath)
                    recent_files.append({
                        "filename": filename,
                        "size_bytes": stat.st_size,
                        "modified_time": stat.st_mtime,
                        "estimated_duration_seconds": stat.st_size / (48000 * 2) if stat.st_size > 0 else 0
                    })
        
        # Get recent transcriptions
        transcript_dir = os.path.join(os.path.dirname(__file__), 'transcriptions')
        recent_transcriptions = []
        if os.path.exists(transcript_dir):
            transcript_files = []
            for filename in os.listdir(transcript_dir):
                if filename.endswith('.txt') and (not room_id or room_id in filename):
                    filepath = os.path.join(transcript_dir, filename)
                    stat = os.stat(filepath)
                    transcript_files.append((filename, stat.st_mtime))
            
            # Sort by modification time and take last 10
            for filename, _ in sorted(transcript_files, key=lambda x: x[1])[-10:]:
                recent_transcriptions.append(filename)
        
        return jsonify({
            "room_processor_stats": room_stats,
            "audio_buffer_stats": buffer_stats,
            "recent_audio_files": recent_files,
            "recent_transcriptions": recent_transcriptions,
            "ai_status": {
                "whisper_available": AI_INITIALIZED.get('whisper', False),
                "chromadb_available": AI_INITIALIZED.get('chromadb', False),
                "embedding_available": AI_INITIALIZED.get('embedding', False)
            },
            "buffer_config": {
                "min_buffer_size": room_audio_processor.MIN_BUFFER_SIZE,
                "max_buffer_size": room_audio_processor.MAX_BUFFER_SIZE,
                "optimal_duration": room_audio_processor.WHISPER_OPTIMAL_DURATION,
                "force_timeout": room_audio_processor.FORCE_PROCESS_TIMEOUT
            }
        })
        
    except Exception as e:
        print(f"[Audio Diagnostics] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/room_stats', methods=['GET'])
def get_room_stats():
    """Get statistics about active room processors"""
    try:
        stats = room_audio_processor.get_room_stats()
        return jsonify({
            "active_rooms": len(stats),
            "room_details": stats,
            "total_active_rooms": len(room_audio_processor.active_rooms)
        })
        
    except Exception as e:
        print(f"[Room Stats] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/transcriptions/<room_id>', methods=['GET'])
def get_room_transcriptions(room_id):
    """Get transcriptions for a specific room"""
    try:
        transcript_dir = os.path.join(os.path.dirname(__file__), 'transcriptions')
        
        if not os.path.exists(transcript_dir):
            return jsonify({"transcriptions": []})
        
        transcriptions = []
        for filename in os.listdir(transcript_dir):
            if filename.startswith(f"transcript_{room_id}_") and filename.endswith('.txt'):
                filepath = os.path.join(transcript_dir, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                        
                    # Parse the transcription file
                    lines = content.strip().split('\n')
                    transcript_data = {}
                    for line in lines:
                        if ':' in line:
                            key, value = line.split(':', 1)
                            transcript_data[key.strip().lower()] = value.strip()
                    
                    transcriptions.append({
                        "filename": filename,
                        "room_id": transcript_data.get('room', room_id),
                        "producer_id": transcript_data.get('producer'),
                        "timestamp": transcript_data.get('timestamp'),
                        "datetime": transcript_data.get('datetime'),
                        "text": transcript_data.get('text', '')
                    })
                    
                except Exception as e:
                    print(f"[Transcriptions] Error reading {filename}: {e}")
        
        # Sort by timestamp
        transcriptions.sort(key=lambda x: int(x.get('timestamp', 0)))
        
        return jsonify({
            "room_id": room_id,
            "transcription_count": len(transcriptions),
            "transcriptions": transcriptions
        })
        
    except Exception as e:
        print(f"[Transcriptions] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/query', methods=['POST'])
def query_transcriptions():
    """Query endpoint for LLM to retrieve relevant transcriptions (thread-safe)"""
    try:
        data = request.get_json()
        query = data.get('query', '')
        room_id = data.get('room_id')  # Optional: filter by room
        limit = data.get('limit', 5)
        
        if not query:
            return jsonify({"error": "Query is required"}), 400
        
        if not AI_INITIALIZED['chromadb'] or not AI_INITIALIZED['embedding']:
            return jsonify({"error": "AI models not available for querying"}), 503
        
        # Thread-safe operations
        with chromadb_lock:
            print("[Query] Acquiring ChromaDB lock for query...")
            
            # Generate embedding for the query
            with embedding_lock:
                query_embedding = AI_MODELS['embedding_model'].encode(query)
            
            # Build where clause for filtering
            where_clause = {}
            if room_id:
                where_clause["room_id"] = room_id
            
            # Query ChromaDB
            results = AI_MODELS['chromadb_collection'].query(
                query_embeddings=[query_embedding.tolist()],
                n_results=limit,
                where=where_clause if where_clause else None,
                include=["documents", "metadatas", "distances"]
            )
            
            print("[Query] Released ChromaDB lock")
        
        # Format results (this part doesn't need locking)
        formatted_results = []
        if results['documents'] and results['documents'][0]:
            for i, doc in enumerate(results['documents'][0]):
                metadata = results['metadatas'][0][i]
                distance = results['distances'][0][i]
                
                formatted_results.append({
                    "text": doc,
                    "metadata": metadata,
                    "similarity_score": 1 - distance,  # Convert distance to similarity
                    "timestamp": metadata.get("datetime"),
                    "room_id": metadata.get("room_id"),
                    "producer_id": metadata.get("producer_id")
                })
        
        return jsonify({
            "query": query,
            "results": formatted_results,
            "total_found": len(formatted_results)
        })
        
    except Exception as e:
        print(f"[Query] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/ai_status', methods=['GET'])
def get_ai_status():
    """Get status of all AI models and their availability"""
    return jsonify({
        "whisper": {
            "available": WHISPER_AVAILABLE,
            "initialized": AI_INITIALIZED.get('whisper', False),
            "model_loaded": AI_MODELS.get('whisper') is not None
        },
        "chromadb": {
            "available": CHROMADB_AVAILABLE,
            "initialized": AI_INITIALIZED.get('chromadb', False),
            "client_ready": AI_MODELS.get('chromadb_client') is not None,
            "collection_ready": AI_MODELS.get('chromadb_collection') is not None
        },
        "sentence_transformers": {
            "available": SENTENCE_TRANSFORMERS_AVAILABLE,
            "initialized": AI_INITIALIZED.get('embedding', False),
            "model_loaded": AI_MODELS.get('embedding_model') is not None
        },
        "numpy": {
            "available": NUMPY_AVAILABLE
        }
    })

# WebSocket connection status
websocket_started = False

@app.route('/start_websocket', methods=['POST'])
def start_websocket_endpoint():
    """Manually restart WebSocket connection (for debugging/recovery)"""
    global websocket_started, websocket_thread
    try:
        print("[WebSocket] 🔄 Manual WebSocket restart requested")
        
        # Reset the connection state
        websocket_started = False
        
        # Start new connection
        start_websocket_delayed()
        websocket_started = True
        
        return jsonify({'message': 'WebSocket connection restarted successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': f'Failed to restart WebSocket: {e}'}), 500

@app.route('/websocket_status', methods=['GET'])
def websocket_status():
    """Check WebSocket connection status"""
    global websocket_connection, websocket_started
    return jsonify({
        'websocket_started': websocket_started,
        'websocket_connected': websocket_connection is not None,
        'connection_state': 'connected' if websocket_connection else 'disconnected'
    })

def start_websocket_delayed():
    """Start WebSocket connection after Flask is fully initialized"""
    global websocket_thread
    try:
        websocket_thread = threading.Thread(target=start_websocket_client, daemon=True)
        websocket_thread.start()
        print("[WebSocket] Background thread started (delayed)")
    except Exception as e:
        print(f"[WebSocket] Failed to start background thread: {e}")
        print("[WebSocket] Audio transport will be disabled")

if __name__ == '__main__':
    # Create database tables
    with app.app_context():
        db.create_all()
        print("[Database] Tables created/verified")
    
    # Initialize AI models before starting the app
    print("[AI] Starting AI model initialization...")
    initialize_ai_models()
    
    # Auto-start WebSocket connection (with delay to avoid Python 3.13 issues)
    def delayed_websocket_start():
        """Start WebSocket after Flask is fully initialized"""
        time.sleep(1)  # Brief delay to ensure Flask is ready
        global websocket_started
        if not websocket_started:
            try:
                start_websocket_delayed()
                websocket_started = True
                print("[WebSocket] 🔗 Auto-started WebSocket connection")
            except Exception as e:
                print(f"[WebSocket] ❌ Auto-start failed: {e}")
                print("[WebSocket] Use POST /start_websocket to start manually")
    
    # Start WebSocket in background after Flask initialization
    websocket_auto_thread = threading.Thread(target=delayed_websocket_start, daemon=True)
    websocket_auto_thread.start()
    
    # Run Flask app
    print("[Flask] Starting server...")
    app.run(host='0.0.0.0', port=5000, debug=False)


