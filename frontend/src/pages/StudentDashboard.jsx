import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = 'http://localhost:5000';

const StudentDashboard = () => {
  const [upcomingClasses, setUpcomingClasses] = useState([]);
  const [recentResources, setRecentResources] = useState([]); // Placeholder for future resource API
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [studentClass, setStudentClass] = useState('');
  const [studentInstitution, setStudentInstitution] = useState('');
  const [studentName, setStudentName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStudentInfoAndClasses = async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        // Fetch student info
        const infoRes = await fetch(`${API_URL}/students/me`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const infoData = await infoRes.json();
        if (!infoRes.ok) throw new Error(infoData.error || 'Failed to fetch student info');
        setStudentClass(infoData.class);
        setStudentInstitution(infoData.college);
        setStudentName(infoData.name);
        // Fetch classes filtered by class and institution
        const res = await fetch(`${API_URL}/classes?class=${encodeURIComponent(infoData.class)}&institution=${encodeURIComponent(infoData.college)}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch classes');
        setUpcomingClasses(data.classes || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchStudentInfoAndClasses();
  }, []);

  const handleLogout = () => {
    localStorage.clear();
    navigate('/');
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      {/* Header */}
      <div style={{ background: "#6366f1", color: "#fff", padding: "24px 0", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: "bold" }}>Student Dashboard</h1>
            <p style={{ color: "#c7d2fe", marginTop: 4 }}>Welcome back!</p>
            {studentClass && studentInstitution && (
              <p style={{ color: "#c7d2fe", marginTop: 4 }}>
                Class: {studentClass} | Institution: {studentInstitution}
              </p>
            )}
          </div>
          <button style={{ background: "#4f46e5", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 4, cursor: "pointer" }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
      <div style={{ maxWidth: 1200, margin: "24px auto", padding: 24 }}>
        {/* Error/Loading */}
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: 'red' }}>{error}</div>}
        {/* Upcoming Classes */}
        <div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: "bold", color: "#6366f1", marginBottom: 12 }}>Upcoming Classes</h2>
          {upcomingClasses.length === 0 && !loading ? <div>No classes found.</div> : null}
          {upcomingClasses.map((classItem) => (
            <div key={classItem.class_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <div style={{ fontWeight: "bold" }}>{classItem.title}</div>
                <div style={{ fontSize: 14, color: "#6b7280" }}>{classItem.start_time} - {classItem.end_time}</div>
              </div>
              <div>
                <span style={{ background: "#22c55e", color: "#fff", borderRadius: 4, padding: "4px 8px", marginRight: 8 }}>{classItem.room_id}</span>
                <button style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }} onClick={() => navigate(`/classroom/${classItem.room_id}?role=student&name=${encodeURIComponent(studentName)}`)}>
                  Join Class
                </button>
              </div>
            </div>
          ))}
        </div>
        {/* Video Component - Shown when a class is selected */}
        {/* {selectedClassId && (
          <VideoComponent sessionId={selectedClassId} role="student" studentName={studentName} />
        )} */}
        {/* Recent Resources can be implemented similarly */}
      </div>
    </div>
  );
};

export default StudentDashboard;