import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
const API_URL = 'http://localhost:5000';

const TeacherDashboard = () => {
  const [scheduledClasses, setScheduledClasses] = useState([]);
  const [recentUploads, setRecentUploads] = useState([]); // Placeholder for future resource API
  const [stats, setStats] = useState([]); // Placeholder for future stats API
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', target_class: '', institution_name: '', start_time: '', end_time: '' });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchClasses = async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        // Example: fetch classes for teacher (endpoint to be implemented in backend)
        const res = await fetch(`${API_URL}/classes`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch classes');
        const data = await res.json();
        setScheduledClasses(data.classes || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchClasses();
  }, []);

  const handleFormChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleScheduleClass = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormLoading(true);
    try {
      const token = localStorage.getItem('token');
      // Convert datetime-local to ISO string
      const payload = {
        ...form,
        start_time: form.start_time ? new Date(form.start_time).toISOString() : '',
        end_time: form.end_time ? new Date(form.end_time).toISOString() : ''
      };
      const res = await fetch(`${API_URL}/classes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule class');
      setShowForm(false);
      setForm({ title: '', target_class: '', institution_name: '', start_time: '', end_time: '' });
      setScheduledClasses((prev) => [...prev, { ...form, room_id: data.room_id }]);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      {/* Header */}
      <div style={{ background: "#4f46e5", color: "#fff", padding: "24px 0", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: "bold" }}>Teacher Dashboard</h1>
            <p style={{ color: "#c7d2fe", marginTop: 4 }}>Welcome back!</p>
          </div>
          <button style={{ background: "#6366f1", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 4, cursor: "pointer" }} onClick={() => { localStorage.clear(); window.location.href = '/'; }}>
            Logout
          </button>
        </div>
      </div>
      <div style={{ maxWidth: 1200, margin: "24px auto", padding: 24 }}>
        {/* Error/Loading */}
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: 'red' }}>{error}</div>}
        {/* Scheduled Classes */}
        <div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: "bold", color: "#4f46e5", marginBottom: 12 }}>Scheduled Classes</h2>
          {scheduledClasses.length === 0 && !loading ? <div>No classes found.</div> : null}
          {scheduledClasses.map((classItem) => (
            <div key={classItem.class_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <div style={{ fontWeight: "bold" }}>{classItem.title}</div>
                <div style={{ fontSize: 14, color: "#6b7280" }}>{classItem.start_time} - {classItem.end_time}</div>
              </div>
              <div>
                <span style={{ background: "#6366f1", color: "#fff", borderRadius: 4, padding: "4px 8px", marginRight: 8 }}>{classItem.room_id}</span>
                <button style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer", marginRight: 8 }} onClick={() => navigate(`/classroom/${classItem.room_id}?role=teacher`)}>
                  Start Class
                </button>
                <button style={{ background: "#f3f4f6", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
        <button style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: "bold", marginBottom: 24, cursor: "pointer" }} onClick={() => setShowForm(true)}>
          Schedule New Class
        </button>
        {showForm && (
          <form onSubmit={handleScheduleClass} style={{ background: '#fff', padding: 24, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 'bold', color: '#4f46e5', marginBottom: 16 }}>Schedule a New Class</h3>
            <div style={{ marginBottom: 16 }}>
              <label>Title</label>
              <input name="title" type="text" value={form.title} onChange={handleFormChange} required style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #e0e7ff' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Target Class</label>
              <input name="target_class" type="text" value={form.target_class} onChange={handleFormChange} required style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #e0e7ff' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Institution Name</label>
              <input name="institution_name" type="text" value={form.institution_name} onChange={handleFormChange} required style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #e0e7ff' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Start Time</label>
              <input name="start_time" type="datetime-local" value={form.start_time} onChange={handleFormChange} required style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #e0e7ff' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>End Time</label>
              <input name="end_time" type="datetime-local" value={form.end_time} onChange={handleFormChange} required style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #e0e7ff' }} />
            </div>
            {formError && <div style={{ color: 'red', marginBottom: 12 }}>{formError}</div>}
            <button type="submit" disabled={formLoading} style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: 10, fontWeight: 'bold', fontSize: '1rem', cursor: formLoading ? 'not-allowed' : 'pointer' }}>
              {formLoading ? 'Scheduling...' : 'Schedule Class'}
            </button>
            <button type="button" style={{ marginLeft: 12, background: '#f3f4f6', color: '#4f46e5', border: 'none', borderRadius: 6, padding: 10, fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }} onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </form>
        )}
        {/* Recent Uploads and Stats can be implemented similarly */}
      </div>
    </div>
  );
};

export default TeacherDashboard;