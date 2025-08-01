import React from 'react';
import { useParams, useLocation } from 'react-router-dom';
import VideoComponent from '../components/VideoComponent';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

const Classroom = () => {
  const { classId } = useParams();
  const query = useQuery();
  const role = query.get('role');
  const studentName = query.get('name');
  // classId is now roomId
  const roomId = classId;

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: 24 }}>
      <h1 style={{ color: '#4f46e5' }}>Classroom</h1>
      <VideoComponent sessionId={roomId} role={role} studentName={studentName} />
    </div>
  );
};

export default Classroom;
