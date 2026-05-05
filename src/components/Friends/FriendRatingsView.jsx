import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { readFile } from '../../services/driveService';
import { parseCombined } from '../../services/csvService';
import EntryTable from '../Entries/EntryTable';

export default function FriendRatingsView({ friend, onBack }) {
  const [foodEntries, setFoodEntries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!friend?.fileId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    readFile(friend.fileId)
      .then(({ content }) => {
        if (cancelled) return;
        const combined = parseCombined(content);
        const all = Array.from(combined.values());
        setCategories(all.filter((e) => e.entryType === 'category'));
        setFoodEntries(all.filter((e) => e.entryType === 'food'));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load ratings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [friend?.fileId]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={onBack} size="small">
          Back
        </Button>
        <Typography variant="h6">
          {friend.displayName || friend.email}'s Ratings
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <EntryTable
          foodEntries={foodEntries}
          categories={categories}
          loading={false}
          readOnly
        />
      )}
    </Box>
  );
}
