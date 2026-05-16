import React, { useState, useEffect } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { fetchPhotoBlob } from '../services/driveService';

export default function DriveImage({ fileId, height = 120, style }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!fileId) return;
    let objectUrl;
    fetchPhotoBlob(fileId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => setError(true));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileId]);

  if (error) return null;
  if (!src) return <CircularProgress size={Math.min(height * 0.4, 20)} />;
  return (
    <img
      src={src}
      alt=""
      style={{ height, maxWidth: height * 2, objectFit: 'cover', borderRadius: 3, display: 'block', ...style }}
    />
  );
}
