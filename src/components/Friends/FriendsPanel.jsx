import React, { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemSecondaryAction from '@mui/material/ListItemSecondaryAction';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ShareIcon from '@mui/icons-material/Share';
import DeleteIcon from '@mui/icons-material/Delete';
import { listSharedFoodRatingFiles } from '../../services/driveService';
import { DRIVE_FILE_NAME } from '../../config';
import ShareDialog from './ShareDialog';
import AskToFollowDialog from './AskToFollowDialog';
import FriendRatingsView from './FriendRatingsView';

export default function FriendsPanel({
  following,
  requestedToFollow,
  sharedWith,
  userProfile,
  dataFileId,
  onAddToFollowing,
  onRemoveFromFollowing,
  onRemoveFromRequestedToFollow,
  onPromoteToFollowing,
  onAddToSharedWith,
  onAddToRequestedToFollow,
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [viewingFriend, setViewingFriend] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState(null);

  // On mount and when requestedToFollow changes, check if any pending requests
  // have been fulfilled (the person shared their file with us).
  const discoverShared = useCallback(async () => {
    if (!requestedToFollow.length) return;
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const files = await listSharedFoodRatingFiles(DRIVE_FILE_NAME);
      for (const file of files) {
        const ownerEmail = file.sharingUser?.emailAddress;
        if (!ownerEmail) continue;
        const pending = requestedToFollow.find(
          (p) => p.email.toLowerCase() === ownerEmail.toLowerCase()
        );
        if (pending) {
          onPromoteToFollowing(pending.email, file.id);
        }
      }
    } catch (err) {
      setDiscoverError('Could not check for new shares: ' + (err.message || ''));
    } finally {
      setDiscovering(false);
    }
  }, [requestedToFollow, onPromoteToFollowing]);

  useEffect(() => {
    discoverShared();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (viewingFriend) {
    return (
      <FriendRatingsView
        friend={viewingFriend}
        onBack={() => setViewingFriend(null)}
      />
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Friends</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<ShareIcon />}
            size="small"
            onClick={() => setShareOpen(true)}
            disabled={!dataFileId}
          >
            Share My Ratings
          </Button>
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            size="small"
            onClick={() => setAskOpen(true)}
            disabled={!userProfile}
          >
            Ask to Follow
          </Button>
        </Box>
      </Box>

      {discoverError && (
        <Alert severity="warning" sx={{ mb: 2 }}>{discoverError}</Alert>
      )}

      {/* Following */}
      {following.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            Following ({following.length})
            {discovering && <CircularProgress size={12} sx={{ ml: 1 }} />}
          </Typography>
          <List dense disablePadding sx={{ mb: 2 }}>
            {following.map((friend) => (
              <React.Fragment key={friend.email}>
                <ListItem disablePadding>
                  <ListItemButton onClick={() => setViewingFriend(friend)}>
                    <ListItemText
                      primary={friend.displayName || friend.email}
                      secondary={friend.displayName !== friend.email ? friend.email : undefined}
                    />
                  </ListItemButton>
                  <ListItemSecondaryAction>
                    <Tooltip title="Unfollow">
                      <IconButton
                        size="small"
                        onClick={() => onRemoveFromFollowing(friend.email)}
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemSecondaryAction>
                </ListItem>
                <Divider component="li" />
              </React.Fragment>
            ))}
          </List>
        </>
      )}

      {/* Pending requests */}
      {requestedToFollow.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            Pending Requests ({requestedToFollow.length})
            {discovering && <CircularProgress size={12} sx={{ ml: 1 }} />}
          </Typography>
          <List dense disablePadding sx={{ mb: 2 }}>
            {requestedToFollow.map((person) => (
              <React.Fragment key={person.email}>
                <ListItem disablePadding>
                  <ListItemText
                    sx={{ pl: 2 }}
                    primary={person.displayName || person.email}
                    secondary={person.displayName !== person.email ? person.email : undefined}
                  />
                  <ListItemSecondaryAction>
                    <Chip label="Pending" size="small" variant="outlined" color="warning" sx={{ mr: 1 }} />
                    <Tooltip title="Cancel request">
                      <IconButton
                        size="small"
                        onClick={() => onRemoveFromRequestedToFollow(person.email)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemSecondaryAction>
                </ListItem>
                <Divider component="li" />
              </React.Fragment>
            ))}
          </List>
        </>
      )}

      {following.length === 0 && requestedToFollow.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          You're not following anyone yet. Use "Ask to Follow" to request someone share their ratings.
        </Typography>
      )}

      {/* Shared with me section */}
      {sharedWith.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2, mb: 0.5 }}>
            Shared My Ratings With ({sharedWith.length})
          </Typography>
          <List dense disablePadding>
            {sharedWith.map((person) => (
              <React.Fragment key={person.email}>
                <ListItem>
                  <ListItemText
                    primary={person.displayName || person.email}
                    secondary={person.displayName !== person.email ? person.email : undefined}
                  />
                </ListItem>
                <Divider component="li" />
              </React.Fragment>
            ))}
          </List>
        </>
      )}

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        dataFileId={dataFileId}
        onShared={(email) => onAddToSharedWith({ email, displayName: email })}
      />

      <AskToFollowDialog
        open={askOpen}
        onClose={() => setAskOpen(false)}
        userProfile={userProfile}
        onRequested={(person) => {
          if (person) onAddToRequestedToFollow(person);
        }}
      />
    </Box>
  );
}
