import { useState, useRef } from 'react';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';

export const useMediasoup = (roomId, role, studentName = null) => {
    const [status, setStatus] = useState('Idle');
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [joinedStudents, setJoinedStudents] = useState([]); // For teacher: list of joined students
    const [messages, setMessages] = useState([]); // Chat messages
    const [typingUsers, setTypingUsers] = useState([]); // Users currently typing
    const socketRef = useRef(null);
    const deviceRef = useRef(null);
    const producerRef = useRef(null);
    const consumerRefs = useRef({ video: null, audio: null });
    const tracksRef = useRef({ video: null, audio: null });

    // Video/audio enable/disable state
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [audioEnabled, setAudioEnabled] = useState(true);

    // Helper to send requests to the server
    const request = (event, data = {}) => {
        console.log('[useMediasoup] Sending request:', event, data);
        return new Promise((resolve, reject) => {
            socketRef.current.emit(event, data, (responseData) => {
                if (responseData?.error) {
                    console.error(`[useMediasoup] Error in response to ${event}:`, responseData.error);
                    reject(new Error(responseData.error));
                } else {
                    console.log(`[useMediasoup] Response to ${event}:`, responseData);
                    resolve(responseData);
                }
            });
        });
    };

    // Chat functions
    const sendMessage = (message) => {
        console.log('[useMediasoup] Sending message:', message);
        return new Promise((resolve, reject) => {
            if (!socketRef.current) {
                reject(new Error('Socket not connected'));
                return;
            }
            socketRef.current.emit('send-message', { message }, (response) => {
                if (response?.error) {
                    console.error('[useMediasoup] Error sending message:', response.error);
                    reject(new Error(response.error));
                } else {
                    console.log('[useMediasoup] Message sent successfully:', response);
                    resolve(response);
                }
            });
        });
    };

    const sendTyping = (isTyping) => {
        if (socketRef.current) {
            socketRef.current.emit('typing', { isTyping });
        }
    };

    const fetchChatHistory = async () => {
        try {
            console.log('[useMediasoup] Fetching chat history for room:', roomId);
            const response = await fetch(`http://localhost:5000/chat/messages/${roomId}`);
            if (response.ok) {
                const data = await response.json();
                console.log('[useMediasoup] Chat history fetched:', data);
                setMessages(data.messages || []);
            } else {
                console.error('[useMediasoup] Failed to fetch chat history:', response.statusText);
            }
        } catch (error) {
            console.error('[useMediasoup] Error fetching chat history:', error);
        }
    };

    const start = async () => {
        console.log('[useMediasoup] start() called with', { roomId, role, studentName });
        if (!roomId || !role) {
            setStatus('Missing roomId or role');
            return;
        }
        setStatus(`Connecting as ${role}...`);
        // Pass studentName in query if role is student
        const query = { roomId, role };
        if (role === 'student' && studentName) query.studentName = studentName;
        console.log('[useMediasoup] Connecting socket.io with query:', query);
        const socket = io('localhost:3001', { query });
        socketRef.current = socket;
        await new Promise(resolve => socket.on('connect', () => {
            console.log('[useMediasoup] Socket connected:', socket.id);
            resolve();
        }));
        setStatus('Connected to server');
        
        // Chat event listeners
        socket.on('new-message', (messageData) => {
            console.log('[useMediasoup] new-message received:', messageData);
            setMessages(prev => [...prev, messageData]);
        });

        socket.on('user-typing', (typingData) => {
            console.log('[useMediasoup] user-typing received:', typingData);
            const { senderName, isTyping } = typingData;
            setTypingUsers(prev => {
                if (isTyping) {
                    return prev.includes(senderName) ? prev : [...prev, senderName];
                } else {
                    return prev.filter(name => name !== senderName);
                }
            });
        });

        // Fetch chat history after connecting
        await fetchChatHistory();
        
        // Listen for student join events (for teacher)
        if (role === 'teacher') {
            socket.on('student-joined', (name) => {
                console.log('[useMediasoup] student-joined event received:', name);
                setJoinedStudents(prev => prev.includes(name) ? prev : [...prev, name]);
            });
        }
        socket.on('disconnect', () => {
            console.log('[useMediasoup] Socket disconnected');
        });
        const routerRtpCapabilities = await request('getRouterRtpCapabilities');
        console.log('[useMediasoup] Router RTP Capabilities:', routerRtpCapabilities);
        const device = new Device();
        await device.load({ routerRtpCapabilities });
        deviceRef.current = device;
        if (role === 'teacher') {
            await startTeacher(device);
        } else {
            await startStudent(device);
        }
    };

    const startTeacher = async (device) => {
        setStatus('Getting camera access...');
        console.log('[useMediasoup] startTeacher: requesting user media');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        setStatus('Creating producers...');
        const transportData = await request('createTransport', { isProducer: true });
        console.log('[useMediasoup] Producer transport data:', transportData);
        const producerTransport = device.createSendTransport(transportData);
        producerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            console.log('[useMediasoup] Producer transport connect event', dtlsParameters);
            request('connectTransport', { transportId: producerTransport.id, dtlsParameters })
                .then(callback).catch(errback);
        });
        producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            console.log('[useMediasoup] Producer transport produce event', kind, rtpParameters);
            try {
                const { id } = await request('produce', { kind, rtpParameters });
                callback({ id });
            } catch (err) {
                errback(err);
            }
        });
        producerTransport.on('connectionstatechange', state => {
            setStatus(`Producer transport state: ${state}`);
            console.log('[useMediasoup] Producer transport state:', state);
        });
        // Video
        const videoTrack = stream.getVideoTracks()[0];
        const videoProducer = await producerTransport.produce({ track: videoTrack, appData: { mediaTag: 'video' } });
        // Audio
        const audioTrack = stream.getAudioTracks()[0];
        const audioProducer = await producerTransport.produce({ track: audioTrack, appData: { mediaTag: 'audio' } });
        producerRef.current = { videoProducer, audioProducer };
        setStatus('Producers created');
        console.log('[useMediasoup] Producers created:', { videoProducer, audioProducer });
        // Listen for new-producer event
        socketRef.current.on('new-producer', () => {
            console.log('[useMediasoup] new-producer event received');
            if (videoProducer && typeof videoProducer.requestKeyFrame === 'function') {
                videoProducer.requestKeyFrame();
            }
        });
    };

    const startStudent = async (device) => {
        setStatus('Creating consumer transport...');
        console.log('[useMediasoup] startStudent: creating consumer transport');
        const transportData = await request('createTransport', { isProducer: false });
        console.log('[useMediasoup] Consumer transport data:', transportData);
        const consumerTransport = device.createRecvTransport(transportData);
        consumerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            console.log('[useMediasoup] Consumer transport connect event', dtlsParameters);
            request('connectTransport', { transportId: consumerTransport.id, dtlsParameters })
                .then(callback).catch(errback);
        });
        consumerTransport.on('connectionstatechange', state => {
            setStatus(`Consumer transport state: ${state}`);
            console.log('[useMediasoup] Consumer transport state:', state);
        });
        // Consume tracks
        const consumeTrack = async (kind) => {
            try {
                if (consumerRefs.current[kind]) {
                    consumerRefs.current[kind].close();
                    consumerRefs.current[kind] = null;
                }
                setStatus(`Requesting ${kind} consumer...`);
                console.log(`[useMediasoup] Requesting ${kind} consumer`);
                const { rtpCapabilities } = device;
                const consumerData = await request('consume', { kind, rtpCapabilities });
                if (consumerData.error) {
                    setStatus(`Waiting for ${kind} track...`);
                    console.warn(`[useMediasoup] Waiting for ${kind} track...`);
                    setTimeout(() => consumeTrack(kind), 2000);
                    return;
                }
                const consumer = await consumerTransport.consume(consumerData);
                consumerRefs.current[kind] = consumer;
                tracksRef.current[kind] = consumer.track;
                setStatus(`${kind} consumer created`);
                console.log(`[useMediasoup] ${kind} consumer created`, consumer);
                await request('resume', { consumerId: consumer.id });
                return consumer;
            } catch (err) {
                setStatus(`Consume ${kind} error: ${err.message}`);
                console.error(`[useMediasoup] Consume ${kind} error:`, err);
                setTimeout(() => consumeTrack(kind), 2000);
            }
        };
        // Setup consumers
        const setupConsumers = async () => {
            await consumeTrack('video');
            await consumeTrack('audio');
            const stream = new MediaStream();
            if (tracksRef.current.video) stream.addTrack(tracksRef.current.video);
            if (tracksRef.current.audio) stream.addTrack(tracksRef.current.audio);
            setRemoteStream(stream);
            console.log('[useMediasoup] Remote stream set', stream);
        };
        socketRef.current.on('new-producer', setupConsumers);
        await setupConsumers();
        // Notify teacher of join (if not handled by server already)
        if (studentName) {
            console.log('[useMediasoup] Emitting student-joined event for', studentName);
            socketRef.current.emit('student-joined', studentName);
        }
    };

    // Toggle video
    const toggleVideo = () => {
        if (producerRef.current?.videoProducer) {
            const enabled = !videoEnabled;
            producerRef.current.videoProducer.track.enabled = enabled;
            setVideoEnabled(enabled);
        }
    };

    // Toggle audio
    const toggleAudio = () => {
        if (producerRef.current?.audioProducer) {
            const enabled = !audioEnabled;
            producerRef.current.audioProducer.track.enabled = enabled;
            setAudioEnabled(enabled);
        }
    };

    // End stream
    const endStream = () => {
        if (producerRef.current?.videoProducer) {
            producerRef.current.videoProducer.close();
        }
        if (producerRef.current?.audioProducer) {
            producerRef.current.audioProducer.close();
        }
        setStatus('Stream ended');
    };

    return { 
        status, 
        localStream, 
        remoteStream, 
        start, 
        joinedStudents, 
        messages, 
        typingUsers, 
        sendMessage, 
        sendTyping,
        fetchChatHistory,
        videoEnabled,
        audioEnabled,
        toggleVideo,
        toggleAudio,
        endStream
    };
};