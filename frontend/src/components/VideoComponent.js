import React, { useEffect, useRef } from 'react';
import { useMediasoup } from '../hooks/useMediasoup';

const VideoComponent = ({ sessionId, role, studentName }) => {
    // sessionId is now the roomId
    const roomId = sessionId;
    const localVideoRef = useRef();
    const remoteVideoRef = useRef();

    // 2. Initialize Mediasoup once roomId is available
    const { localStream, remoteStream, start, joinedStudents } = useMediasoup(roomId, role, studentName);

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
        <div>
            <h2>Video Session</h2>
            <button onClick={() => { console.log('[VideoComponent] Start button clicked as', role); start(); }}>
                Start as {role}
            </button>
            {role === 'teacher' && joinedStudents && (
                <div style={{ margin: '16px 0', background: '#f3f4f6', padding: 12, borderRadius: 6 }}>
                    <strong>Students Joined:</strong>
                    <ul>
                        {joinedStudents.length === 0 && <li>No students joined yet.</li>}
                        {joinedStudents.map((name, idx) => <li key={idx}>{name}</li>)}
                    </ul>
                </div>
            )}
            {role === 'teacher' && (
                <>
                  <h3>Local Video</h3>
                  <video ref={localVideoRef} autoPlay muted playsInline />
                </>
            )}
            <h3>Remote Video</h3>
            <video ref={remoteVideoRef} autoPlay playsInline />
        </div>
    );
};

export default VideoComponent;