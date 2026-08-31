import React, { useState, useRef, useEffect, useCallback } from 'react';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ReplayIcon from '@mui/icons-material/Replay';
import { fetchPhotoBlob } from '../services/driveService';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

export default function ImageLightbox({ open, onClose, src, fileId }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef(null);
  const containerRef = useRef(null);
  const lastTouchRef = useRef(null);

  const updateZoom = useCallback((z) => {
    zoomRef.current = z;
    setZoom(z);
  }, []);

  const updatePan = useCallback((p) => {
    panRef.current = p;
    setPan(p);
  }, []);

  // Kept in a ref so the history effect below depends only on `open` — callers
  // pass an inline onClose, and re-running on every render would stack up a
  // history entry per render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Give the back gesture / back button something to pop, so it closes the
  // photo instead of leaving the app. The ref survives StrictMode's
  // mount/unmount/remount, which is what keeps this to a single history entry
  // — popping from a discarded first mount would otherwise fire popstate and
  // close the photo the instant it opened.
  const historyPushedRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;

    if (!historyPushedRef.current) {
      window.history.pushState({ crateLightbox: true }, '');
      historyPushedRef.current = true;
    }

    const handlePopState = () => {
      historyPushedRef.current = false; // the entry we pushed is already gone
      onCloseRef.current?.();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [open]);

  // Closed some other way (X, backdrop, Esc): drop the entry we pushed so back
  // doesn't have to be pressed twice to leave the page.
  useEffect(() => {
    if (open || !historyPushedRef.current) return;
    historyPushedRef.current = false;
    window.history.back();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setImageSrc(null);
      updateZoom(1);
      updatePan({ x: 0, y: 0 });
      return;
    }
    if (src) {
      setImageSrc(src);
    } else if (fileId) {
      setLoading(true);
      let objectUrl;
      fetchPhotoBlob(fileId)
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          setImageSrc(objectUrl);
          setLoading(false);
        })
        .catch(() => setLoading(false));
      return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
  }, [open, src, fileId, updateZoom, updatePan]);

  // Non-passive wheel listener for zoom-to-cursor
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !open) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * factor));
      const actualFactor = newZoom / zoomRef.current;
      updateZoom(newZoom);
      updatePan({
        x: panRef.current.x + (cx - panRef.current.x) * (1 - actualFactor),
        y: panRef.current.y + (cy - panRef.current.y) * (1 - actualFactor),
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [open, updateZoom, updatePan]);

  // Non-passive touch move listener to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !open) return;

    const getTouchDist = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchMove = (e) => {
      e.preventDefault();
      if (!lastTouchRef.current) return;

      if (e.touches.length === 1 && lastTouchRef.current.type === 'pan' && dragStartRef.current) {
        updatePan({
          x: e.touches[0].clientX - dragStartRef.current.x,
          y: e.touches[0].clientY - dragStartRef.current.y,
        });
      } else if (e.touches.length === 2 && lastTouchRef.current.type === 'pinch') {
        const newDist = getTouchDist(e.touches[0], e.touches[1]);
        const factor = newDist / lastTouchRef.current.dist;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * factor));
        const actualFactor = newZoom / zoomRef.current;
        const rect = container.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const cx = midX - rect.left - rect.width / 2;
        const cy = midY - rect.top - rect.height / 2;
        updateZoom(newZoom);
        updatePan({
          x: panRef.current.x + (cx - panRef.current.x) * (1 - actualFactor),
          y: panRef.current.y + (cy - panRef.current.y) * (1 - actualFactor),
        });
        lastTouchRef.current = { ...lastTouchRef.current, dist: newDist };
      }
    };

    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => container.removeEventListener('touchmove', handleTouchMove);
  }, [open, updateZoom, updatePan]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!dragStartRef.current || !isDragging) return;
    updatePan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging, updatePan]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const handleDoubleClick = useCallback(() => {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
  }, [updateZoom, updatePan]);

  const handleTouchStart = useCallback((e) => {
    const getTouchDist = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    if (e.touches.length === 1) {
      dragStartRef.current = { x: e.touches[0].clientX - panRef.current.x, y: e.touches[0].clientY - panRef.current.y };
      lastTouchRef.current = { type: 'pan' };
    } else if (e.touches.length === 2) {
      lastTouchRef.current = { type: 'pinch', dist: getTouchDist(e.touches[0], e.touches[1]) };
      dragStartRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastTouchRef.current = null;
    dragStartRef.current = null;
  }, []);

  const reset = useCallback(() => {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
  }, [updateZoom, updatePan]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: 'rgba(0,0,0,0.95)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      }}
    >
      <Box
        sx={{
          position: 'fixed',
          top: 8,
          right: 8,
          zIndex: 10,
          display: 'flex',
          gap: 0.5,
          bgcolor: 'rgba(0,0,0,0.5)',
          borderRadius: 2,
          p: 0.5,
        }}
      >
        <IconButton size="small" onClick={() => updateZoom(Math.min(MAX_ZOOM, zoomRef.current * 1.3))} sx={{ color: 'white' }}>
          <ZoomInIcon />
        </IconButton>
        <IconButton size="small" onClick={() => updateZoom(Math.max(MIN_ZOOM, zoomRef.current / 1.3))} sx={{ color: 'white' }}>
          <ZoomOutIcon />
        </IconButton>
        <IconButton size="small" onClick={reset} sx={{ color: 'white' }}>
          <ReplayIcon />
        </IconButton>
        <IconButton size="small" onClick={onClose} sx={{ color: 'white' }}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {loading && <CircularProgress sx={{ color: 'white' }} />}
        {imageSrc && (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center',
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>
    </Dialog>
  );
}
