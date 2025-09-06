import React, { useEffect, useState } from 'react';

const PdfViewerComponent = () => {
  const [pdfs, setPdfs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPdfs = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('http://localhost:5000/pdfs');
      const data = await response.json();
      if (data.success) {
        setPdfs(data.files);
      } else {
        setError(data.error || 'Failed to fetch PDFs.');
      }
    } catch (err) {
      setError('Failed to fetch PDFs.');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPdfs();
  }, []);

  return (
    <div style={{ border: '1px solid #ccc', padding: 16, borderRadius: 8 }}>
      <h3>Available PDF Notes</h3>
      {loading && <div>Loading...</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {!loading && !error && pdfs.length === 0 && <div>No PDF notes available.</div>}
      <ul>
        {pdfs.map((file, idx) => (
          <li key={idx} style={{ margin: '8px 0' }}>
            <a href={`http://localhost:5000/pdf/${file}`} target="_blank" rel="noopener noreferrer">{file}</a>
          </li>
        ))}
      </ul>
      <button onClick={fetchPdfs} style={{ marginTop: 8 }}>Refresh</button>
    </div>
  );
};

export default PdfViewerComponent;
