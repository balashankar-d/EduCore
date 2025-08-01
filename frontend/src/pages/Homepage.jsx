import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = 'http://localhost:5000';

const HomePage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        // Login (single endpoint)
        const res = await fetch(`${API_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.email, password: form.password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        localStorage.setItem('token', data.token);
        localStorage.setItem('role', data.role);
        localStorage.setItem('name', data.name);
        if (data.role === 'teacher') navigate('/teacher');
        else navigate('/student');
      } else {
        // Signup
        let endpoint, payload;
        if (form.role === 'teacher') {
          endpoint = '/register/teacher';
          payload = { name: form.name, email: form.email, password: form.password, institution: form.institution || '' };
        } else {
          endpoint = '/register/student';
          payload = { name: form.name, email: form.email, password: form.password, class: form.class || '', college: form.college || '' };
        }
        const res = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Signup failed');
        setIsLogin(true);
        setError('Signup successful! Please login.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 16px rgba(79,70,229,0.10)", padding: 40, minWidth: 350, maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", color: "#4f46e5", marginBottom: 8 }}>
            {isLogin ? 'Login' : 'Sign Up'}
          </h1>
          <p style={{ color: "#6b7280" }}>
            {isLogin ? 'Welcome back! Please login to your account.' : 'Create a new account to get started.'}
          </p>
        </div>
        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", marginBottom: 6, color: "#4f46e5", fontWeight: 500 }}>Name</label>
                <input name="name" type="text" placeholder="Your Name" value={form.name} onChange={handleChange} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e0e7ff", marginBottom: 4 }} required />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", marginBottom: 6, color: "#4f46e5", fontWeight: 500 }}>Role</label>
                <select name="role" value={form.role} onChange={handleChange} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e0e7ff" }} required>
                  <option value="student">Student</option>
                  <option value="teacher">Teacher</option>
                </select>
              </div>
              {form.role === 'teacher' && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", marginBottom: 6, color: "#4f46e5", fontWeight: 500 }}>Institution</label>
                  <input name="institution" type="text" placeholder="Institution Name" value={form.institution || ''} onChange={handleChange} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e0e7ff", marginBottom: 4 }} required />
                </div>
              )}
              {form.role === 'student' && (
                <>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", marginBottom: 6, color: "#4f46e5", fontWeight: 500 }}>Class</label>
                    <input name="class" type="text" placeholder="Class" value={form.class || ''} onChange={handleChange} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e0e7ff", marginBottom: 4 }} required />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", marginBottom: 6, color: "#4f46e5", fontWeight: 500 }}>College</label>
                    <input name="college" type="text" placeholder="College" value={form.college || ''} onChange={handleChange} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e0e7ff", marginBottom: 4 }} required />
                  </div>
                </>
              )}
            </>
          )}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 6, color: "#4f46e5", fontWeight: 500 }}>Email</label>
            <input name="email" type="email" placeholder="you@example.com" value={form.email} onChange={handleChange} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e0e7ff", marginBottom: 4 }} required />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", marginBottom: 6, color: "#4f46e5", fontWeight: 500 }}>Password</label>
            <input name="password" type="password" placeholder="Password" value={form.password} onChange={handleChange} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e0e7ff", marginBottom: 4 }} required />
          </div>
          {error && <div style={{ color: isLogin && error.startsWith('Signup') ? 'green' : 'red', marginBottom: 12, textAlign: 'center' }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width: "100%", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 6, padding: 12, fontWeight: "bold", fontSize: "1rem", cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 12 }}>
            {loading ? (isLogin ? 'Logging in...' : 'Signing up...') : (isLogin ? 'Login' : 'Sign Up')}
          </button>
        </form>
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <span style={{ color: "#6b7280" }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button
            style={{ background: "none", border: "none", color: "#4f46e5", fontWeight: "bold", cursor: "pointer", textDecoration: "underline" }}
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
          >
            {isLogin ? 'Sign Up' : 'Login'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HomePage;