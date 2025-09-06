import React, { useEffect, useRef } from 'react';
import { useMediasoup } from '../hooks/useMediasoup';
import ChatComponent from './ChatComponent';

const VideoComponent = ({ sessionId, role, studentName }) => {
    // sessionId is now the roomId
    const roomId = sessionId;
    const localVideoRef = useRef();
    const remoteVideoRef = useRef();

    // 2. Initialize Mediasoup once roomId is available
    const { 
        localStream, 
        remoteStream, 
        start, 
        joinedStudents, 
        messages, 
        typingUsers, 
        sendMessage, 
        sendTyping,
        videoEnabled,
        audioEnabled,
        toggleVideo,
        toggleAudio,
        endStream
    } = useMediasoup(roomId, role, studentName);

    // Debug: log props and roomId
    useEffect(() => {
        console.log('[VideoComponent] Mounted with props:', { sessionId, role, studentName });
        console.log('[VideoComponent] Using roomId:', roomId);
        return () => {
            console.log('[VideoComponent] Unmounted');
        };
    }, []);

    // 3. Connect streams to video elements
    useEffect(() => {
        if (localStream && localVideoRef.current) {
            console.log('[VideoComponent] Setting localStream', localStream);
            localVideoRef.current.srcObject = localStream;
            // Log local video track state
            const tracks = localStream.getVideoTracks();
            if (tracks.length > 0) {
                const track = tracks[0];
                console.log('[VideoComponent] local video track state:', {
                    id: track.id,
                    kind: track.kind,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState
                });
            } else {
                console.log('[VideoComponent] No video tracks in localStream');
            }
            // Log local video element size and style
            const rect = localVideoRef.current.getBoundingClientRect();
            const style = window.getComputedStyle(localVideoRef.current);
            console.log('[VideoComponent] local video element size:', rect.width, rect.height, 'display:', style.display, 'visibility:', style.visibility);
            // Listen for video events
            const video = localVideoRef.current;
            const onPlaying = () => console.log('[VideoComponent] local video is playing');
            const onLoadedData = () => console.log('[VideoComponent] local video loaded data');
            video.addEventListener('playing', onPlaying);
            video.addEventListener('loadeddata', onLoadedData);
            return () => {
                video.removeEventListener('playing', onPlaying);
                video.removeEventListener('loadeddata', onLoadedData);
            };
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteStream && remoteVideoRef.current) {
            console.log('[VideoComponent] Setting remoteStream', remoteStream);
            remoteVideoRef.current.srcObject = remoteStream;
            // Log srcObject and video element
            console.log('[VideoComponent] remoteVideoRef video element after srcObject set:', remoteVideoRef.current);
            console.log('[VideoComponent] remoteVideoRef.srcObject:', remoteVideoRef.current.srcObject);
            // Log tracks state
            const tracks = remoteStream.getVideoTracks();
            if (tracks.length > 0) {
                const track = tracks[0];
                console.log('[VideoComponent] remote video track state:', {
                    id: track.id,
                    kind: track.kind,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState
                });
            } else {
                console.log('[VideoComponent] No video tracks in remoteStream');
            }
            // Try to force play and catch errors
            remoteVideoRef.current.play().then(() => {
                console.log('[VideoComponent] remote video play() success');
            }).catch(e => {
                console.error('[VideoComponent] remote video play() error:', e);
            });
        }
    }, [remoteStream]);

    useEffect(() => {
        if (remoteStream) {
            console.log('[VideoComponent] remoteStream tracks:', remoteStream.getTracks());
        }
    }, [remoteStream]);

    useEffect(() => {
        console.log('[VideoComponent] joinedStudents updated:', joinedStudents);
    }, [joinedStudents]);

    useEffect(() => {
        if (localVideoRef.current) {
            console.log('[VideoComponent] localVideoRef video element:', localVideoRef.current);
        }
    }, [localVideoRef]);

    useEffect(() => {
        if (remoteVideoRef.current) {
            console.log('[VideoComponent] remoteVideoRef video element:', remoteVideoRef.current);
        }
    }, [remoteVideoRef]);
    
    useEffect(() => {
        if (remoteStream && remoteVideoRef.current) {
            // Log video element size and style
            const rect = remoteVideoRef.current.getBoundingClientRect();
            const style = window.getComputedStyle(remoteVideoRef.current);
            console.log('[VideoComponent] remote video element size:', rect.width, rect.height, 'display:', style.display, 'visibility:', style.visibility);
            // Listen for video events
            const video = remoteVideoRef.current;
            const onPlaying = () => console.log('[VideoComponent] remote video is playing');
            const onLoadedData = () => console.log('[VideoComponent] remote video loaded data');
            video.addEventListener('playing', onPlaying);
            video.addEventListener('loadeddata', onLoadedData);
            return () => {
                video.removeEventListener('playing', onPlaying);
                video.removeEventListener('loadeddata', onLoadedData);
            };
        }
    }, [remoteStream]);

    if (!roomId) {
        return <div>Loading room...</div>;
    }

    return (
        <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 120px)' }}>
            {/* Video Section */}
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: '16px' }}>
                    <h2>Video Session - {role.charAt(0).toUpperCase() + role.slice(1)}</h2>
                    <button 
                        onClick={() => { 
                            console.log('[VideoComponent] Start button clicked as', role); 
                            start(); 
                        }}
                        style={{
                            backgroundColor: '#007bff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '12px 24px',
                            fontSize: '16px',
                            cursor: 'pointer',
                            marginBottom: '16px'
                        }}
                    >
                        Start as {role}
                    </button>
                </div>

                {role === 'teacher' && joinedStudents && (
                    <div style={{ 
                        margin: '16px 0', 
                        background: '#f8f9fa', 
                        padding: '12px', 
                        borderRadius: '8px',
                        border: '1px solid #e9ecef'
                    }}>
                        <strong>Students Joined ({joinedStudents.length}):</strong>
                        {joinedStudents.length === 0 ? (
                            <p style={{ margin: '8px 0', color: '#6c757d' }}>No students joined yet.</p>
                        ) : (
                            <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                                {joinedStudents.map((name, idx) => (
                                    <li key={idx} style={{ margin: '4px 0' }}>{name}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* Video Elements */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                    {role === 'teacher' && (
                        <div>
                            <h3 style={{ margin: '0 0 8px 0' }}>Your Video (Local)</h3>
                            <video 
                                ref={localVideoRef} 
                                autoPlay 
                                muted 
                                playsInline 
                                style={{
                                    width: '100%',
                                    maxWidth: '500px',
                                    height: 'auto',
                                    backgroundColor: '#000',
                                    borderRadius: '8px'
                                }}
                            />
                            {/* Control Buttons for Teacher */}
                            <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                                <button onClick={toggleVideo} style={{ padding: '8px 16px' }}>
                                    {videoEnabled ? 'Disable Video' : 'Enable Video'}
                                </button>
                                <button onClick={toggleAudio} style={{ padding: '8px 16px' }}>
                                    {audioEnabled ? 'Disable Audio' : 'Enable Audio'}
                                </button>
                                <button onClick={endStream} style={{ padding: '8px 16px', color: 'white', background: 'red' }}>
                                    End Stream
                                </button>
                            </div>
                        </div>
                    )}
                    
                    <div>
                        <h3 style={{ margin: '0 0 8px 0' }}>
                            {role === 'teacher' ? 'Student View (Remote)' : 'Teacher Video (Remote)'}
                        </h3>
                        <video 
                            ref={remoteVideoRef} 
                            autoPlay 
                            playsInline 
                            style={{
                                width: '100%',
                                maxWidth: '500px',
                                height: 'auto',
                                backgroundColor: '#000',
                                borderRadius: '8px'
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Chat Section */}
            <div style={{ flex: 1, minWidth: '350px', maxWidth: '400px' }}>
                <ChatComponent
                    messages={messages}
                    typingUsers={typingUsers}
                    onSendMessage={sendMessage}
                    onTyping={sendTyping}
                    currentUserRole={role}
                    currentUserName={role === 'teacher' ? 'Teacher' : studentName || 'Student'}
                />
            </div>
        </div>
    );
};

export default VideoComponent;