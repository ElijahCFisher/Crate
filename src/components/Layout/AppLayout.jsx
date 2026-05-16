import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import LinearProgress from '@mui/material/LinearProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Header from './Header';
import EntryTable from '../Entries/EntryTable';
import AddEditEntryModal from '../Entries/AddEditEntryModal';
import DeleteConfirmDialog from '../Entries/DeleteConfirmDialog';
import ExportImportDialog from '../ExportImport/ExportImportDialog';
import CategoriesPanel from '../Categories/CategoriesPanel';
import BulkAddsPanel from '../BulkAdds/BulkAddsPanel';
import FriendsPanel from '../Friends/FriendsPanel';
import FollowRequestDialog from '../Friends/FollowRequestDialog';
import SettingsPage from '../Settings/SettingsPage';
import NotesPanel from '../Notes/NotesPanel';
import { useSettings } from '../../hooks/useSettings';

function decodeFollowRequest(encoded) {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function sameUuidList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((uuid, i) => uuid === b[i]);
}

export default function AppLayout({ auth, data, onReauthenticate }) {
  const {
    combined,
    foodEntries,
    categories,
    fileId: dataFileId,
    folderId,
    picturesFolderId,
    loading,
    syncing,
    syncError,
    setSyncError,
    addEntry,
    addEntryGroups,
    addEntriesWithLinks,
    addCategory,
    modifyEntry,
    deleteEntry,
    importCsv,
    exportCsv,
    isOffline,
    pendingCount,
  } = data;

  const {
    bulkAdds, addBulkAdd, updateBulkAdd,
    following, addToFollowing, removeFromFollowing, promoteToFollowing,
    requestedToFollow, addToRequestedToFollow, removeFromRequestedToFollow,
    sharedWith, addToSharedWith,
    showAdvancedByDefault, updateShowAdvancedByDefault,
  } = useSettings(folderId);

  // Tab
  const [tab, setTab] = useState('entries');

  // Notes (local for now — not yet synced to Drive)
  const [notes, setNotes] = useState('');

  // Modal state
  const [addEditOpen, setAddEditOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [bulkAddEntries, setBulkAddEntries] = useState(null);
  const [deleteDialogEntry, setDeleteDialogEntry] = useState(null);
  const [exportImportOpen, setExportImportOpen] = useState(false);

  // Follow request from URL
  const [followRequester, setFollowRequester] = useState(null);

  // Detect ?followRequest= in the URL on load (and after auth)
  useEffect(() => {
    if (!auth.isAuthenticated || !dataFileId) return;
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('followRequest');
    if (!encoded) return;
    const decoded = decodeFollowRequest(encoded);
    if (decoded?.email) {
      setFollowRequester(decoded);
      // Clean the URL so refreshing doesn't re-trigger the dialog
      const url = new URL(window.location.href);
      url.searchParams.delete('followRequest');
      window.history.replaceState({}, '', url.toString());
    }
  }, [auth.isAuthenticated, dataFileId]);

  function openAdd() {
    setEditingEntry(null);
    setBulkAddEntries(null);
    setAddEditOpen(true);
  }

  function openFromBulk(entries) {
    setEditingEntry(null);
    setBulkAddEntries(entries);
    setAddEditOpen(true);
  }

  function openEdit(entry) {
    setEditingEntry(entry);
    setBulkAddEntries(null);
    setAddEditOpen(true);
  }

  function closeAddEdit() {
    setAddEditOpen(false);
    setEditingEntry(null);
    setBulkAddEntries(null);
  }

  function handleSave(payload) {
    if (editingEntry) {
      modifyEntry(editingEntry.uuid, payload);
      if ('identicals' in payload) {
        const nextIdenticals = payload.identicals || [];
        const nextSet = new Set(nextIdenticals);
        const previousSet = new Set(editingEntry.identicals || []);
        const relatedUuids = new Set([...nextSet, ...previousSet]);
        const entriesByUuid = new Map(foodEntries.map((entry) => [entry.uuid, entry]));

        for (const uuid of relatedUuids) {
          const relatedEntry = entriesByUuid.get(uuid);
          if (!relatedEntry) continue;

          const relatedIdenticals = relatedEntry.identicals || [];
          const reconciled = nextSet.has(uuid)
            ? relatedIdenticals.includes(editingEntry.uuid)
              ? relatedIdenticals
              : [...relatedIdenticals, editingEntry.uuid]
            : relatedIdenticals.filter((id) => id !== editingEntry.uuid);

          if (!sameUuidList(relatedEntry.identicals || [], reconciled)) {
            modifyEntry(uuid, { identicals: reconciled });
          }
        }
      }
    } else {
      addEntry(payload);
    }
  }

  function handleSaveGroups(groups) {
    const builtGroups = addEntryGroups(groups);
    if (builtGroups) {
      const allUuids = builtGroups.flat().map((e) => e.uuid);
      if (allUuids.length > 1) addBulkAdd(allUuids);
    }
  }

  function handleBulkSave(changes, newGroupData = []) {
    for (const { uuid, updates } of changes) {
      modifyEntry(uuid, updates);
    }
    const allNewUuids = [];
    for (const { entries, existingUuids } of newGroupData) {
      if (entries.length === 0) continue;
      const newEntries = addEntriesWithLinks(entries, existingUuids);
      allNewUuids.push(...newEntries.map((e) => e.uuid));
    }
    if (allNewUuids.length > 0 && bulkAddEntries?.length > 0) {
      updateBulkAdd(bulkAddEntries[0].uuid, allNewUuids);
    }
  }

  function handleAddCategory(categoryData) {
    return addCategory(categoryData);
  }

  function handleEditCategory(editEntry, formData) {
    const updates = {};
    if ((formData.name || '') !== (editEntry.restaurantName || ''))
      updates.restaurantName = formData.name || '';
    if ((formData.ratingCategory || '') !== (editEntry.ratingCategory || ''))
      updates.ratingCategory = formData.ratingCategory || '';
    const newScore = formData.score != null && formData.score !== '' ? formData.score : null;
    const origScore = editEntry.score != null ? String(editEntry.score) : null;
    if (newScore !== origScore) updates.score = newScore;
    const newDate = formData.dateRated ?? null;
    if (newDate !== editEntry.dateRated) updates.dateRated = newDate;
    if ((formData.additionalInfo || '') !== (editEntry.additionalInfo || ''))
      updates.additionalInfo = formData.additionalInfo || '';
    if (Object.keys(updates).length > 0) modifyEntry(editEntry.uuid, updates);
  }

  function handleDeleteConfirm() {
    if (!deleteDialogEntry) return;
    deleteEntry(deleteDialogEntry.uuid);
    setDeleteDialogEntry(null);
  }

  function handleFollowAccept(requester) {
    addToSharedWith({ email: requester.email, displayName: requester.displayName || requester.email });
    setFollowRequester(null);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header
        isAuthenticated={auth.isAuthenticated}
        isSilentTrying={auth.isSilentTrying}
        isSigningIn={auth.isSigningIn}
        authError={auth.authError}
        onSignIn={auth.signIn}
        onSignOut={auth.signOut}
        syncing={syncing}
        syncError={syncError}
        onClearError={() => setSyncError(null)}
        onReauthenticate={onReauthenticate}
        onOpenExportImport={() => setExportImportOpen(true)}
        isOffline={isOffline}
        pendingCount={pendingCount}
      />

      {/* Non-blocking thin progress bar while fetching Drive data */}
      {loading && <LinearProgress sx={{ height: 2 }} />}

      <Container maxWidth="xl" sx={{ py: 3, flex: 1 }}>
        {/* Tab switcher */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            label={`Food Entries${foodEntries.length ? ` (${foodEntries.length})` : ''}`}
            value="entries"
          />
          <Tab
            label={`Categories${categories.length ? ` (${categories.length})` : ''}`}
            value="categories"
          />
          <Tab
            label={`Bulk Adds${bulkAdds.length ? ` (${bulkAdds.length})` : ''}`}
            value="bulkAdds"
          />
          <Tab
            label={`Friends${following.length ? ` (${following.length})` : ''}`}
            value="friends"
          />
          <Tab label="Notes" value="notes" />
          <Tab label="Settings" value="settings" />
        </Tabs>

        {tab === 'entries' && (
          <EntryTable
            foodEntries={foodEntries}
            categories={categories}
            loading={loading}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={(entry) => setDeleteDialogEntry(entry)}
          />
        )}

        {tab === 'categories' && (
          <CategoriesPanel
            categories={categories}
            onAdd={handleAddCategory}
            onEdit={handleEditCategory}
            onDelete={(entry) => deleteEntry(entry.uuid)}
            onAddCategory={handleAddCategory}
          />
        )}

        {tab === 'bulkAdds' && (
          <BulkAddsPanel
            bulkAdds={bulkAdds}
            combined={combined}
            onOpen={openFromBulk}
          />
        )}

        {tab === 'notes' && (
          <NotesPanel notes={notes} onChange={setNotes} />
        )}

        {tab === 'settings' && (
          <SettingsPage
            showAdvancedByDefault={showAdvancedByDefault}
            onUpdateShowAdvancedByDefault={updateShowAdvancedByDefault}
          />
        )}

        {tab === 'friends' && (
          <FriendsPanel
            following={following}
            requestedToFollow={requestedToFollow}
            sharedWith={sharedWith}
            userProfile={auth.userProfile}
            dataFileId={dataFileId}
            picturesFolderId={picturesFolderId}
            onAddToFollowing={addToFollowing}
            onRemoveFromFollowing={removeFromFollowing}
            onRemoveFromRequestedToFollow={removeFromRequestedToFollow}
            onPromoteToFollowing={promoteToFollowing}
            onAddToSharedWith={addToSharedWith}
            onAddToRequestedToFollow={addToRequestedToFollow}
          />
        )}
      </Container>

      {/* Add / Edit entry modal */}
      <AddEditEntryModal
        open={addEditOpen}
        entry={editingEntry}
        initialEntries={bulkAddEntries}
        categories={categories}
        foodEntries={foodEntries}
        onSave={handleSave}
        onSaveGroups={!editingEntry && !bulkAddEntries ? handleSaveGroups : undefined}
        onBulkSave={bulkAddEntries ? handleBulkSave : undefined}
        onAddCategory={handleAddCategory}
        onClose={closeAddEdit}
        showAdvancedByDefault={showAdvancedByDefault}
        picturesFolderId={picturesFolderId}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteDialogEntry}
        entry={deleteDialogEntry}
        categories={categories}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteDialogEntry(null)}
      />

      {/* Export / Import */}
      <ExportImportDialog
        open={exportImportOpen}
        onClose={() => setExportImportOpen(false)}
        exportCsv={exportCsv}
        onImportCsv={importCsv}
        syncing={syncing}
      />

      {/* Follow request from link */}
      <FollowRequestDialog
        open={!!followRequester}
        requester={followRequester}
        dataFileId={dataFileId}
        picturesFolderId={picturesFolderId}
        onAccept={handleFollowAccept}
        onDecline={() => setFollowRequester(null)}
      />
    </Box>
  );
}
