import React, { useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import ImportExportIcon from '@mui/icons-material/ImportExport';
import LogoutIcon from '@mui/icons-material/Logout';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SyncStatus from '../Common/SyncStatus';

export default function Header({
  syncing,
  syncError,
  onClearError,
  onReauthenticate,
  onOpenExportImport,
  onSignOut,
  isOffline,
  pendingCount,
}) {
  const [menuAnchor, setMenuAnchor] = useState(null);

  return (
    <AppBar position="static" elevation={1}>
      <Toolbar>
        <RestaurantIcon sx={{ mr: 1 }} />
        <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
          Food Ratings
        </Typography>

        <SyncStatus
          syncing={syncing}
          syncError={syncError}
          onClearError={onClearError}
          onReauthenticate={onReauthenticate}
          isOffline={isOffline}
          pendingCount={pendingCount}
        />

        <Tooltip title="Export / Import">
          <IconButton color="inherit" onClick={onOpenExportImport} sx={{ ml: 1 }}>
            <ImportExportIcon />
          </IconButton>
        </Tooltip>

        <IconButton color="inherit" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ ml: 0.5 }}>
          <MoreVertIcon />
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onSignOut();
            }}
          >
            <LogoutIcon fontSize="small" sx={{ mr: 1 }} />
            Sign Out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
