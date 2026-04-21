import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import { msToDateInput } from '../../utils/dateUtils';

export default function BulkAddsPanel({ bulkAdds, combined, onOpen }) {
  const visible = bulkAdds.filter((uuids) => uuids.some((u) => combined.has(u)));

  if (visible.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography color="text.secondary">No bulk adds yet.</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Use the + or ↻ button when adding entries to create a bulk add.
        </Typography>
      </Box>
    );
  }

  return (
    <List disablePadding>
      {visible.map((uuids, idx) => {
        const entries = uuids.map((u) => combined.get(u)).filter(Boolean);
        const rep = entries[0];
        const catEntry = rep.ratingCategory ? combined.get(rep.ratingCategory) : null;
        const catName = catEntry?.restaurantName || '';
        const dateStr = rep.dateRated ? msToDateInput(rep.dateRated) : '';

        const secondaryParts = [];
        if (catName) secondaryParts.push(catName);
        if (dateStr) secondaryParts.push(dateStr);

        return (
          <ListItem key={idx} disablePadding divider>
            <ListItemButton onClick={() => onOpen(entries)}>
              <ListItemText
                primary={rep.restaurantName || '(unnamed)'}
                secondary={secondaryParts.join(' · ')}
              />
              <Chip label={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`} size="small" sx={{ ml: 1 }} />
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
}
